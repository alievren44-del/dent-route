import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const net=[];
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/saha_reminders/i.test(r.url())))net.push(`${r.status()} ${r.request().method()} ${r.url().slice(40,72)}`);});
// bottom nav labels
const nav=await page.evaluate(()=>[...document.querySelectorAll('nav a')].map(a=>a.innerText.trim()).filter(Boolean));
console.log('BOTTOM NAV:',JSON.stringify(nav));
// open Ekle, add appointment self
await page.getByRole('button',{name:'Ekle',exact:true}).first().click();
await page.waitForTimeout(800);
await page.locator('input[type="datetime-local"]').first().fill('2026-06-22T10:00');
await page.locator('#ar-title').fill('Self test randevu');
await page.getByRole('button',{name:'Takvime Ekle'}).click();
await page.waitForTimeout(3000);
const after=await page.evaluate(()=>({modalGone:!document.body.innerText.includes('Takvime Ekle'),txt:document.body.innerText.replace(/\s+/g,' ').slice(0,180)}));
console.log('AFTER ADD:',JSON.stringify(after));
console.log('NET',JSON.stringify(net));
await b.close();
