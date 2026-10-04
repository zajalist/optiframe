import * as service from './account-service.js?v=43';
const $=id=>document.getElementById(id);
let mode='create',busy=false,account=null,requestOffset=0;
function notice(text='',error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function setMode(next){mode=next;for(const key of ['create','signin'])$(`${key}-tab`).setAttribute('aria-pressed',String(key===mode));$('submit-auth').textContent=mode==='create'?'Create account':'Sign in';$('password').autocomplete=mode==='create'?'new-password':'current-password';$('password-hint').hidden=mode!=='create';$('forgot').hidden=mode!=='signin';notice();}
function application(){return {platform:document.querySelector('[name=platform]:checked').value,role:$('role').value,note:$('note').value,consent:$('consent').checked};}
function render(value){
  account=value;$('auth').hidden=!!value.user;$('member').hidden=!value.user;$('recovery').hidden=!value.passwordRecovery;$('retry').hidden=true;
  if(typeof value.googleEnabled==='boolean')$('google').hidden=!value.googleEnabled;
  if(value.passwordRecovery){$('member').hidden=true;$('auth').hidden=true;return;}
  $('admin').hidden=!value.isAdmin;
  if(!value.user)return;
  $('member-email').textContent=value.user.email;
  const saved=value.application, approved=value.accessStatus==='approved';$('confirmation').hidden=!saved&&!approved;$('application').hidden=!!saved||approved;
  $('open-app').hidden=!approved;$('access-title').textContent=approved?'You’re in.':value.accessStatus==='rejected'?'Access not approved.':'Request received.';
  $('access-description').textContent=approved?'Your OptiFrame account is ready.':value.accessStatus==='rejected'?'You can still explore the demo frames.':'Your application is awaiting approval.';
  $('edit-application').hidden=!saved;$('saved-platform').textContent='';
  if(saved){document.querySelector(`[name=platform][value="${saved.platform}"]`).checked=true;$('role').value=saved.role||'';$('note').value=saved.note||'';$('consent').checked=saved.consent===true;$('saved-platform').textContent=({iphone:'iPhone app',android:'Android app',both:'iPhone + Android apps'})[saved.platform];}
}
async function run(task){
  if(busy)return;busy=true;const buttons=[...document.querySelectorAll('button')].map(button=>[button,button.disabled]);buttons.forEach(([button])=>button.disabled=true);$('notice').setAttribute('aria-busy','true');
  try{await task();}catch(error){notice(error.message||'Could not connect. Try again.',true);}finally{busy=false;buttons.forEach(([button,disabled])=>button.disabled=disabled);$('notice').removeAttribute('aria-busy');}
}
async function connect(){notice('Connecting…');try{render(await service.loadAccount());notice();if(account.isAdmin)await loadRequests();}catch(error){$('auth').hidden=true;$('member').hidden=true;$('retry').hidden=false;throw error;}}
$('create-tab').onclick=()=>setMode('create');$('signin-tab').onclick=()=>setMode('signin');
$('show-password').onclick=()=>{const visible=$('password').type==='password';$('password').type=visible?'text':'password';$('show-password').textContent=visible?'Hide':'Show';$('show-password').setAttribute('aria-pressed',String(visible));};
$('login-form').onsubmit=event=>{event.preventDefault();run(async()=>{notice(mode==='create'?'Creating account…':'Signing in…');const result=await service[mode==='create'?'signUp':'signIn']({email:$('email').value,password:$('password').value});$('password').value='';render(result);if(result.needsEmailConfirmation){setMode('signin');notice('Check your email to confirm your account, then sign in to request access.');}else notice();if(result.isAdmin)await loadRequests();});};
$('google').onclick=()=>run(async()=>{notice('Opening Google…');await service.signInWithGoogle();});
$('forgot').onclick=()=>run(async()=>{if(!$('email').reportValidity())return;notice((await service.requestPasswordReset($('email').value)).message);});
$('recovery').onsubmit=event=>{event.preventDefault();run(async()=>{await service.updatePassword($('new-password').value);$('new-password').value='';history.replaceState(null,'','/account.html');render(await service.loadAccount());notice('Password updated.');});};
$('application').onsubmit=event=>{event.preventDefault();run(async()=>{notice('Saving your application…');await service.saveApplication(application());render(await service.loadAccount());notice();});};
$('edit-application').onclick=()=>{$('confirmation').hidden=true;$('application').hidden=false;$('save-application').textContent='Save changes';};
$('signout').onclick=()=>run(async()=>{render(await service.signOut());notice('Signed out.');});
$('retry').onclick=()=>run(connect);
async function loadRequests(append=false){
  const rows=await service.adminListApplications({limit:50,offset:append?requestOffset:0});if(!append){$('requests').replaceChildren();requestOffset=0;}
  const entries=Array.isArray(rows)?rows:rows.applications||[];
  requestOffset+=entries.length;$('more-requests').hidden=entries.length<50;
  if(!entries.length&&!append){const empty=document.createElement('p');empty.className='hint';empty.textContent='No requests yet.';$('requests').append(empty);return;}
  for(const row of entries){
    const item=document.createElement('article');item.className='request';
    const email=document.createElement('p');email.textContent=row.email;
    const status=document.createElement('p');status.className='hint';status.textContent=`${row.platform||'App access'} · ${row.status||'pending'}`;
    const note=document.createElement('p');note.className='request-note';note.textContent=row.note||'';
    if(row.notificationState&&row.notificationState!=='sent'){const delivery=document.createElement('p');delivery.className='hint';delivery.textContent=row.notificationState==='review'?'Email delivery needs review.':`Email notification ${row.notificationState}.`;item.append(delivery);}
    const actions=document.createElement('div');actions.className='request-actions';
    for(const [label,next] of [['Approve','approved'],['Decline','rejected']]){const button=document.createElement('button');button.type='button';button.className='glass';button.textContent=label;button.disabled=row.status===next;button.onclick=()=>run(async()=>{await service.adminSetAccess(row.user_id||row.userId,next);await loadRequests();notice('Access updated.');});actions.append(button);}
    item.append(email,status,note,actions);$('requests').append(item);
  }
}
$('refresh-requests').onclick=()=>run(loadRequests);
$('more-requests').onclick=()=>run(()=>loadRequests(true));
run(connect);
