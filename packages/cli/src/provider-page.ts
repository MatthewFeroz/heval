import harnessCatalog from '../../../src/harness-catalog.json'
import shortlist from '../../../src/runners/model-shortlist.json'

export const DEFAULT_APP_URL = 'https://temporary-rushing-violet-xu17m97.vercel.app'
export function renderProviderPage(selected = ['codex'], appUrl = DEFAULT_APP_URL) { return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Computer setup · Heval</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111;color:#eee}*{box-sizing:border-box}body{margin:0;padding:32px 16px}main{max-width:720px;margin:auto}header{margin-bottom:24px}h1{font-size:24px;line-height:32px;margin:16px 0}h2{font-size:20px}p{line-height:1.5;color:#aaa}section{background:#191919;border:1px solid #333;border-radius:12px;padding:24px;margin:20px 0}label{display:block;margin:16px 0 8px}input,select,button,.button{font:inherit;border-radius:8px;padding:12px}input,select{width:100%;background:#111;color:inherit;border:1px solid #555}button,.button{display:inline-block;background:#eee;color:#111;border:0;cursor:pointer;font-weight:600;margin-top:16px;text-decoration:none}button:disabled{opacity:.5;cursor:wait}.secondary{background:transparent;border:1px solid #555;color:inherit}.key-row{display:flex;gap:8px;align-items:center}.key-row input{min-width:0}.key-row button{margin:0}.harness-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.harness-card{border:1px solid #333;padding:12px;border-radius:8px}.harness-card label{display:flex;align-items:center;gap:8px;margin:0}.harness-card input{width:auto}.harness-card img{object-fit:contain}.harness-card img[src$="codex.svg"]{filter:invert(1)}.harness-card img[src$="deepagents.svg"]{object-fit:cover;object-position:left}.harness-card span{display:block}a{color:inherit}small{display:block;color:#aaa;line-height:1.5;margin-top:8px}[role=status]{white-space:pre-wrap}#error{color:#ffb5aa}:focus-visible{outline:2px solid #eee;outline-offset:3px}[hidden]{display:none!important}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;list-style:none;padding:0;color:#888;font-size:12px}.steps li[aria-current=step]{color:#eee;font-weight:600}@media(max-width:480px){section{padding:16px}.harness-grid{grid-template-columns:1fr}.key-row{flex-wrap:wrap}}
#model-routes{overflow:auto;margin:16px 0}table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}th,td{padding:8px;border-bottom:1px solid #333;white-space:nowrap}caption{text-align:left;color:#aaa;margin-bottom:8px}</style></head><body><main data-app-url="${appUrl}"><header><a href="${appUrl}/machines" rel="noreferrer">heval</a><ol class="steps" aria-label="Setup progress"><li>1 · Machine ?</li><li id="connection-step">2 · Connection</li><li id="provider-step">3 · Provider</li><li>4 · First evaluation</li></ol><h1 id="title">Connect your computer</h1></header>
<p id="error" role="alert"></p><p id="status" role="status" aria-live="polite">Checking this computer…</p>
<section id="pair-section" hidden><h2>Connect to your account</h2><p>Your worker is ready. Connect it to Heval to save your evaluations.</p><a id="authorize" class="button" rel="noreferrer">Connect to Heval</a><button id="retry-pair" hidden>Retry connection</button></section>
<section id="key-section" hidden><h2>Connect Merge Gateway</h2><p>Your key stays on this computer. Verification makes no model calls.</p><form id="connect"><label for="key">Merge Gateway API key</label><div class="key-row"><input id="key" type="password" autocomplete="off" spellcheck="false" required maxlength="4096" placeholder="Paste your key"><button id="show" class="secondary" type="button" aria-pressed="false">Show key</button></div><small><a href="https://gateway.merge.dev/" target="_blank" rel="noreferrer">Get a model-calling key ?</a></small><button id="save" type="submit" disabled>Verify and save</button></form></section>
<section id="profile-section" hidden><h2>Choose your first evaluation</h2><form id="profiles"><label for="model">Model</label><select id="model" required></select><div id="model-routes"></div><fieldset><legend>Harnesses</legend><div class="harness-grid">${harnessCatalog.filter(h=>h.merge).map(h=>`<div class="harness-card"><label><input type="checkbox" name="harness" value="${h.id}" ${selected.includes(h.id)?'checked':''}><img src="/harnesses/${h.logo}" alt="" width="24" height="24"><span>${h.name}</span></label></div>`).join('')}</div></fieldset><p>Start with one harness and one task. You can add more later.</p><button type="submit">Save and continue</button><button id="change-key" type="button" class="secondary">Change key</button></form><p id="profile-status" role="status"></p></section>
<section id="ready-section" hidden><h2>Ready to evaluate</h2><p>Your model and harness are configured.</p><a id="continue" class="button" rel="noreferrer">Continue to first evaluation</a></section>
<small>Keep the setup terminal open until you finish.</small></main><script src="/setup.js"></script></body></html>` }
export const providerPage = renderProviderPage()

export const providerScript = `
const params=new URLSearchParams(location.hash.slice(1));
const token=params.get('token')||sessionStorage.getItem('heval-provider-token');
history.replaceState(null,'','/');
if(token)sessionStorage.setItem('heval-provider-token',token);
const byId=id=>document.getElementById(id);
const app=new URL(document.querySelector('main').dataset.appUrl);
let workerId='';
let modelCatalog=[];
const shortlist=${JSON.stringify(shortlist)};
function showModels(){
 const previous=byId('model').value;
 byId('model').replaceChildren();
 for(const group of [...new Set(shortlist.map(m=>m.group))]){
  const options=document.createElement('optgroup');options.label=group;
  for(const model of shortlist.filter(m=>m.group===group)){
   const available=modelCatalog.some(m=>m.model===model.id);
   const option=new Option(model.name+(available?'':' (unavailable)'),model.id);option.disabled=!available;
   options.append(option);
  }
  byId('model').append(options);
 }
 const available=shortlist.filter(m=>modelCatalog.some(c=>c.model===m.id));
 byId('model').value=available.some(m=>m.id===previous)?previous:available[0]?.id||'';
 showRoutes();
}
function showRoutes(){
 const entry=modelCatalog.find(m=>m.model===byId('model').value);
 const container=byId('model-routes');container.replaceChildren();
 if(!entry?.vendors?.length)return;
 const table=document.createElement('table'),caption=table.createCaption();caption.textContent='Merge rates per 1M tokens. Gateway chooses the route.';
 const header=table.createTHead().insertRow();
 for(const label of ['Provider','Input','Output','Cache read','Context']){const th=document.createElement('th');th.textContent=label;header.append(th);}
 const body=table.createTBody();
 for(const vendor of entry.vendors){const row=body.insertRow();for(const value of [vendor.vendor,...[vendor.inputPerMillion,vendor.outputPerMillion,vendor.cacheReadPerMillion].map(n=>n==null?'Unavailable':'$'+n.toLocaleString('en-US',{maximumFractionDigits:6})),vendor.contextWindow?.toLocaleString('en-US')??'Unavailable'])row.insertCell().textContent=value;}
 container.append(table);
}
byId('model').onchange=showRoutes;
const pendingKey='heval-pending-pair';
if(params.has('pairing'))sessionStorage.setItem(pendingKey,JSON.stringify({code:params.get('pairing'),url:params.get('deployment')}));
const localLink=location.origin+'/#token='+token;
byId('authorize').href=app.origin+'/machines?setup=new#worker='+encodeURIComponent(localLink);
async function api(path,body){
 let response;
 try{response=await fetch(path,{method:body?'POST':'GET',signal:AbortSignal.timeout(path==='/api/heartbeat'?10000:120000),headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
 catch{throw new Error('Setup is unavailable. Rerun the setup command; saved connections are preserved.');}
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Setup request failed.');return result;
}
function showStatus(result){
 const paired=!result.worker||result.worker.paired;
 workerId=result.worker?.id||workerId;
 byId('pair-section').hidden=paired;
 byId('key-section').hidden=!paired||result.connected;
 byId('profile-section').hidden=!paired||!result.connected;
 byId('connection-step').setAttribute('aria-current',paired?'false':'step');
 byId('provider-step').setAttribute('aria-current',paired?'step':'false');
 byId('title').textContent=paired?'Connect your model provider':'Connect your computer';
 byId('status').textContent=paired&&result.worker?'Connected to '+result.worker.name:!paired?'':'Local provider setup';
 modelCatalog=result.models.map(model=>result.catalog?.find(m=>m.model===model)||{model,displayName:model});
 showModels();
 byId('save').disabled=false;
}
async function act(form,action){
 byId('error').textContent='';const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 try{await action();}catch(error){byId('error').textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}
}
async function finishPair(){
 const pending=sessionStorage.getItem(pendingKey);if(!pending)return;
 const result=await api('/api/pair',JSON.parse(pending));workerId=result.id||'';
 sessionStorage.removeItem(pendingKey);byId('retry-pair').hidden=true;showStatus(await api('/api/status'));
}
byId('retry-pair').onclick=()=>void act(byId('pair-section'),finishPair);
byId('change-key').onclick=()=>{byId('key-section').hidden=false;byId('profile-section').hidden=true;byId('key').focus();};
byId('show').onclick=()=>{const visible=byId('key').type==='password';byId('key').type=visible?'text':'password';byId('show').textContent=visible?'Hide key':'Show key';byId('show').setAttribute('aria-pressed',String(visible));};
byId('connect').onsubmit=event=>{event.preventDefault();void act(event.target,async()=>{
 let key=byId('key').value.trim();byId('key').value='';byId('key').type='password';byId('show').textContent='Show key';byId('show').setAttribute('aria-pressed','false');
 try{await api('/api/connect',{key});showStatus(await api('/api/status'));}finally{key='';}
});};
byId('profiles').onsubmit=event=>{event.preventDefault();void act(event.target,async()=>{
 const harnesses=[...document.querySelectorAll('input[name=harness]:checked')].map(input=>input.value);
 if(!harnesses.length)throw new Error('Choose at least one harness.');
 if(!byId('model').value)throw new Error('None of the 11 models is available on this connection.');
 await api('/api/profiles',{model:byId('model').value,harnesses});
 byId('profile-section').hidden=true;byId('ready-section').hidden=false;
 byId('continue').href=app.origin+'/machines?setup=1'+(workerId?'&worker='+encodeURIComponent(workerId):'');
 byId('status').textContent='Provider connected';
});};
if(!token){byId('status').textContent='';byId('error').textContent='Open the complete setup link printed by your terminal.';}
else api('/api/status').then(async result=>{
 showStatus(result);
 if(sessionStorage.getItem(pendingKey)){
  byId('retry-pair').hidden=false;
  await act(byId('pair-section'),finishPair);
 }
}).catch(()=>{byId('status').textContent='';byId('error').textContent='This setup link expired. Rerun setup and open its new link.';});
if(token){const heartbeat=setInterval(()=>void api('/api/heartbeat').catch(error=>{byId('error').textContent=error.message;}),30000);window.addEventListener('pagehide',()=>clearInterval(heartbeat),{once:true});}
`
