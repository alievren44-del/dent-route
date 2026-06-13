import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
await page.evaluate(async()=>{try{const r=await navigator.serviceWorker.getRegistrations();for(const x of r)await x.unregister();const k=await caches.keys();for(const c of k)await caches.delete(c);}catch(e){}});
await page.reload({waitUntil:'networkidle'});
await page.waitForTimeout(3000);
let info=await page.evaluate(()=>({hasBanner:document.body.innerText.includes('vertical: dental'),ctrl:!!navigator.serviceWorker.controller}));
console.log('after reload:',JSON.stringify(info));
if(info.hasBanner){ await page.reload({waitUntil:'networkidle'}); await page.waitForTimeout(2500);
  info=await page.evaluate(()=>({hasBanner:document.body.innerText.includes('vertical: dental'),ctrl:!!navigator.serviceWorker.controller}));
  console.log('after 2nd reload:',JSON.stringify(info));
}
await b.close();
