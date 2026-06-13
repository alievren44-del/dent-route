import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const net=[],errs=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,150));});
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/saha_visits/i.test(r.url())))net.push(`${r.status()} ${r.request().method()} ${r.url().slice(40,90)}`);});
// dump form controls
const ctl=await page.evaluate(()=>({btns:[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean),inputs:[...document.querySelectorAll('input,textarea,select')].map(i=>i.placeholder||i.name||i.type)}));
console.log('BTN',JSON.stringify(ctl.btns.slice(0,25)));
console.log('INP',JSON.stringify(ctl.inputs));
// select outcome Görüşüldü
await page.getByText('Görüşüldü',{exact:true}).first().click().catch(e=>console.log('!gor',e.message.slice(0,30)));
await page.waitForTimeout(600);
// fill notes textarea if present
const ta=page.locator('textarea').first();
if(await ta.count()) await ta.fill('Test ziyaret notu — CDP otomasyon. Hekim ilgili, numune talep etti.');
await page.waitForTimeout(500);
// find save button
const saveTxt=ctl.btns.find(t=>/Kaydet|Tamamla|Bitir|Ziyareti/i.test(t));
console.log('saveBtn?',saveTxt);
await page.screenshot({path:'tests/device/shots/plasiyer/f3-visit-filled.png',timeout:6000}).catch(()=>console.log('!shot'));
await b.close();
