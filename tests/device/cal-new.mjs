import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const net=[],errs=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,140));});
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/saha_reminders/i.test(r.url())))net.push(`${r.status()} ${r.request().method()} ${r.url().slice(40,80)}`);});
await page.evaluate(()=>{history.pushState({},'','/takvim');dispatchEvent(new PopStateEvent('popstate'));});
await page.waitForTimeout(2500);
const top=await page.evaluate(()=>({btns:[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,12)}));
console.log('TOP BTNS:',JSON.stringify(top.btns));
// click Ay
await page.getByRole('button',{name:'Ay',exact:true}).click().catch(e=>console.log('!ay'));
await page.waitForTimeout(1500);
const month=await page.evaluate(()=>({hasGrid:/Pt.*Sa.*Ça.*Pe.*Cu.*Ct.*Pz/.test(document.body.innerText),monthLabel:document.body.innerText.match(/(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s*\d{4}/)?.[0]}));
console.log('MONTH:',JSON.stringify(month));
// open Ekle modal
await page.getByRole('button',{name:'Ekle',exact:true}).first().click().catch(e=>console.log('!ekle'));
await page.waitForTimeout(1200);
const modal=await page.evaluate(()=>({title:document.body.innerText.includes('Takvime Ekle'),types:[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(t=>/Randevu|Tahsilat|Tanıtım|Tekrar|Genel Görev/.test(t))}));
console.log('MODAL:',JSON.stringify(modal));
await page.screenshot({path:'tests/device/shots/plasiyer/cal-add-modal.png',timeout:7000}).catch(()=>console.log('!shot'));
console.log('NET',JSON.stringify(net));if(errs.length)console.log('ERR',JSON.stringify([...new Set(errs)].slice(0,3)));
await b.close();
