import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const ORIGIN='https://localhost';
const routes=readFileSync(process.argv[2],'utf8').split('\n').map(s=>s.trim()).filter(Boolean);
mkdirSync('tests/device/shots/nav',{recursive:true});
const browser=await chromium.connectOverCDP('http://localhost:9222');
const page=browser.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const report=[]; let errs=[],net=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
page.on('pageerror',e=>errs.push('PAGEERR '+e.message.slice(0,200)));
page.on('response',r=>{if(r.status()>=400&&r.url().startsWith('http'))net.push(`${r.status()} ${r.url().slice(8,80)}`);});
page.on('requestfailed',r=>{const u=r.url();if(u.startsWith('http'))net.push(`${r.failure()?.errorText} ${u.slice(8,70)}`);});
const onOrigin=()=>page.url().startsWith(ORIGIN);
for(const p of routes){
  errs=[];net=[];
  try{
    if(onOrigin()) await page.evaluate(x=>{history.pushState({},'',x);dispatchEvent(new PopStateEvent('popstate'));},p);
    else await page.goto(ORIGIN+p,{waitUntil:'domcontentloaded',timeout:18000});
  }catch(e){report.push({p,nav:'fail '+e.message.slice(0,60)});continue;}
  await page.waitForTimeout(2200);
  const name=p.replace(/[/:?=*]/g,'_').replace(/^_/,'')||'home';
  try{await page.screenshot({path:`tests/device/shots/nav/${name}.png`,timeout:6000});}catch{}
  const final=page.url().replace(ORIGIN,'');
  const txt=await page.evaluate(()=>document.body?.innerText?.replace(/\s+/g,' ').slice(0,90)||'').catch(()=> '');
  report.push({p,final,redir:final.split('?')[0]!==p.split('?')[0],errs:[...new Set(errs)],net:[...new Set(net)],blank:txt.replace(/\s/g,'').length<8,snip:txt});
}
writeFileSync('tests/device/shots/nav/report.json',JSON.stringify(report,null,2));
for(const r of report){
  if(r.nav){console.log(`✗ ${r.p} ${r.nav}`);continue;}
  const f=[];if(r.blank)f.push('BLANK');if(r.redir)f.push('->'+r.final);if(r.errs?.length)f.push(r.errs.length+'err');if(r.net?.length)f.push(r.net.length+'net');
  console.log(`${f.length?'⚠ ':'  '}${r.p}  ${f.join(' ')}`);
  (r.errs||[]).slice(0,2).forEach(e=>console.log('     err:',e));
  (r.net||[]).slice(0,2).forEach(e=>console.log('     net:',e));
}
await browser.close();
