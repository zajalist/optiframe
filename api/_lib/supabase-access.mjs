// Server-only helpers. Never accept browser-asserted email, status, or user IDs.
export class AccessError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export function supabaseEnvironment(env=process.env){
  const url=env.SUPABASE_URL, key=env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  if(!url || !key) throw new AccessError(503,'Account service is not configured.');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.pathname!=='/' || parsed.search || parsed.hash) throw new AccessError(503,'Account service is not configured.');
  return {url:parsed.origin,key};
}
export async function verifyAccountBearer(req,{env=process.env,fetcher=fetch}={}){
  const {url,key}=supabaseEnvironment(env);
  const raw=req.headers?.authorization;
  if(typeof raw!=='string' || !/^Bearer [A-Za-z0-9._~-]{20,8192}$/.test(raw)) throw new AccessError(401,'Sign in to continue.');
  const headers={apikey:key,Authorization:raw};
  let response;
  try{response=await fetcher(url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(8000)});}catch{throw new AccessError(503,'Account service is unavailable.');}
  if(!response.ok) throw new AccessError(response.status>=500?503:401,'Sign in to continue.');
  const user=await response.json();
  if(!user?.id || typeof user.id!=='string') throw new AccessError(401,'Sign in to continue.');
  return {user,headers,url};
}
export async function verifyApprovedBearer(req,options={}){
  const account=await verifyAccountBearer(req,options);
  let response;
  try{response=await (options.fetcher || fetch)(account.url+'/rest/v1/rpc/get_my_access',{method:'POST',headers:{...account.headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});}catch{throw new AccessError(503,'Account service is unavailable.');}
  if(!response.ok) throw new AccessError(503,'Could not verify account access.');
  const access=await response.json();
  if(access?.status!=='approved') throw new AccessError(403,'Your application must be approved before using the app.');
  return {user:account.user,access};
}
