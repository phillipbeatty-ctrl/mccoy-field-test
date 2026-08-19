// Admin-managed Apple Notes integration: only explicitly authorized folders can sync.
(()=>{
  const settings=document.getElementById('settings');
  if(!settings)return;

  const card=document.createElement('div');
  card.id='appleNotesConnectionCard';
  card.className='card';
  card.hidden=true;
  card.style.marginTop='16px';
  card.innerHTML='<div class="card-head"><div><h2>Apple Notes · Authorized Folders</h2><p class="muted">Nothing is imported unless you explicitly authorize the exact folder name.</p></div></div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'
    +'<input id="appleNotesFolderName" placeholder="Exact Apple Notes folder name" style="flex:1;min-width:220px;padding:11px;border:1px solid #d1d5db;border-radius:9px">'
    +'<button id="authorizeAppleNotesFolderBtn" class="primary" type="button">AUTHORIZE FOLDER</button></div>'
    +'<div id="appleNotesFolderList" class="muted">No folders authorized.</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">'
    +'<button id="runAppleNotesSyncBtn" class="primary" type="button">SYNC APPLE NOTES NOW</button>'
    +'<button id="createAppleNotesShortcutBtn" class="assign-btn" type="button">CREATE APPLE SYNC SHORTCUT</button>'
    +'<button id="refreshAppleNotesSyncBtn" class="assign-btn" type="button">REFRESH SYNC STATUS</button>'
    +'<button id="generateAppleNotesKeyBtn" class="assign-btn" type="button">GENERATE APPLE SHORTCUT KEY</button>'
    +'<button id="disconnectAppleNotesBtn" class="danger" type="button">DISCONNECT APPLE NOTES</button></div>'
    +'<div id="appleNotesStatus" class="muted small" aria-live="polite"></div>'
    +'<div id="appleNotesSecretMount" style="display:none;margin-top:12px"></div>'
    +'<details style="margin-top:15px"><summary style="cursor:pointer;font-weight:800">Apple Shortcuts setup for an authorized folder</summary>'
    +'<ol style="padding-left:20px;line-height:1.6"><li>Authorize the exact Apple Notes folder name above.</li>'
    +'<li>Generate the shortcut key and copy the endpoint and key.</li>'
    +'<li>On your iPhone, iPad, or Mac, select <strong>CREATE APPLE SYNC SHORTCUT</strong>, and name the new shortcut exactly <strong>McCoy Notes Sync</strong>.</li>'
    +'<li>Add <strong>Find Notes</strong> and set its Folder filter to the exact authorized folder. To support multiple approved folders, read the folder names passed as Shortcut Input and repeat these steps once for each folder.</li>'
    +'<li>For each note, create a dictionary containing a stable <code>id</code>, <code>title</code>, <code>body</code>, and optionally <code>modified_at</code>.</li>'
    +'<li>Use <strong>Get Contents of URL</strong> with method POST and JSON body <code>{"action":"sync_notes","folder":"your exact authorized folder","notes":[your note dictionaries],"full_snapshot":true}</code>. Full snapshots also remove notes deleted from Apple Notes.</li>'
    +'<li>Add the request header <code>x-mccoy-notes-token</code> with the generated shortcut key. The optional request <code>{"action":"device_folders"}</code> returns only your currently authorized folders.</li>'
    +'<li>Return here and use <strong>SYNC APPLE NOTES NOW</strong> or an individual folder\'s <strong>SYNC FOLDER</strong> button. You can also run the shortcut manually or create an Apple Shortcuts automation.</li></ol>'
    +'<p class="muted small">Other Apple Notes folders are neither requested nor accepted. Removing a folder deletes its imported copies and blocks future syncing.</p></details>'
    +'<div id="appleNotesDocumentList" style="margin-top:14px"></div>';
  settings.appendChild(card);

  let loaded=false;
  let latestStatus=null;
  let syncRefreshTimer=null;
  let syncRefreshAttempts=0;
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const setStatus=(value,ok=true)=>{const el=document.getElementById('appleNotesStatus');el.textContent=value;el.style.color=ok?'#166534':'#991b1b';};
  const invoke=async(action,payload={})=>{const {data,error}=await sb.functions.invoke('apple-notes-sync',{body:{action,...payload}});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'apple_notes_request_failed');return data;};

  function renderFolders(folders){
    const list=document.getElementById('appleNotesFolderList');
    const active=(folders||[]).filter(folder=>folder.active);
    if(!active.length){list.innerHTML='<p class="muted">No folders authorized. Apple Notes access is disabled until you name a folder.</p>';return;}
    list.innerHTML=active.map(folder=>'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:10px 0;border-top:1px solid #eef0f2"><div><strong>'+escapeHtml(folder.folder_name)+'</strong><div class="muted small">'+(folder.last_synced_at?'Last synced '+escapeHtml(new Date(folder.last_synced_at).toLocaleString()):'Not synced yet')+'</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="assign-btn apple-notes-sync" data-folder="'+escapeHtml(folder.folder_name)+'" type="button">SYNC FOLDER</button><button class="assign-btn apple-notes-view" data-id="'+escapeHtml(folder.id)+'" type="button">VIEW NOTES</button><button class="assign-btn apple-notes-remove" data-id="'+escapeHtml(folder.id)+'" type="button">REMOVE FOLDER</button></div></div>').join('');
    list.querySelectorAll('.apple-notes-sync').forEach(button=>button.addEventListener('click',()=>runShortcut(button.dataset.folder)));
    list.querySelectorAll('.apple-notes-view').forEach(button=>button.addEventListener('click',()=>viewNotes(button.dataset.id)));
    list.querySelectorAll('.apple-notes-remove').forEach(button=>button.addEventListener('click',()=>removeFolder(button.dataset.id)));
  }

  async function loadStatus(){
    try{latestStatus=await invoke('status');renderFolders(latestStatus.folders);const count=Number(latestStatus.note_count||0);const lastSync=latestStatus.connection?.last_synced_at?' · Last synced '+new Date(latestStatus.connection.last_synced_at).toLocaleString():'';setStatus((latestStatus.connection?.active?'Apple Shortcuts connection active':'Apple Shortcuts connection not configured')+' · '+count+' synced note'+(count===1?'':'s')+lastSync+'.');loaded=true;}
    catch(error){console.error('Apple Notes status failed',error);setStatus('Unable to load Apple Notes settings.',false);}
  }

  function refreshAfterSync(){
    if(syncRefreshTimer)clearInterval(syncRefreshTimer);
    syncRefreshAttempts=0;
    syncRefreshTimer=setInterval(async()=>{
      if(document.visibilityState==='hidden')return;
      const previousSync=latestStatus?.connection?.last_synced_at||'';
      await loadStatus();
      if((latestStatus?.connection?.last_synced_at||'')!==previousSync){
        clearInterval(syncRefreshTimer);syncRefreshTimer=null;
        const folders=(latestStatus?.folders||[]).filter(folder=>folder.active);
        if(folders.length===1)await viewNotes(folders[0].id);
        setStatus('Apple Notes sync complete · '+Number(latestStatus?.note_count||0)+' synced notes.');
      }else if(++syncRefreshAttempts>=15){clearInterval(syncRefreshTimer);syncRefreshTimer=null;}
    },2000);
  }

  function runShortcut(folderName){
    const authorized=(latestStatus?.folders||[]).filter(folder=>folder.active);
    if(!authorized.length){setStatus('Authorize the exact Apple Notes folder you want to sync first.',false);return;}
    if(!latestStatus?.connection?.active){setStatus('Generate an Apple Shortcut key, create McCoy Notes Sync, then try syncing again.',false);document.getElementById('generateAppleNotesKeyBtn').focus();return;}
    const folders=folderName?[folderName]:authorized.map(folder=>folder.folder_name);
    if(folders.some(name=>!authorized.some(folder=>folder.folder_name===name))){setStatus('Only explicitly authorized Apple Notes folders can be synced.',false);return;}
    const base=location.origin+location.pathname;
    const callback=state=>base+'?appleNotesSync='+encodeURIComponent(state)+'#settings';
    const shortcutUrl='shortcuts://x-callback-url/run-shortcut?name='+encodeURIComponent('McCoy Notes Sync')+'&input=text&text='+encodeURIComponent(JSON.stringify({folders,full_snapshot:true}))+'&x-success='+encodeURIComponent(callback('complete'))+'&x-cancel='+encodeURIComponent(callback('cancelled'))+'&x-error='+encodeURIComponent(callback('error'));
    setStatus('Opening McCoy Notes Sync for '+folders.map(name=>'“'+name+'”').join(', ')+'.');
    refreshAfterSync();
    location.assign(shortcutUrl);
  }

  async function viewNotes(folderId){
    try{const result=await invoke('list_notes',{folder_id:folderId});const mount=document.getElementById('appleNotesDocumentList');mount.innerHTML='<h3 style="font-size:15px">'+escapeHtml(result.folder)+' · Synced Notes</h3>'+(result.notes.length?result.notes.map(note=>'<details style="padding:8px 0;border-top:1px solid #eef0f2"><summary style="cursor:pointer;font-weight:700">'+escapeHtml(note.title||'Untitled note')+'</summary><pre style="white-space:pre-wrap;word-break:break-word">'+escapeHtml(note.body||'')+'</pre></details>').join(''):'<p class="muted">No notes have been synced from this folder yet.</p>');}
    catch(error){console.error('Apple Notes read failed',error);setStatus('Unable to load notes from that authorized folder.',false);}
  }

  async function removeFolder(folderId){
    try{await invoke('remove_folder',{folder_id:folderId});document.getElementById('appleNotesDocumentList').innerHTML='';await loadStatus();setStatus('Folder disconnected and its imported notes were removed.');}
    catch(error){console.error('Apple Notes folder removal failed',error);setStatus('Unable to remove this folder.',false);}
  }

  document.getElementById('authorizeAppleNotesFolderBtn').addEventListener('click',async()=>{
    const input=document.getElementById('appleNotesFolderName'),name=input.value.trim();
    if(!name){setStatus('Enter the exact Apple Notes folder name.',false);return;}
    try{await invoke('authorize_folder',{folder_name:name});input.value='';await loadStatus();setStatus('Authorized folder: '+name);}
    catch(error){console.error('Apple Notes folder authorization failed',error);setStatus('Unable to authorize this folder.',false);}
  });

  document.getElementById('runAppleNotesSyncBtn').addEventListener('click',()=>runShortcut());
  document.getElementById('refreshAppleNotesSyncBtn').addEventListener('click',async()=>{await loadStatus();});
  document.getElementById('createAppleNotesShortcutBtn').addEventListener('click',()=>{setStatus('Create an Apple shortcut named exactly McCoy Notes Sync, then follow the setup instructions below.');location.assign('shortcuts://create-shortcut');});

  document.getElementById('generateAppleNotesKeyBtn').addEventListener('click',async()=>{
    if(!latestStatus?.folders?.some(folder=>folder.active)){setStatus('Authorize at least one specific folder before creating a shortcut key.',false);return;}
    if(latestStatus?.connection?.active&&!window.confirm('Generating a new shortcut key will immediately disable the key saved in your existing Apple Shortcut. Continue?'))return;
    try{const result=await invoke('rotate_token');const mount=document.getElementById('appleNotesSecretMount');mount.style.display='block';mount.innerHTML='<div style="padding:12px;border:1px solid #d1d5db;border-radius:9px"><strong>Copy this key now; it is shown only once.</strong><p class="small"><strong>Endpoint:</strong><br><code style="word-break:break-all">'+escapeHtml(result.endpoint)+'</code></p><p class="small"><strong>Header:</strong> <code>x-mccoy-notes-token</code></p><p class="small"><strong>Shortcut key:</strong><br><code style="word-break:break-all">'+escapeHtml(result.token)+'</code></p></div>';await loadStatus();setStatus('Shortcut key generated. Copy it into Apple Shortcuts.');}
    catch(error){console.error('Apple Notes key generation failed',error);setStatus('Unable to generate the shortcut key.',false);}
  });

  document.getElementById('disconnectAppleNotesBtn').addEventListener('click',async()=>{
    try{await invoke('disconnect');document.getElementById('appleNotesSecretMount').style.display='none';await loadStatus();setStatus('Apple Notes connection disabled. Existing shortcut keys no longer work.');}
    catch(error){console.error('Apple Notes disconnection failed',error);setStatus('Unable to disconnect Apple Notes.',false);}
  });

  function showForAdmin(){const admin=window.MCCOY_ACCESS?.access?.active&&window.MCCOY_ACCESS?.access?.role==='admin';card.hidden=!admin;if(admin&&!loaded)loadStatus();}
  window.addEventListener('mccoy-real-leads-loaded',showForAdmin);
  window.addEventListener('focus',()=>{if(loaded&&!card.hidden){loadStatus();if(syncRefreshTimer)refreshAfterSync();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&loaded&&!card.hidden){loadStatus();if(syncRefreshTimer)refreshAfterSync();}});
  const callbackStatus=new URLSearchParams(location.search).get('appleNotesSync');
  if(callbackStatus){window.setTimeout(async()=>{if(!loaded||card.hidden)return;await loadStatus();if(callbackStatus==='complete'){const active=(latestStatus?.folders||[]).filter(folder=>folder.active);if(active.length===1)await viewNotes(active[0].id);setStatus('Returned from Apple Notes sync · '+Number(latestStatus?.note_count||0)+' synced notes.');}else setStatus(callbackStatus==='cancelled'?'Apple Notes sync was cancelled.':'Apple Notes sync did not complete. Check your McCoy Notes Sync shortcut.',false);history.replaceState(history.state,'',location.pathname+location.hash);},1200);}
  sb.auth.onAuthStateChange(()=>setTimeout(showForAdmin,700));
  let attempts=0;const timer=setInterval(()=>{showForAdmin();if(loaded||++attempts>=30)clearInterval(timer);},500);
})();