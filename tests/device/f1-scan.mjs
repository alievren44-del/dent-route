import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const page=b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
// clear search
await page.locator('input').first().fill(''); await page.waitForTimeout(1500);
// scroll to load all, collect card names
let names=new Set();
for(let i=0;i<25;i++){
  const found=await page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('button').forEach(btn=>{
      if(btn.innerText.trim()==='Ekle'||btn.innerText.includes('Ekle')){
        // climb to card
        let c=btn; for(let k=0;k<6&&c;k++){c=c.parentElement; if(c&&c.innerText&&c.innerText.length>40&&c.innerText.length<300){break;}}
        if(c) out.push(c.innerText.replace(/\s+/g,' ').slice(0,70));
      }
    });
    return out;
  });
  found.forEach(n=>names.add(n));
  await page.evaluate(()=>window.scrollBy(0,1400));
  await page.waitForTimeout(500);
}
const arr=[...names];
console.log('TOTAL cards seen:',arr.length);
console.log('Tamer/Sağır match:',arr.filter(n=>/Tamer|Sağ/i.test(n)));
console.log('sample:',arr.slice(0,5));
await b.close();
