import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const p=b.contexts()[0].pages()[0];
const r=await p.evaluate(()=>{
  let prof=null; try{prof=JSON.parse(localStorage.getItem('saha-profile-cache')||'null');}catch{}
  let auth=null; try{const a=JSON.parse(localStorage.getItem('parla-shared-auth')||'null');auth=a?.user?.email||a?.currentSession?.user?.email||null;}catch{}
  return {email:auth, profile:prof};
});
console.log(JSON.stringify(r).slice(0,400));
await b.close();
