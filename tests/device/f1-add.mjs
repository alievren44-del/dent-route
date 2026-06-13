import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const errs=[],net=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
page.on('response',r=>{if(r.status()>=400&&r.url().startsWith('http'))net.push(`${r.status()} ${r.url().slice(8,90)}`);});
// ensure on discover
await page.evaluate(()=>{history.pushState({},'','/clinics/discover');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2000);
const search=page.locator('input').first();
await search.fill('Tamer');
await page.waitForTimeout(3000);
const txt=await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,500));
console.log('AFTER SEARCH:',txt);
await page.screenshot({path:'tests/device/shots/plasiyer/f1-search-tamer.png',timeout:6000}).catch(()=>{});
if(errs.length)console.log('ERR',JSON.stringify([...new Set(errs)].slice(0,3)));
if(net.length)console.log('NET',JSON.stringify([...new Set(net)].slice(0,3)));
await b.close();
