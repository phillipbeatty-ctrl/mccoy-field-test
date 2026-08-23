// McCoy Field Coach V9.2 admin user management.
(function(){
  const css=document.createElement('style');
  css.textContent=`#userAdminBtn{display:none!important}#userAdminPanel{display:none;margin-top:14px}#userAdminPanel.show{display:block}.user-admin-card{width:100%;overflow:visible}.user-admin-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.user-admin-heading h2{margin:0}.pending-account-section{margin:16px 0 22px;padding:14px;border:1px solid #f3d28b;border-radius:12px;background:#fffbeb}.pending-account-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.pending-account-heading h3{margin:0}.pending-account-count{padding:4px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:800}.pending-account-list{display:grid;gap:9px;margin-top:12px}.pending-account-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(280px,1.5fr);gap:14px;padding:11px;border:1px solid #fde7b0;border-radius:10px;background:#fff}.pending-account-details{display:grid;gap:3px;font-size:12px;color:#4b5563}.pending-account-state{display:inline-block;width:max-content;margin-bottom:3px;padding:3px 7px;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:800}.pending-account-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:7px}.active-users-heading{margin:0 0 8px}.user-admin-row{padding:12px 0;border-top:1px solid #eef0f2}.user-admin-grid{display:grid;grid-template-columns:minmax(165px,1.4fr) 1fr 1.25fr 1fr 1.25fr auto;gap:8px;align-items:center}.user-admin-grid input,.user-admin-grid select{min-width:0;padding:9px;border:1px solid #d1d5db;border-radius:8px;background:#fff}.user-admin-grid select[data-pay-level="unassigned"]{border-color:#f59e0b;background:#fffbeb}.user-password-actions{margin-top:10px}.user-password-form{display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:center;margin-top:8px}.user-password-form[hidden]{display:none!important}.user-password-form input{min-width:0;padding:9px;border:1px solid #d1d5db;border-radius:8px}.user-password-message{margin-top:6px;font-size:12px}@media(max-width:700px){.user-admin-heading,.pending-account-row,.user-password-form{grid-template-columns:1fr;display:grid}.user-admin-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(css);
  async function onboarding(action,payload={}){const {data,error}=await sb.functions.invoke('rep-onboarding',{body:{action,...payload}});if(error)throw error;return data;}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function dateText(value){if(!value)return'Never';const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown':date.toLocaleString();}
  function accessStateLabel(value){return({email_unconfirmed:'Email not confirmed',approval_requested:'Approval requested',access_inactive:'Access inactive',no_access_record:'McCoy access not created'})[value]||'Access pending';}
  function payLevelOptions(value){return `<option value="" ${value?'':'selected'}>Pay level required</option><option value="trainee" ${value==='trainee'?'selected':''}>Trainee</option><option value="experienced" ${value==='experienced'?'selected':''}>Experienced Rep</option><option value="active_manager_trainer" ${value==='active_manager_trainer'?'selected':''}>Active Manager / Trainer</option>`;}
  const isTeamLeaderRole=role=>role==='manager'||role==='trainer';
  const roleLabel=role=>role==='admin'?'Admin':role==='manager'?'Manager':role==='trainer'?'Trainer':'Rep';
  function removeLegacyAccessRequests(){document.getElementById('accessAdminBtn')?.remove();document.getElementById('accessAdminPanel')?.remove();}
  function ensurePanel(){
    document.getElementById('userAdminBtn')?.remove();
    const teams=document.getElementById('teams');
    if(!teams)return null;
    let panel=document.getElementById('userAdminPanel');
    if(!panel){
      panel=document.createElement('section');
      panel.id='userAdminPanel';
      panel.setAttribute('aria-label','Users and access administration');
      panel.innerHTML=`<div class="user-admin-card card"><div class="user-admin-heading"><div><h2>Users & Access</h2><p class="muted">Every Manager and Trainer must have an Admin supervisor. Assign trainee reps to a team and to the Manager or Trainer responsible for them.</p></div><button id="userAdminRefresh" class="assign-btn">Refresh Users</button></div><div id="userAdminNotice" class="muted small" role="status" aria-live="polite"></div><div id="userAdminBody">Loading…</div></div>`;
      teams.appendChild(panel);
      document.getElementById('userAdminRefresh').onclick=()=>loadUsers();
      document.querySelector('.nav-btn[data-view="teams"]')?.addEventListener('click',()=>loadUsers());
    }else if(panel.parentElement!==teams){
      teams.appendChild(panel);
    }
    return panel;
  }
  async function loadUsers(){
    const root=document.getElementById('userAdminBody'),notice=document.getElementById('userAdminNotice');root.textContent='Loading…';notice.textContent='';
    try{
      const [d,pendingData]=await Promise.all([onboarding('list_users'),onboarding('list_pending_accounts')]);const users=d?.users||[],pendingAccounts=pendingData?.accounts||[],currentAdminEmail=String(window.MCCOY_ACCESS?.user?.email||'').toLowerCase(),admins=users.filter(u=>u.role==='admin'&&u.active),teamLeaders=users.filter(u=>u.active&&['manager','trainer','admin'].includes(u.role));
      const assignmentOptions=(role,userEmail,selected)=>{const leader=isTeamLeaderRole(role),choices=leader?admins:role==='rep'?teamLeaders:[],emptyLabel=leader?'Select Admin supervisor (required)':'No manager / trainer';return `<option value="">${emptyLabel}</option>`+choices.filter(candidate=>candidate.email!==userEmail).map(candidate=>`<option value="${esc(candidate.email)}" ${selected===candidate.email?'selected':''}>${esc(candidate.display_name||candidate.email)} (${roleLabel(candidate.role)})</option>`).join('');};
      if(!teamLeaders.length) notice.textContent='No assignable Manager, Trainer, or Admin accounts exist yet.';
      const pendingMarkup=`<section class="pending-account-section"><div class="pending-account-heading"><div><h3>Pending Account Access</h3><div class="muted small">Authentication accounts without active McCoy access, including users who never completed an access request.</div></div><span class="pending-account-count">${pendingAccounts.length}</span></div><div class="pending-account-list">${pendingAccounts.length?pendingAccounts.map((account,i)=>`<div class="pending-account-row"><div><strong>${esc(account.display_name||account.email)}</strong><div class="muted small">${esc(account.email)}</div></div><div class="pending-account-details"><span class="pending-account-state">${esc(accessStateLabel(account.access_state))}</span><span>Account created: ${esc(dateText(account.account_created_at))}</span><span>Email confirmed: ${esc(account.email_confirmed_at?dateText(account.email_confirmed_at):'No')}</span><span>Last authentication: ${esc(dateText(account.last_sign_in_at))}</span><span>Access request: ${esc(account.request?.status||'Not submitted')}</span><div class="pending-account-actions"><button id="paGrant${i}" class="primary">GRANT ACCESS</button><button id="paReset${i}" class="assign-btn">RESET PASSWORD</button></div><div id="paResetForm${i}" class="user-password-form" hidden><input id="paPassword${i}" type="password" autocomplete="new-password" placeholder="New password (8+ characters)" aria-label="New password"><input id="paPasswordConfirm${i}" type="password" autocomplete="new-password" placeholder="Confirm new password" aria-label="Confirm new password"><button id="paApplyReset${i}" class="primary">UPDATE PASSWORD</button><button id="paCancelReset${i}" class="assign-btn">Cancel</button></div><div id="paMessage${i}" class="user-password-message"></div></div></div>`).join(''):'<div class="muted small">No accounts are waiting for access.</div>'}</div></section>`;
      root.innerHTML=pendingMarkup+'<h3 class="active-users-heading">Active McCoy Users</h3><p class="muted small">Set the app role, pay level, team, and supervisor here. A Trainee pay level can be assigned to any team and placed under a Manager or Trainer.</p>'+users.map((u,i)=>{const selectedManager=isTeamLeaderRole(u.role)?(u.assigned_manager_email||u.assigned_admin_email||currentAdminEmail):u.assigned_manager_email;const roleSummary=u.role==='admin'?' · Admin / assignable supervisor':isTeamLeaderRole(u.role)?` · ${roleLabel(u.role)} / Admin-assigned leads only`:u.sales_classification==='trainee'?' · Trainee / assign to team and trainer':'';return `<div class="user-admin-row"><div><strong>${esc(u.display_name||u.email)}</strong><div class="muted small">${esc(u.email)}${roleSummary}</div></div><div class="user-admin-grid"><input id="uaName${i}" value="${esc(u.display_name||u.email)}" maxlength="120" aria-label="Display name shown to other users" placeholder="Display name"><select id="uaRole${i}" ${u.role==='admin'?'disabled':''} aria-label="App role"><option value="rep" ${u.role==='rep'?'selected':''}>Rep</option><option value="manager" ${u.role==='manager'?'selected':''}>Manager</option><option value="trainer" ${u.role==='trainer'?'selected':''}>Trainer</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select><select id="uaPay${i}" aria-label="Commission pay level" data-pay-level="${u.sales_classification?'assigned':'unassigned'}">${payLevelOptions(u.sales_classification)}</select><select id="uaTeam${i}" aria-label="Assigned team"><option value="">No team</option><option ${u.team_name==='Pacific Northwest'?'selected':''}>Pacific Northwest</option><option ${u.team_name==='North Carolina'?'selected':''}>North Carolina</option></select><select id="uaMgr${i}" ${u.role==='admin'?'disabled':''} aria-label="Assigned manager or trainer">${assignmentOptions(u.role,u.email,selectedManager)}</select><button id="uaSave${i}" class="primary">Save</button></div>${u.role!=='admin'?`<div class="user-password-actions"><button id="uaReset${i}" class="assign-btn">RESET PASSWORD</button><div id="uaResetForm${i}" class="user-password-form" hidden><input id="uaPassword${i}" type="password" autocomplete="new-password" placeholder="New password (8+ characters)" aria-label="New password"><input id="uaPasswordConfirm${i}" type="password" autocomplete="new-password" placeholder="Confirm new password" aria-label="Confirm new password"><button id="uaApplyReset${i}" class="primary">UPDATE PASSWORD</button><button id="uaCancelReset${i}" class="assign-btn">Cancel</button></div><div id="uaResetMessage${i}" class="user-password-message"></div></div>`:''}</div>`;}).join('');
      if(d?.can_assign_secondary_admin){
        const section=document.createElement('section');section.className='pending-account-section';
        section.innerHTML=`<h3>Secondary Admin</h3><p class="muted small">Only Phillip Beatty, the original owner, can assign one additional Admin account.</p><div class="pending-account-actions"><select id="secondaryAdminUser"><option value="">Select active user</option>${users.filter(user=>user.role!=='admin').map(user=>`<option value="${esc(user.email)}">${esc(user.display_name||user.email)}</option>`).join('')}</select><button id="secondaryAdminAssign" class="primary">ASSIGN ADMIN</button>${d.secondary_admin_email?`<button id="secondaryAdminRevoke" class="assign-btn">REVOKE ${esc(d.secondary_admin_email)}</button>`:''}</div><div id="secondaryAdminMessage" class="muted small"></div>`;
        root.insertBefore(section,root.firstChild);
        const select=document.getElementById('secondaryAdminUser'),assign=document.getElementById('secondaryAdminAssign'),message=document.getElementById('secondaryAdminMessage');
        assign.onclick=async()=>{if(!select.value){message.textContent='Select the account to make the secondary Admin.';return;}assign.disabled=true;try{await onboarding('set_secondary_admin',{email:select.value,enabled:true});await loadUsers();notice.textContent='Secondary Admin assigned by Phillip Beatty.';}catch(error){message.textContent=error?.message||'Unable to assign secondary Admin.';assign.disabled=false;}};
        const revoke=document.getElementById('secondaryAdminRevoke');if(revoke)revoke.onclick=async()=>{revoke.disabled=true;try{await onboarding('set_secondary_admin',{email:d.secondary_admin_email,enabled:false});await loadUsers();notice.textContent='Secondary Admin access revoked by Phillip Beatty.';}catch(error){message.textContent=error?.message||'Unable to revoke secondary Admin.';revoke.disabled=false;}};
      }
      pendingAccounts.forEach((account,i)=>{
        const grant=document.getElementById('paGrant'+i),reset=document.getElementById('paReset'+i),form=document.getElementById('paResetForm'+i),password=document.getElementById('paPassword'+i),confirmation=document.getElementById('paPasswordConfirm'+i),message=document.getElementById('paMessage'+i),apply=document.getElementById('paApplyReset'+i);
        grant.onclick=async()=>{grant.disabled=true;reset.disabled=true;grant.textContent='Granting…';message.textContent='';try{const result=await onboarding('grant_pending_account_access',{email:account.email,display_name:account.display_name});if(!result?.ok)throw new Error(result?.detail||result?.error||'Unable to grant access.');await loadUsers();notice.textContent='Access granted to '+(account.display_name||account.email)+' as a Rep.';}catch(error){grant.disabled=false;reset.disabled=false;grant.textContent='GRANT ACCESS';message.style.color='#991b1b';message.textContent=error?.message||'Unable to grant access.';}};
        reset.onclick=()=>{form.hidden=false;reset.hidden=true;message.textContent='';password.focus();};
        document.getElementById('paCancelReset'+i).onclick=()=>{password.value='';confirmation.value='';form.hidden=true;reset.hidden=false;message.textContent='';};
        apply.onclick=async()=>{
          if(password.value.length<8){message.style.color='#991b1b';message.textContent='Use a password with at least 8 characters.';return;}
          if(password.value!==confirmation.value){message.style.color='#991b1b';message.textContent='Passwords do not match.';return;}
          apply.disabled=true;grant.disabled=true;message.textContent='';apply.textContent='Updating…';
          try{const result=await onboarding('reset_pending_password',{email:account.email,password:password.value});if(!result?.ok)throw new Error(result?.detail||result?.error||'Unable to update this password.');password.value='';confirmation.value='';form.hidden=true;reset.hidden=false;message.style.color='#166534';message.textContent='Password updated. Access remains pending until GRANT ACCESS is selected.';}
          catch(error){message.style.color='#991b1b';message.textContent=error?.message||'Unable to update this password.';}
          finally{apply.disabled=false;grant.disabled=false;apply.textContent='UPDATE PASSWORD';}
        };
      });
      users.forEach((u,i)=>{const name=document.getElementById('uaName'+i),role=document.getElementById('uaRole'+i),pay=document.getElementById('uaPay'+i),mgr=document.getElementById('uaMgr'+i);const syncManagerSelect=()=>{const previous=mgr.value,nextRole=role.value,selected=isTeamLeaderRole(nextRole)?(admins.some(admin=>admin.email===previous)?previous:currentAdminEmail):nextRole==='rep'?(teamLeaders.some(leader=>leader.email===previous)?previous:''):'';mgr.innerHTML=assignmentOptions(nextRole,u.email,selected);mgr.disabled=nextRole==='admin';};if(pay)pay.onchange=()=>{pay.dataset.payLevel=pay.value?'assigned':'unassigned';};if(role)role.onchange=syncManagerSelect;document.getElementById('uaSave'+i).onclick=async()=>{const b=document.getElementById('uaSave'+i),displayName=name.value.trim().replace(/\s+/g,' ');if(displayName.length<2){alert('Enter a display name with at least 2 characters.');name.focus();return;}if(isTeamLeaderRole(role.value)&&!mgr.value){alert(`Select an Admin as this ${roleLabel(role.value)}'s supervisor.`);mgr.focus();return;}b.disabled=true;b.textContent='Saving…';try{const result=await onboarding('update_user',{email:u.email,display_name:displayName,role:role.value,sales_classification:pay.value||null,team_name:document.getElementById('uaTeam'+i).value,assigned_manager_email:mgr.value,assigned_admin_email:isTeamLeaderRole(role.value)?mgr.value:null});await loadUsers();notice.textContent=result.display_name_changed?`Display name updated to ${result.display_name}. Login email and historical accounting records were not changed.`:'User settings saved.';}catch(e){console.error(e);b.disabled=false;b.textContent='Save';alert(e?.message||'Unable to update this user.');}};
        const reset=document.getElementById('uaReset'+i);
        if(reset){
          const form=document.getElementById('uaResetForm'+i),password=document.getElementById('uaPassword'+i),confirmation=document.getElementById('uaPasswordConfirm'+i),message=document.getElementById('uaResetMessage'+i),apply=document.getElementById('uaApplyReset'+i);
          reset.onclick=()=>{form.hidden=false;reset.hidden=true;message.textContent='';password.focus();};
          document.getElementById('uaCancelReset'+i).onclick=()=>{password.value='';confirmation.value='';form.hidden=true;reset.hidden=false;message.textContent='';};
          apply.onclick=async()=>{
            if(password.value.length<8){message.style.color='#991b1b';message.textContent='Use a password with at least 8 characters.';return;}
            if(password.value!==confirmation.value){message.style.color='#991b1b';message.textContent='Passwords do not match.';return;}
            apply.disabled=true;apply.textContent='Updating…';message.textContent='';
            try{
              const result=await onboarding('reset_user_password',{email:u.email,password:password.value});
              if(!result?.ok)throw new Error(result?.detail||result?.error||'Unable to update this password.');
              password.value='';confirmation.value='';form.hidden=true;reset.hidden=false;
              message.style.color='#166534';message.textContent='Password updated. This rep can sign in immediately.';
              notice.textContent='Password updated securely for '+(u.display_name||u.email)+'. No email link is required.';
            }catch(error){message.style.color='#991b1b';message.textContent=error?.message||'Unable to update this password.';}
            finally{apply.disabled=false;apply.textContent='UPDATE PASSWORD';}
          };
        }
      });
    }catch(e){console.error(e);root.textContent='Unable to load users.';}
  }
  function activateIfAdmin(){
    document.getElementById('userAdminBtn')?.remove();
    const isAdmin=window.MCCOY_ACCESS?.access?.role==='admin';
    const existing=document.getElementById('userAdminPanel');
    if(!isAdmin){existing?.classList.remove('show');return;}
    removeLegacyAccessRequests();
    const panel=ensurePanel();
    if(!panel)return;
    panel.classList.add('show');
    if(!panel.dataset.usersLoaded){panel.dataset.usersLoaded='1';loadUsers();}
  }
  new MutationObserver(()=>{document.getElementById('userAdminBtn')?.remove();if(window.MCCOY_ACCESS?.access?.role==='admin')removeLegacyAccessRequests();}).observe(document.body,{childList:true,subtree:true});
  const t=setInterval(()=>{activateIfAdmin();if(window.MCCOY_ACCESS?.access?.role==='admin')clearInterval(t);},500);
})();
