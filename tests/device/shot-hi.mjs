import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
await page.evaluate(()=>{history.pushState({},'','/takvim');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2500);
try{await page.screenshot({path:'tests/device/shots/plasiyer/final-takvim2.png',timeout:14000,animations:'disabled'});console.log('shot ok');}catch(e){console.log('!shot',e.message.slice(0,40));}
await b.close();
