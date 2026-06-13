import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
const out=await page.evaluate(async()=>{
  const keys=Object.keys(localStorage);
  let auth={};
  for(const k of keys){ const v=localStorage[k]; if(/auth|token|user|sb-|supabase|saha/i.test(k)) auth[k]=v.slice(0,300); }
  // try supabase getUser via global
  return {keys, auth};
});
console.log('KEYS:', out.keys.join(', '));
console.log('---AUTH---');
for(const [k,v] of Object.entries(out.auth)){ console.log(k,'=>',v.slice(0,200)); }
await b.close();
