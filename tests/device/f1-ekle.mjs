import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const errs=[],net=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
page.on('response',r=>{if(r.url().startsWith('http')&&(r.status()>=400||/cariler|clinic|rpc/i.test(r.url())))net.push(`${r.status()} ${r.request().method()} ${r.url().slice(8,80)}`);});
await page.locator('input').first().fill(''); await page.waitForTimeout(1500);
await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(800);
// find Ekle button inside Tamer card
const clicked=await page.evaluate(()=>{
  const btns=[...document.querySelectorAll('button')];
  for(const btn of btns){
    if(!/Ekle/.test(btn.innerText))continue;
    let c=btn;for(let k=0;k<7&&c;k++){c=c.parentElement;if(c&&/Tamer Sağıroğlu/.test(c.innerText)){btn.scrollIntoView({block:'center'});btn.setAttribute('data-tap','1');return c.innerText.replace(/\s+/g,' ').slice(0,80);}}
  }
  return null;
});
console.log('CARD:',clicked);
if(!clicked){console.log('Tamer Ekle not found');await b.close();process.exit(1);}
await page.waitForTimeout(500);
await page.locator('button[data-tap="1"]').click();
await page.waitForTimeout(3000);
const after=await page.evaluate(()=>({txt:document.body.innerText.replace(/\s+/g,' ').slice(0,300), modal:!!document.querySelector('[role=dialog],.modal')}));
console.log('AFTER:',JSON.stringify(after));
await page.screenshot({path:'tests/device/shots/plasiyer/f1-ekle.png',timeout:6000}).catch(()=>{});
console.log('NET',JSON.stringify([...new Set(net)].slice(0,6)));
if(errs.length)console.log('ERR',JSON.stringify([...new Set(errs)].slice(0,3)));
await b.close();
