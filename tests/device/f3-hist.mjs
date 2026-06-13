import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
// navigate away then back to force refetch
await page.evaluate(()=>{history.pushState({},'','/clinics');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(1500);
await page.evaluate(()=>{history.pushState({},'','/history');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2500);
let txt=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,300));
console.log('BUGUN:',txt);
// click Tümü filter
await page.getByText('Tümü',{exact:true}).first().click().catch(()=>{});
await page.waitForTimeout(2000);
txt=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,300));
console.log('TUMU:',txt);
await page.screenshot({path:'tests/device/shots/plasiyer/f3-history.png',timeout:6000}).catch(()=>console.log('!shot'));
await b.close();
