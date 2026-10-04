import { cp, mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';

// An explicit public-only build. Captures, native exports and backend credentials
// never enter the deployment. Deployment runs in a fresh Vercel build directory.
const output = resolve('dist');
await mkdir(output, {recursive:true});
await cp(resolve('web'), output, {recursive:true, filter: source => {
  const name=basename(source);
  return !/\.test\.[cm]?js$/.test(name) && !name.startsWith('qa-') && !['app-config.json','index.html'].includes(name);
}});
// Avoid index.html's filesystem precedence over the landing-page root rewrite.
await rm(resolve(output,'index.html'),{force:true});
await cp(resolve('web/index.html'),resolve(output,'scanner.html'));
const url=(process.env.SUPABASE_URL||'').trim();
const key=(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim();
if(Boolean(url)!==Boolean(key))throw new Error('Set both Supabase public configuration values.');
if(url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw new Error('Expected a Supabase project HTTPS URL.');
if(key && !key.startsWith('sb_publishable_')) {
  let payload;
  try {payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));}catch{}
  if(payload?.role!=='anon')throw new Error('Only a Supabase publishable or anon key may be exposed.');
}
await writeFile(resolve(output,'app-config.json'),JSON.stringify({supabaseUrl:url,supabasePublishableKey:key,googleEnabled:process.env.SUPABASE_GOOGLE_ENABLED==='true'}));
console.log(`Public web build ready (${(await readdir(output)).length} entries); accounts ${url?'configured':'awaiting Supabase setup'}.`);
