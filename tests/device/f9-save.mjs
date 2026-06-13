import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const net=[];
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/saha_visits|saha_reminders/i.test(r.url())))net.push(`${r.status()} ${r.request().method()} ${r.url().slice(40,80)}`);});
await page.getByText('Görüşüldü',{exact:true}).first().click().catch(()=>{});
// appointment datetime-local
const dt=page.locator('input[type="datetime-local"]').first();
await dt.fill('2026-06-20T14:30');
await page.waitForTimeout(400);
// appt note appears
const noteInp=page.locator('input[placeholder*="Randevu notu"]').first();
if(await noteInp.count()) await noteInp.fill('Dolgu kontrolü randevusu');
await page.waitForTimeout(300);
await page.getByRole('button',{name:/Check-out \+ Kaydet/}).click();
await page.waitForTimeout(4000);
console.log('after save url',page.url().slice(8,40));
console.log('NET',JSON.stringify([...new Set(net)]));
await b.close();
