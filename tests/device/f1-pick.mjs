import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const net=[];
page.on('response',r=>{if(r.status()>=400&&r.url().startsWith('http'))net.push(`${r.status()} ${r.url().slice(8,90)}`);});
const sels=page.locator('select');
await sels.nth(0).selectOption({label:'Ankara'});
await page.waitForTimeout(1500);
// district options
const dopts=await page.evaluate(()=>[...document.querySelectorAll('select')][1] ? [...document.querySelectorAll('select')][1].options : []);
await sels.nth(1).selectOption({label:'Altındağ'}).catch(async e=>{console.log('altindag label fail, opts:'); const o=await page.evaluate(()=>[...[...document.querySelectorAll('select')][1].options].map(x=>x.text)); console.log(JSON.stringify(o));});
await page.waitForTimeout(3500);
const txt=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,600));
console.log('LIST:',txt);
if(net.length)console.log('NET',JSON.stringify([...new Set(net)].slice(0,4)));
await b.close();
