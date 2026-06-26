// debug_reports.screenshot_b64 (JPEG base64) → Storage bucket 'debug-reports/<id>.jpg'.
// No data loss: upload + set screenshot_path FIRST, null b64 only after both succeed.
import { createClient } from '@supabase/supabase-js';
const SB='https://rranpzicmhgfupgabgbi.supabase.co';
const KEY=process.env.SUPABASE_SERVICE_KEY;
if(!KEY){console.error('SUPABASE_SERVICE_KEY gerekli');process.exit(1);}
const sb=createClient(SB,KEY,{auth:{persistSession:false}});
const {data:rows,error}=await sb.from('debug_reports').select('id, screenshot_b64').not('screenshot_b64','is',null);
if(error){console.error('fetch err',error.message);process.exit(1);}
console.log('rows with b64:',rows.length);
let ok=0,fail=0;
for(const r of rows){
  try{
    const buf=Buffer.from(r.screenshot_b64,'base64');
    const path=`${r.id}.jpg`;
    const {error:up}=await sb.storage.from('debug-reports').upload(path,buf,{contentType:'image/jpeg',upsert:true});
    if(up) throw new Error('upload '+up.message);
    const {error:ud}=await sb.from('debug_reports').update({screenshot_path:path, screenshot_b64:null}).eq('id',r.id);
    if(ud) throw new Error('update '+ud.message);
    ok++;
  }catch(e){console.log('FAIL',r.id,e.message);fail++;}
}
console.log(`done ok=${ok} fail=${fail}`);
