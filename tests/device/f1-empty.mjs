import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const inp=page.locator('input').first();
await inp.fill(''); await page.waitForTimeout(2000);
let d=await page.evaluate(()=>({count:document.body.innerText.match(/\d+\s*\/\s*\d+\s*klinik/)?.[0], body:document.body.innerText.replace(/\s+/g,' ').slice(120,500)}));
console.log('EMPTY:',JSON.stringify(d));
// scroll list down to trigger render
await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
await page.waitForTimeout(1500);
d=await page.evaluate(()=>({count:document.body.innerText.match(/\d+\s*\/\s*\d+\s*klinik/)?.[0], hasTamer:document.body.innerText.includes('Tamer'), bodyTail:document.body.innerText.replace(/\s+/g,' ').slice(-400)}));
console.log('SCROLLED:',JSON.stringify(d));
await b.close();
