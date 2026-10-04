import { getAccessToken, loadAccount } from './account-service.js?v=43';

export function createApiFetch({fetcher=globalThis.fetch,location=globalThis.location,token=getAccessToken}={}) {
  return async (url, options={}) => {
    const target=new URL(url,location.href);
    if(target.origin!==location.origin||!target.pathname.startsWith('/api/'))throw new Error('API requests must stay on this site.');
    const headers=new Headers(options.headers);
    const key=new URLSearchParams(location.hash.slice(1)).get('access');
    if(key)headers.set('X-OptiFrame-Key',key);
    else{const bearer=await token();if(!bearer)throw new Error('Sign in with an approved account to continue.');headers.set('Authorization',`Bearer ${bearer}`);}
    return fetcher(url,{...options,headers});
  };
}
export const apiFetch=createApiFetch();

export async function requireAppAccess(){
  // The key is retained solely for existing private internal testing links.
  // Supabase authorization is also enforced at the GPU server for every API call.
  if(new URLSearchParams(location.hash.slice(1)).get('access'))return;
  document.documentElement.style.visibility='hidden';
  try{
    const account=await loadAccount();
    if(account.user&&account.accessStatus==='approved')return;
  }catch{}
  finally{document.documentElement.style.visibility='';}
  location.replace('/account.html');
  throw new Error('Approved access required.');
}
