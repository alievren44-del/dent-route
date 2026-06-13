import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
const info=await page.evaluate(()=>{
  let p=null;try{p=JSON.parse(localStorage['saha-profile-cache']||'null');}catch(e){}
  return {url:location.href, role:p?.profile?.role, email:p?.profile?.email,
    hasBanner:document.body.innerText.includes('vertical: dental'),
    hasDebug:/Debug\s*\d/.test(document.body.innerText),
    snip:document.body.innerText.replace(/\s+/g,' ').slice(0,100)};
});
console.log(JSON.stringify(info,null,2));
await b.close();
