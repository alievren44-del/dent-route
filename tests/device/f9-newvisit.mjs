import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const ctx=b.contexts()[0];const page=ctx.pages()[0];
page.setDefaultTimeout(12000);
const net=[],errs=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,140));});
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/saha_visits/i.test(r.url())))net.push(`${r.status()} ${r.request().method()} ${r.url().slice(40,85)}`);});
const s=await ctx.newCDPSession(page);
await s.send('Emulation.setGeolocationOverride',{latitude:39.920757,longitude:32.852778,accuracy:15});
await page.evaluate(()=>{history.pushState({},'','/visits/check-in/d0825993-c211-4fb1-b054-db39ce9472ac');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(3000);
// verify Not Ekle button present (new UI)
const hasNot=await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>/Not Ekle/.test(b.innerText)));
console.log('CheckIn has "Not Ekle":',hasNot);
await page.getByRole('button',{name:/Check-in Yap/}).click();
await page.waitForTimeout(3500);
console.log('visit url',page.url().slice(8));
// on visit form: check new Hatırlatma section
const form=await page.evaluate(()=>({
  hasHatirlatma:document.body.innerText.includes('Hatırlatma / Randevu'),
  hasTekrar:document.body.innerText.includes('Tekrar Ziyaret Tarihi'),
  hasRandevu:document.body.innerText.includes('Hekimden Randevu'),
  inputs:[...document.querySelectorAll('input')].map(i=>i.type),
}));
console.log('VisitForm:',JSON.stringify(form));
console.log('NET',JSON.stringify([...new Set(net)]));
if(errs.length)console.log('ERR',JSON.stringify([...new Set(errs)].slice(0,3)));
await b.close();
