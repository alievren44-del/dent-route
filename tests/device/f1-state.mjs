import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
const d=await page.evaluate(()=>{
  const sels=[...document.querySelectorAll('select')];
  const cards=document.body.innerText.match(/\d+\s*\/?\s*\d*\s*klinik/);
  return {
    selVals:sels.map(s=>s.options[s.selectedIndex]?.text),
    distOpts:sels[1]?[...sels[1].options].map(o=>o.text).slice(0,15):[],
    klinikLine:cards?cards[0]:'',
    hasTamer:document.body.innerText.includes('Tamer'),
  };
});
console.log(JSON.stringify(d,null,2));
await b.close();
