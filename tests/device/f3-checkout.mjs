import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const net=[],errs=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,150));});
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/saha_visits/i.test(r.url())))net.push(`${r.status()} ${r.request().method()} ${r.url().slice(40,90)}`);});
// re-select outcome (state may persist) + ensure note
await page.getByText('Görüşüldü',{exact:true}).first().click().catch(()=>{});
const ta=page.locator('textarea').first();
if(await ta.count()) await ta.fill('Test ziyaret notu — CDP. Hekim ilgili.');
await page.waitForTimeout(400);
await page.getByRole('button',{name:/Check-out \+ Kaydet/}).click();
await page.waitForTimeout(4000);
const info=await page.evaluate(()=>({url:location.pathname,txt:document.body.innerText.replace(/\s+/g,' ').slice(0,200)}));
console.log('URL',info.url);console.log('TXT',info.txt);
console.log('NET',JSON.stringify([...new Set(net)].slice(0,5)));
if(errs.length)console.log('ERR',JSON.stringify([...new Set(errs)].slice(0,3)));
await b.close();
