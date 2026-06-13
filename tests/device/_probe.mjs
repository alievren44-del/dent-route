import { chromium } from '@playwright/test';
const b=await chromium.connectOverCDP('http://localhost:9222');
const ctx=b.contexts()[0]; const page=ctx.pages()[0];
console.log('URL:', page.url());
const info=await page.evaluate(async()=>{
  let sb=null;
  try{ for(const k in localStorage){ if(k.includes('auth-token')){ sb=JSON.parse(localStorage[k]); break; } } }catch(e){}
  return {
    title:document.title,
    bodyLen:document.body?.innerText?.length||0,
    snip:document.body?.innerText?.replace(/\s+/g,' ').slice(0,120),
    user: sb?.user?.email||sb?.user?.id||null,
  };
});
console.log(JSON.stringify(info,null,2));
await b.close();
