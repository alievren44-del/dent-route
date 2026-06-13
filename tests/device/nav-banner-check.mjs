import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const p=b.contexts()[0].pages()[0];
await p.waitForTimeout(1500);
const r=await p.evaluate(()=>({banner:/vertical:/.test(document.body.innerText), debug:/Debug/.test(document.body.innerText), top:document.body.innerText.replace(/\s+/g,' ').slice(0,80)}));
console.log('BANNER/DEBUG:', JSON.stringify(r));
await b.close();
