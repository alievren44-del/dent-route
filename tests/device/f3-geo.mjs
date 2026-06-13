import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const ctx=b.contexts()[0];
const page=ctx.pages()[0];
page.setDefaultTimeout(12000);
// try CDP geolocation override to Tamer coords
const session=await ctx.newCDPSession(page);
try{
  await session.send('Browser.grantPermissions',{permissions:['geolocation']}).catch(()=>{});
}catch(e){}
await session.send('Emulation.setGeolocationOverride',{latitude:39.920757,longitude:32.852778,accuracy:20});
console.log('geo override set to Tamer');
await page.evaluate(()=>{history.pushState({},'','/visits/check-in/d0825993-c211-4fb1-b054-db39ce9472ac');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(4000);
const info=await page.evaluate(()=>({url:location.pathname,txt:document.body.innerText.replace(/\s+/g,' ').slice(0,350),btns:[...document.querySelectorAll('button')].map(b=>({t:b.innerText.trim(),dis:b.disabled})).filter(x=>x.t)}));
console.log('URL',info.url);console.log('TXT',info.txt);console.log('BTN',JSON.stringify(info.btns));
await page.screenshot({path:'tests/device/shots/plasiyer/f3-checkin-page.png',timeout:6000}).catch(e=>console.log('!shot'));
await b.close();
