import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
const out=await page.evaluate(async()=>{
  // read auth token sub
  let sub=null;try{const a=JSON.parse(localStorage['parla-shared-auth']);const t=a.access_token.split('.')[1];sub=JSON.parse(atob(t.replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch(e){}
  let prof=null;try{prof=JSON.parse(localStorage['saha-profile-cache']).profile;}catch(e){}
  return {jwt_sub:sub, profile_id:prof?.id, profile_role:prof?.role};
});
console.log(JSON.stringify(out,null,1));
await b.close();
