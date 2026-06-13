import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
await page.evaluate(()=>{history.pushState({},'','/history');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2500);
// Bugün tab
await page.getByText('Bugün',{exact:true}).first().click().catch(()=>{});
await page.waitForTimeout(2000);
let t=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,250));
console.log('BUGUN:',t);
await b.close();
