import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('tests/device/shots/plasiyer',{recursive:true});
const ORIGIN='https://localhost';
const route=process.argv[2]||'/';
const shot=process.argv[3]||route.replace(/[/:?=*]/g,'_').replace(/^_/,'')||'home';
const noshot=process.argv[4]==='noshot';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const errs=[],net=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
page.on('pageerror',e=>errs.push('PAGEERR '+e.message.slice(0,160)));
page.on('response',r=>{if(r.status()>=400&&r.url().startsWith('http'))net.push(`${r.status()} ${r.url().slice(8,90)}`);});
const onOrigin=page.url().startsWith(ORIGIN);
if(onOrigin) await page.evaluate(x=>{history.pushState({},'',x);dispatchEvent(new PopStateEvent('popstate'));},route);
else await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded',timeout:18000});
await page.waitForTimeout(2600);
if(!noshot){ try{await page.screenshot({path:`tests/device/shots/plasiyer/${shot}.png`,timeout:6000});}catch(e){console.log('!shot',e.message.slice(0,30));} }
const info=await page.evaluate(()=>({
  url:location.pathname+location.search,
  txt:document.body.innerText.replace(/\s+/g,' ').trim().slice(0,400),
  btns:[...document.querySelectorAll('button,a[role=button],[role=tab]')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,30),
  inputs:[...document.querySelectorAll('input,select,textarea')].map(i=>i.placeholder||i.name||i.type).slice(0,20),
}));
console.log('URL',info.url);
console.log('TXT',info.txt);
console.log('BTN',JSON.stringify(info.btns));
console.log('INP',JSON.stringify(info.inputs));
if(errs.length)console.log('ERR',JSON.stringify([...new Set(errs)].slice(0,4)));
if(net.length)console.log('NET',JSON.stringify([...new Set(net)].slice(0,4)));
await b.close();
