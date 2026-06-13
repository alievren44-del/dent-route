import { chromium } from '@playwright/test';
const EMAIL=process.argv[2], PASS=process.argv[3];
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,150));});
await page.goto('https://localhost/login',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
await page.locator('input[type=email]').fill(EMAIL);
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button',{name:'Giriş Yap'}).click();
await page.waitForTimeout(4000);
const out=await page.evaluate(()=>{
  let p=null; try{p=JSON.parse(localStorage['saha-profile-cache']||'null');}catch(e){}
  return {url:location.href, role:p?.profile?.role, email:p?.profile?.email, snip:document.body.innerText.replace(/\s+/g,' ').slice(0,120)};
});
console.log('RESULT',JSON.stringify(out));
if(errs.length) console.log('ERRS',errs.slice(0,3));
await b.close();
