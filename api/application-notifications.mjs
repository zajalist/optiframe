import {timingSafeEqual} from 'node:crypto';
import {AccessError,verifyAccountBearer,supabaseEnvironment} from './_lib/supabase-access.mjs';

const RECIPIENT='zejbadr@gmail.com';
function equalSecret(actual,expected){
  if(typeof actual!=='string' || !expected) return false;
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function createNotificationHandler({env=process.env,fetcher=fetch}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({detail:'Method not allowed.'});}
    try{
      const cron=equalSecret(req.headers?.authorization,env.CRON_SECRET?'Bearer '+env.CRON_SECRET:null);
      if(req.method==='GET' && !cron) throw new AccessError(401,'Unauthorized.');
      let userId=null;
      if(!cron){
        const {user}=await verifyAccountBearer(req,{env,fetcher});
        if(!user.email_confirmed_at || !user.email) throw new AccessError(403,'Confirm your email before applying.');
        userId=user.id;
      }
      const {url}=supabaseEnvironment(env),serviceKey=env.SUPABASE_SERVICE_ROLE_KEY;
      if(!serviceKey || !env.RESEND_API_KEY || !env.RESEND_FROM) throw new AccessError(503,'Application notifications are not configured.');
      const rpc=async(name,body)=>{
        const response=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
        if(!response.ok) throw new AccessError(503,'Notification queue is unavailable.');
        return response.json();
      };
      const rows=await rpc('claim_application_emails',{p_user_id:userId,p_limit:userId?1:3});
      let sent=0,queued=0;
      for(const row of rows){
        let providerId=null,error=null;
        try{
          const item=row.payload;
          const text=['New OptiFrame application','',`Email: ${item.email}`,`Platform: ${item.platform}`,`Role: ${item.role || 'Not specified'}`,`Submitted: ${item.submittedAt}`,'',item.note || 'No note.','','Review: https://optiframe.zajalist.com/account.html'].join('\n');
          const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'optiframe-application/'+row.id},body:JSON.stringify({from:env.RESEND_FROM,to:[RECIPIENT],subject:'OptiFrame access application',text}),signal:AbortSignal.timeout(10000)});
          if(response.ok){const body=await response.json();if(typeof body.id==='string') providerId=body.id;else error='Provider response incomplete';}
          else error='Provider HTTP '+response.status;
        }catch{error='Provider request interrupted';}
        const finished=await rpc('finish_application_email',{p_id:row.id,p_lease_token:row.lease_token,p_provider_id:providerId,p_error:error});
        if(!finished) throw new AccessError(503,'Notification lease changed.');
        if(providerId) sent++;else queued++;
      }
      return res.status(200).json({sent,queued});
    }catch(error){
      return res.status(error instanceof AccessError?error.status:503).json({detail:error instanceof AccessError?error.message:'Application notifications are temporarily unavailable.'});
    }
  };
}
export default createNotificationHandler();
