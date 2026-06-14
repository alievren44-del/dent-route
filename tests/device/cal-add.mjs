import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const net=[];
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/saha_reminders/i.test(r.url())))net.push(`${r.status()} ${r.request().method()} ${r.url().slice(40,75)}`);});
// modal should be open; select Tahsilat
await page.getByRole('button',{name:'Tahsilat Randevusu'}).click().catch(e=>console.log('!tahsilat'));
await page.waitForTimeout(400);
await page.locator('input[type="datetime-local"]').first().fill('2026-06-25T11:00');
await page.locator('#ar-title').fill('Aylık tahsilat ziyareti (test)');
await page.waitForTimeout(300);
await page.getByRole('button',{name:'Takvime Ekle'}).click();
await page.waitForTimeout(3000);
const after=await page.evaluate(()=>({modalGone:!document.body.innerText.includes('Takvime Ekle'),txt:document.body.innerText.replace(/\s+/g,' ').slice(0,200)}));
console.log('AFTER:',JSON.stringify(after));
console.log('NET',JSON.stringify(net));
await b.close();
