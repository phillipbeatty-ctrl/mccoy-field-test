// McCoy Field Coach V9.2 admin-only lead-source connection panel.
// SPOTIO is no longer used; leads now come from TERROS. Kept rather than
// deleted per instruction, in case a direct TERROS API connection is ever
// needed -- for now, TERROS leads are expected to arrive via CSV export/
// import instead, so this panel's "save credentials" step is not yet wired
// to any real external API for either provider (it never was for SPOTIO
// either -- it only ever stored credentials and displayed a status).
(function(){
  const css=document.createElement('style');
  css.textContent=`#spotioConnectBtn{display:none;border:0;border-radius:999px;padding:9px 13px;background:#facc15;color:#111827;font-size:12px;font-weight:700;cursor:pointer;margin-top:10px}#spotioConnectPanel{position:fixed;inset:0;z-index:140002;background:rgba(17,24,39,.78);display:none;align-items:center;justify-content:center;padding:16px}#spotioConnectPanel.show{display:flex}.spotio-card{width:min(560px,100%);background:#fff;border-radius:16px;padding:20px}.spotio-card input{box-sizing:border-box;width:100%;padding:12px;margin:6px 0;border:1px solid #d1d5db;border-radius:10px;font-size:16px}.spotio-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.spotio-status{padding:10px;border-radius:10px;background:#f3f4f6;margin:10px 0;font-size:13px}`;
  document.head.appendChild(css);
  async function spotio(action,payload={}){const {data,error}=await sb.functions.invoke('spotio-admin',{body:{action,...payload}});if(error)throw error;return data;}
  function ensure(){
    if(document.getElementById('spotioConnectBtn'))return;
    const btn=document.createElement('button');btn.id='spotioConnectBtn';btn.textContent='TERROS Connection';(document.querySelector('#settings .card')||document.body).appendChild(btn);
    const panel=document.createElement('div');panel.id='spotioConnectPanel';panel.innerHTML=`<div class="spotio-card"><h2>TERROS Connection</h2><p class="muted">Optional direct API connection to TERROS. Most teams won't need this -- TERROS leads can be exported and uploaded as a CSV file from IMPORT REAL LEADS instead.</p><div id="spotioStatus" class="spotio-status">Checking connection…</div><label>Client ID</label><input id="spotioClientId" autocomplete="off" placeholder="TERROS Client ID"><label>Secret</label><input id="spotioClientSecret" type="password" autocomplete="new-password" placeholder="TERROS Secret"><div class="spotio-actions"><button id="spotioSaveBtn" class="primary">SAVE CONNECTION</button><button id="spotioRefreshBtn" class="assign-btn">REFRESH STATUS</button><button id="spotioCloseBtn" class="assign-btn">CLOSE</button></div><p class="muted small">This only stores credentials and shows a status -- it does not yet verify or sync with TERROS. Use the CSV import instead unless a direct TERROS API connection has since been built.</p></div>`;document.body.appendChild(panel);
    document.getElementById('spotioCloseBtn').onclick=()=>panel.classList.remove('show');
    document.getElementById('spotioRefreshBtn').onclick=load;
    document.getElementById('spotioSaveBtn').onclick=save;
    btn.onclick=async()=>{panel.classList.add('show');await load();};
  }
  async function load(){
    const box=document.getElementById('spotioStatus'); if(!box)return; box.textContent='Checking connection…';
    try{const d=await spotio('status');const s=d?.status||{};if(s.connected)box.textContent=`Connected${s.last_sync_at?' · Last sync '+new Date(s.last_sync_at).toLocaleString():''}`;else if(s.configured)box.textContent='Credentials saved. No live TERROS connection or sync exists yet -- this is just storage.';else box.textContent='Not connected yet.';}catch(e){console.error(e);box.textContent='Unable to check the connection status.';}
  }
  async function save(){
    const b=document.getElementById('spotioSaveBtn'),id=document.getElementById('spotioClientId').value.trim(),secret=document.getElementById('spotioClientSecret').value.trim(),box=document.getElementById('spotioStatus');
    if(!id||!secret){box.textContent='Enter both Client ID and Secret.';return;}
    b.disabled=true;b.textContent='SAVING…';
    try{await spotio('save_credentials',{client_id:id,client_secret:secret});document.getElementById('spotioClientId').value='';document.getElementById('spotioClientSecret').value='';box.textContent='Credentials saved. No live TERROS connection or sync exists yet -- this is just storage.';}catch(e){console.error(e);box.textContent='Could not save the connection.';}finally{b.disabled=false;b.textContent='SAVE CONNECTION';}
  }
  const t=setInterval(()=>{if(window.MCCOY_ACCESS?.access?.role==='admin'){ensure();document.getElementById('spotioConnectBtn').style.display='block';clearInterval(t);}},400);
})();