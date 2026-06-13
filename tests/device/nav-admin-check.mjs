import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const p=b.contexts()[0].pages()[0];
for(const path of ['/admin/users','/admin/audit-logs','/admin/stock']){
  await p.evaluate(x=>{history.pushState({},'',x);dispatchEvent(new PopStateEvent('popstate'));},path);
  await p.waitForTimeout(2600);
  const t=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,220));
  console.log(`\n=== ${path} ===\n${t}`);
}
await b.close();
