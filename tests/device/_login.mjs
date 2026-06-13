import { chromium } from '@playwright/test';
const EMAIL=process.argv[2], PASS=process.argv[3];
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
// logout: clear auth + go login
await page.evaluate(()=>{ try{ localStorage.removeItem('parla-shared-auth'); localStorage.removeItem('saha-profile-cache'); }catch(e){} });
await page.goto('https://localhost/login',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
const dump=await page.evaluate(()=>{
  const ins=[...document.querySelectorAll('input')].map(i=>({type:i.type,name:i.name,ph:i.placeholder,id:i.id}));
  const btns=[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean);
  return {url:location.href, ins, btns, snip:document.body.innerText.replace(/\s+/g,' ').slice(0,150)};
});
console.log(JSON.stringify(dump,null,2));
await b.close();
