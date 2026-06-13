import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const net=[],errs=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,140));});
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/optimize|directions|route|mapbox/i.test(r.url())))net.push(`${r.status()} ${r.url().slice(8,70)}`);});
// go discover, clear search, add 3 clinics to basket
await page.evaluate(()=>{history.pushState({},'','/clinics/discover');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2000);
await page.locator('input').first().fill('');
await page.waitForTimeout(1500);
const added=await page.evaluate(()=>{
  const btns=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Ekle');
  let n=0; for(const b of btns.slice(0,4)){ b.click(); n++; }
  return n;
});
console.log('clicked Ekle x',added);
await page.waitForTimeout(1500);
// go to route plan
await page.evaluate(()=>{history.pushState({},'','/routes/plan');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(3000);
const info=await page.evaluate(()=>({url:location.pathname,txt:document.body.innerText.replace(/\s+/g,' ').slice(0,500),btns:[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,20)}));
console.log('PLAN URL',info.url);console.log('TXT',info.txt);console.log('BTN',JSON.stringify(info.btns));
await page.screenshot({path:'tests/device/shots/plasiyer/f2-route-plan.png',timeout:6000}).catch(e=>console.log('!shot'));
if(net.length)console.log('NET',JSON.stringify([...new Set(net)].slice(0,5)));
if(errs.length)console.log('ERR',JSON.stringify([...new Set(errs)].slice(0,3)));
await b.close();
