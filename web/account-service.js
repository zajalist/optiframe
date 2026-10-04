// Public configuration only. Supabase Auth and database RLS enforce authorization.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const APPLICATION_COLUMNS = 'platform,role,note,consent,status,consented_at,created_at,updated_at';
const PENDING_KEY = 'optiframe-pending-application';
let defaultService;
async function deadline(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}}

export function validateApplication(value) {
  if (!value || !['iphone', 'android', 'both'].includes(value.platform)) throw new Error('Choose iPhone, Android, or both.');
  const role = value.role || null;
  if (role !== null && !['tester', 'provider', 'designer'].includes(role)) throw new Error('Choose a valid role.');
  if (typeof (value.note ?? '') !== 'string' || (value.note || '').length > 500) throw new Error('Keep the note under 500 characters.');
  if (value.consent !== true) throw new Error('Consent is required to join the waitlist.');
  return {platform: value.platform, role, note: (value.note || '').trim(), consent: true};
}

export function validateConfig(config) {
  let url;
  try { url = new URL(config?.supabaseUrl); } catch { throw new Error('Sign-in is not configured yet.'); }
  const key = config?.supabasePublishableKey;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || typeof key !== 'string' || key.length < 20 || key.startsWith('sb_secret_')) throw new Error('Sign-in is not configured yet.');
  if (key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'anon') throw new Error();
    } catch { throw new Error('Only a public Supabase key may be used in the browser.'); }
  } else if (!key.startsWith('sb_publishable_')) throw new Error('Only a public Supabase key may be used in the browser.');
  return {supabaseUrl: url.origin, supabasePublishableKey: key, googleEnabled: config.googleEnabled === true};
}

function credentials({email, password}) {
  email=validateEmail(email);
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new Error('Use a password between 8 and 128 characters.');
  return {email: email.trim(), password};
}

function validateEmail(email) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter a valid email address.');
  return email.trim();
}

function applicationView(row) {
  return row ? {platform:row.platform, role:row.role || '', note:row.note, consent:row.consent, status:row.status, consentedAt:row.consented_at, createdAt:row.created_at, updatedAt:row.updated_at} : null;
}

// Injected dependencies keep authorization flows testable without real user accounts.
export function createAccountService({fetcher=globalThis.fetch, importSdk=()=>import(SDK_URL), location=globalThis.location, storage=globalThis.sessionStorage} = {}) {
  let clientPromise, configValue;
  const boundedFetch=async(url,options={})=>{
    const controller=new AbortController(),cancel=()=>controller.abort();
    options.signal?.addEventListener('abort',cancel,{once:true});
    if(options.signal?.aborted)controller.abort();
    const timer=setTimeout(cancel,12000);
    try{return await fetcher(url,{...options,signal:controller.signal});}
    finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
  };
  const pending = (value) => { try { if (value) storage?.setItem(PENDING_KEY, JSON.stringify(value)); else storage?.removeItem(PENDING_KEY); } catch {} };
  const redirectTo = () => new URL('/account.html', location.origin).href;
  async function client() {
    if (!clientPromise) clientPromise = (async () => {
      const response = await boundedFetch('/app-config.json', {cache:'no-store', credentials:'same-origin'});
      if (!response.ok) throw new Error('Sign-in is not configured yet.');
      configValue = validateConfig(await response.json());
      const {createClient} = await deadline(importSdk(),15000,'Sign-in could not load. Check your connection and retry.');
      return createClient(configValue.supabaseUrl, configValue.supabasePublishableKey, {global:{fetch:boundedFetch},auth:{flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:'optiframe-auth'}});
    })().catch(error => { clientPromise = null; throw error; });
    return clientPromise;
  }
  async function currentUser(api) {
    const {data, error} = await api.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') throw new Error('Your session expired. Sign in again.');
    return data?.user ? {id:data.user.id, email:data.user.email || ''} : null;
  }
  async function readApplication(api, user) {
    if (!user) return null;
    const {data,error} = await api.from('waitlist_applications').select(APPLICATION_COLUMNS).eq('user_id',user.id).maybeSingle();
    if (error) throw new Error('Could not load your application. Try again.');
    return applicationView(data);
  }
  async function readAccess(api,user){
    if(!user) return {accessStatus:null,isAdmin:false};
    const {data,error}=await api.rpc('get_my_access');
    if(error || !['pending','approved','rejected'].includes(data?.status)) throw new Error('Could not verify app access. Try again.');
    return {accessStatus:data.status,isAdmin:data.isAdmin===true};
  }
  async function getAccessToken(){
    const api=await client();
    const {data,error}=await api.auth.getSession();
    if(error) throw new Error('Sign in again to continue.');
    return data?.session?.access_token || null;
  }
  async function notifyApplication(){
    try{
      const token=await getAccessToken();
      if(token) await fetcher('/api/application-notifications',{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
    }catch{} // The durable outbox retains the request for the scheduled retry worker.
  }
  async function saveApplication(application) {
    const value=validateApplication(application), api=await client(), user=await currentUser(api);
    if (!user) throw new Error('Sign in to save your application.');
    const existing=await readApplication(api,user);
    let query=existing ? api.from('waitlist_applications').update(value).eq('user_id',user.id) : api.from('waitlist_applications').insert(value);
    const {data,error}=await query.select(APPLICATION_COLUMNS).single();
    if (error) throw new Error('Could not save your application. Try again.');
    pending(null);
    if(!existing) void notifyApplication();
    return {user,application:applicationView(data),...await readAccess(api,user)};
  }
  async function loadAccount() {
    const api=await client(), user=await currentUser(api);
    const application=await readApplication(api,user);
    // SDK completes the PKCE exchange before getUser resolves. Clean only afterwards.
    if (location?.search && new URLSearchParams(location.search).has('code')) {
      const clean=new URL(location.href); clean.searchParams.delete('code');
      globalThis.history?.replaceState(null,'',clean.pathname+clean.search+clean.hash);
    }
    if (user && !application) {
      let value;
      try { value=JSON.parse(storage?.getItem(PENDING_KEY) || 'null'); } catch {}
      if (value) {
        const saved=await saveApplication(value);
        return {...saved,googleEnabled:configValue.googleEnabled,passwordRecovery:new URLSearchParams(location.search || '').get('recovery') === '1'};
      }
    }
    return {user,application,...await readAccess(api,user),googleEnabled:configValue.googleEnabled,passwordRecovery:!!user && new URLSearchParams(location.search || '').get('recovery') === '1'};
  }
  async function signUp({email,password,application}) {
    const login=credentials({email,password}), value=application ? validateApplication(application) : null;
    const api=await client();
    const {data,error}=await api.auth.signUp({...login,options:{emailRedirectTo:redirectTo()}});
    if (error) throw new Error('Could not create an account. Try signing in or try again later.');
    if (!data.session) { if(value) pending(value); return {user:null,application:null,needsEmailConfirmation:true}; }
    return value ? saveApplication(value) : loadAccount();
  }
  async function signIn(value) {
    const login=credentials(value), api=await client();
    const {error}=await api.auth.signInWithPassword(login);
    if (error) throw new Error('Sign-in failed. Check your email, password, and email confirmation.');
    return loadAccount();
  }
  async function signInWithGoogle(application) {
    const api=await client();
    if (!configValue.googleEnabled) throw new Error('Google sign-in is not available yet.');
    if (application) pending(validateApplication(application));
    const {error}=await api.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo()}});
    if (error) throw new Error('Google sign-in failed. Try again.');
  }
  async function signOut() {
    const api=await client();
    const {error}=await api.auth.signOut({scope:'local'});
    if (error) throw new Error('Could not sign out. Try again.');
    pending(null);
    return {user:null,application:null};
  }
  async function requestPasswordReset(email) {
    email=validateEmail(email);
    const api=await client();
    const {error}=await api.auth.resetPasswordForEmail(email,{redirectTo:redirectTo()+'?recovery=1'});
    if (error && error.status === 429) throw new Error('Please wait before requesting another email.');
    if (error) throw new Error('Could not request a reset email. Try again later.');
    // The response does not reveal whether an address is registered.
    return {message:'If an account exists, a password reset link will be sent.'};
  }
  async function updatePassword(password) {
    credentials({email:'validation@example.com',password});
    const api=await client();
    if (!await currentUser(api)) throw new Error('Open a valid password reset link first.');
    const {error}=await api.auth.updateUser({password});
    if (error) throw new Error('Could not update the password. Request a new reset link.');
    return {updated:true};
  }
  async function adminListApplications({limit=50,offset=0}={}){
    const api=await client();
    const {data,error}=await api.rpc('admin_list_applications',{p_limit:Math.min(100,Math.max(1,Math.trunc(limit)||50)),p_offset:Math.max(0,Math.trunc(offset)||0)});
    if(error) throw new Error('Administrator access is required to review applications.');
    return (data || []).map(row=>({userId:row.user_id,email:row.email,platform:row.platform,role:row.role || '',note:row.note,status:row.status,createdAt:row.created_at,consentedAt:row.consented_at,notificationState:row.notification_state,notificationAttempts:row.notification_attempts,notificationError:row.notification_error}));
  }
  async function adminSetAccess(userId,status){
    if(typeof userId!=='string' || !/^[0-9a-f-]{36}$/i.test(userId) || !['pending','approved','rejected'].includes(status)) throw new Error('Choose a valid account and access status.');
    const api=await client();
    const {data,error}=await api.rpc('admin_set_access',{p_user_id:userId,p_status:status});
    if(error) throw new Error('Could not change account access.');
    return data;
  }
  return {loadAccount,signUp,signIn,signInWithGoogle,signOut,saveApplication,requestPasswordReset,updatePassword,getAccessToken,adminListApplications,adminSetAccess};
}
const service = () => defaultService ||= createAccountService();
export const loadAccount = (...args) => service().loadAccount(...args);
export const signUp = (...args) => service().signUp(...args);
export const signIn = (...args) => service().signIn(...args);
export const signInWithGoogle = (...args) => service().signInWithGoogle(...args);
export const signOut = (...args) => service().signOut(...args);
export const saveApplication = (...args) => service().saveApplication(...args);
export const requestPasswordReset = (...args) => service().requestPasswordReset(...args);
export const updatePassword = (...args) => service().updatePassword(...args);
export const getAccessToken = (...args) => service().getAccessToken(...args);
export const adminListApplications = (...args) => service().adminListApplications(...args);
export const adminSetAccess = (...args) => service().adminSetAccess(...args);
