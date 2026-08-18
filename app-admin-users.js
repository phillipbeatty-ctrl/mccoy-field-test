// McCoy Field Coach V9.2 admin user management.
(function(){
  const css=document.createElement('style');
  css.textContent=`#userAdminBtn{position:fixed;right:14px;bottom:58px;z-index:2600;display:none;border:0;border-radius:999px;padding:9px 13px;background:#374151;color:#fff;font-size:12px;cursor:pointer}#userAdminPanel{position:fixed;inset:0;z-index:140001;background:rgba(17,24,39,.78);display:none;align-items:center;justify-content:center;padding:16px}#userAdminPanel.show{display:flex}.user-admin-card{width:min(860px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:20px}.user-admin-row{padding:12px 0;border-top:1px solid #eef0f2}.user-admin-grid{display:grid;grid-template-columns:1.1fr 1fr 1.2fr auto;gap:8px;align-items:center}@media(max-width:700px){.user-admin-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(css);
  async function onboarding(action,payload={}){const {data,error}=await sb.functions.invoke('rep-onboarding',{body:{action,...payload}});if(error)throw error;return data;}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function ensurePanel(){
    if(document.getElementById('userAdminBtn')) return;
    const btn=document.createElement('button');btn.id='userAdminBtn';btn.textContent='Users & Managers';document.body.appendChild(btn);
    const panel=document.createElement('div');panel.id='userAdminPanel';panel.innerHTML=`<div class="user-admin-card"><h2>Users & Managers</h2><p class="muted">Approve users first, then set Manager roles and assign reps here.</p><div id="userAdminNotice" class="muted small"></div><div id="userAdminBody">Loading…</div><div style="text-align:right;margin-top:12px"><button id="userAdminClose" class="assign-btn">Close</button></div></div>`;document.body.appendChild(panel);
    document.getElementById('userAdminClose').onclick=()=>panel.classList.remove('show');
    btn.onclick=async()=>{panel.classList.add('show');await loadUsers();};
  }
  async function loadUsers(){
    const root=document.getElementById('userAdminBody'),notice=document.getElementById('userAdminNotice');root.textContent='Loading…';notice.textContent='';
    try{
      const d=await onboarding('list_users'); const users=d?.users||[]; const managers=users.filter(u=>u.role==='manager'&&u.active);
      if(!managers.length) notice.textContent='No active Manager accounts exist yet. Approve a user, then change that user’s role to Manager here. After that, the manager will be available for rep assignment.';
      root.innerHTML=users.map((u,i)=>`<div class="user-admin-row"><div><strong>${esc(u.display_name||u.email)}</strong><div class="muted small">${esc(u.email)}</div></div><div class="user-admin-grid"><select id="uaRole${i}" ${u.role==='admin'?'disabled':''}><option value="rep" ${u.role==='rep'?'selected':''}>Rep</option><option value="manager" ${u.role==='manager'?'selected':''}>Manager</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select><select id="uaTeam${i}"><option value="">No team</option><option ${u.team_name==='Pacific Northwest'?'selected':''}>Pacific Northwest</option><option ${u.team_name==='North Carolina'?'selected':''}>North Carolina</option></select><select id="uaMgr${i}" ${u.role!=='rep'?'disabled':''}><option value="">No manager</option>${managers.filter(m=>m.email!==u.email).map(m=>`<option value="${esc(m.email)}" ${u.assigned_manager_email===m.email?'selected':''}>${esc(m.display_name||m.email)}</option>`).join('')}</select><button id="uaSave${i}" class="primary">Save</button></div></div>`).join('');
      users.forEach((u,i)=>{const role=document.getElementById('uaRole'+i),mgr=document.getElementById('uaMgr'+i);if(role)role.onchange=()=>{mgr.disabled=role.value!=='rep';if(role.value!=='rep')mgr.value='';};document.getElementById('uaSave'+i).onclick=async()=>{const b=document.getElementById('uaSave'+i);b.disabled=true;b.textContent='Saving…';try{await onboarding('update_user',{email:u.email,role:role.value,team_name:document.getElementById('uaTeam'+i).value,assigned_manager_email:mgr.value});await loadUsers();}catch(e){console.error(e);b.disabled=false;b.textContent='Save';alert('Unable to update this user.');}};});
    }catch(e){console.error(e);root.textContent='Unable to load users.';}
  }
  function activateIfAdmin(){if(window.MCCOY_ACCESS?.access?.role==='admin'){ensurePanel();document.getElementById('userAdminBtn').style.display='block';}}
  const t=setInterval(()=>{activateIfAdmin();if(window.MCCOY_ACCESS?.access?.role==='admin')clearInterval(t);},500);
})();