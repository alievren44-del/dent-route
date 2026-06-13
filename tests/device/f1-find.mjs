import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const inp=page.locator('input').first();
await inp.fill('');
await page.waitForTimeout(1500);
await inp.fill('Sağıroğlu');
await page.waitForTimeout(2500);
const d=await page.evaluate(()=>{
  // find card containing Tamer
  const all=[...document.querySelectorAll('div')].filter(x=>x.innerText&&x.innerText.includes('Tamer')&&x.innerText.length<400);
  const card=all.sort((a,b)=>a.innerText.length-b.innerText.length)[0];
  return {count:document.body.innerText.match(/\d+\s*\/\s*\d+\s*klinik/)?.[0], card:card?card.innerText.replace(/\s+/g,' '):'NONE'};
});
console.log(JSON.stringify(d,null,2));
await page.screenshot({path:'tests/device/shots/plasiyer/f1-tamer-card.png',timeout:6000}).catch(()=>{});
await b.close();
