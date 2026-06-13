import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
const logs=[];
page.on('console',m=>{const t=m.text();if(/hatırlatma|reminder|local|notif|schedul/i.test(t))logs.push(m.type()+': '+t.slice(0,120));});
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(6000);
console.log('LOGS:',JSON.stringify(logs.slice(0,8),null,1));
// check pending via injecting (LocalNotifications not in webview JS, skip). Just confirm no errors.
const errs=await page.evaluate(()=>'');
await b.close();
