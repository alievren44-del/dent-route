import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('tests/device/shots', { recursive: true });
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0].pages()[0];
await page.waitForTimeout(800);
console.log('URL:', page.url(), '| TITLE:', await page.title());
const dom = await page.evaluate(() => {
  const inputs=[...document.querySelectorAll('input')].map(i=>({type:i.type,name:i.name,ph:i.placeholder,id:i.id}));
  const btns=[...document.querySelectorAll('button')].map(b=>b.innerText.trim().slice(0,24)).filter(Boolean);
  const lsKeys=Object.keys(localStorage);
  return { body: document.body.innerText.replace(/\s+/g,' ').slice(0,250), inputs, btns, lsKeys };
});
console.log(JSON.stringify(dom,null,2));
await page.screenshot({ path:'tests/device/shots/nav-home.png' });
await browser.close();
