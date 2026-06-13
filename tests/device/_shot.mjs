import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('tests/device/shots/plasiyer',{recursive:true});
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
const name=process.argv[2]||'shot';
try{await page.screenshot({path:`tests/device/shots/plasiyer/${name}.png`,timeout:6000});}catch(e){console.log('shot timeout',e.message.slice(0,40));}
const t=await page.evaluate(()=>document.body?.innerText?.replace(/\s+/g,' ').slice(0,200));
console.log('URL',page.url());console.log('TXT',t);
await b.close();
