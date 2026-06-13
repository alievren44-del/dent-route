import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const res=await page.evaluate(async()=>{
  let sw=0,cc=0;
  try{ const regs=await navigator.serviceWorker.getRegistrations(); sw=regs.length; for(const r of regs) await r.unregister(); }catch(e){}
  try{ const keys=await caches.keys(); cc=keys.length; for(const k of keys) await caches.delete(k); }catch(e){}
  return {sw,cc};
});
console.log('unregistered SW:',res.sw,'cleared caches:',res.cc);
await page.waitForTimeout(500);
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(4000);
const info=await page.evaluate(()=>({hasBanner:document.body.innerText.includes('vertical: dental'),hasDebug:/Debug\s*\d/.test(document.body.innerText),snip:document.body.innerText.replace(/\s+/g,' ').slice(0,90)}));
console.log(JSON.stringify(info));
await b.close();
