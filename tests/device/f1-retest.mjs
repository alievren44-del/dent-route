import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
// ensure manual+Ankara+Altindag set; check current selects
const sv=await page.evaluate(()=>[...document.querySelectorAll('select')].map(s=>s.options[s.selectedIndex]?.text));
console.log('selects now:',JSON.stringify(sv));
// type Tamer
const inp=page.locator('input').first();
await inp.fill(''); await page.waitForTimeout(1200);
await inp.fill('Tamer'); await page.waitForTimeout(2500);
let d=await page.evaluate(()=>({count:document.body.innerText.match(/\d+\s*\/\s*\d+\s*klinik/)?.[0], firstCard:[...document.querySelectorAll('button')].find(b=>/Ekle/.test(b.innerText))?(()=>{let c=[...document.querySelectorAll('button')].find(b=>/Ekle/.test(b.innerText));for(let k=0;k<7&&c;k++){c=c.parentElement;if(c&&c.innerText.length>40&&c.innerText.length<300)return c.innerText.replace(/\s+/g,' ').slice(0,80);}return'';})():''}));
console.log('search Tamer:',JSON.stringify(d));
// now check basket store
const basket=await page.evaluate(()=>{try{const z=JSON.parse(localStorage['route-basket']||localStorage['routeBasket']||'null');return z;}catch(e){return 'n/a';}});
console.log('basket LS:',JSON.stringify(basket)?.slice(0,200));
await b.close();
