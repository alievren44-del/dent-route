import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
// /history — should NOT crash
await page.evaluate(()=>{history.pushState({},'','/history');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2500);
let h=await page.evaluate(()=>({crash:document.body.innerText.includes('ters gitti')||document.body.innerText.includes('is not a function'),txt:document.body.innerText.replace(/\s+/g,' ').slice(0,160)}));
console.log('HISTORY crash?',h.crash,'|',h.txt);
// Tümü tab
await page.getByText('Tümü',{exact:true}).first().click().catch(()=>{});
await page.waitForTimeout(1500);
let t=await page.evaluate(()=>({crash:document.body.innerText.includes('is not a function'),txt:document.body.innerText.replace(/\s+/g,' ').slice(0,180)}));
console.log('HISTORY Tümü crash?',t.crash,'|',t.txt);
// /takvim Yaklaşan
await page.evaluate(()=>{history.pushState({},'','/takvim');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2000);
await page.getByText('Yaklaşan',{exact:true}).first().click().catch(()=>{});
await page.waitForTimeout(2000);
let c=await page.evaluate(()=>({txt:document.body.innerText.replace(/\s+/g,' ').slice(0,400),actions:[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(x=>/saat|Yarın|Tamamlandı|Ara|WhatsApp/.test(x))}));
console.log('TAKVIM:',c.txt);
console.log('ACTIONS:',JSON.stringify([...new Set(c.actions)]));
await page.screenshot({path:'tests/device/shots/plasiyer/final-takvim.png',timeout:7000}).catch(()=>console.log('!shot'));
await b.close();
