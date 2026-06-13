import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
await page.evaluate(()=>{history.pushState({},'','/takvim');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2500);
await page.getByText('Yaklaşan',{exact:true}).first().click().catch(()=>{});
await page.waitForTimeout(2000);
const info=await page.evaluate(()=>({
  txt:document.body.innerText.replace(/\s+/g,' ').slice(0,500),
  btns:[...document.querySelectorAll('button,a')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,30),
}));
console.log('TXT',info.txt);
console.log('ACTIONS',JSON.stringify([...new Set(info.btns)]));
await page.screenshot({path:'tests/device/shots/plasiyer/takvim-yaklasan.png',timeout:7000}).catch(()=>console.log('!shot'));
await b.close();
