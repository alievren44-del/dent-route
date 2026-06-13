import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
await page.evaluate(()=>{history.pushState({},'','/clinics/discover');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(1800);
await page.getByText('İl / İlçe seç',{exact:false}).first().click();
await page.waitForTimeout(1500);
const d=await page.evaluate(()=>({
  txt:document.body.innerText.replace(/\s+/g,' ').slice(0,300),
  selects:[...document.querySelectorAll('select')].map(s=>({n:s.name,opts:[...s.options].map(o=>o.text).slice(0,8)})),
  inputs:[...document.querySelectorAll('input')].map(i=>i.placeholder),
}));
console.log(JSON.stringify(d,null,2));
await page.screenshot({path:'tests/device/shots/plasiyer/f1-region.png',timeout:6000}).catch(()=>{});
await b.close();
