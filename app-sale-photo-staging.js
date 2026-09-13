// Mobile order-photo staging beside SAVE and SALE.
// Photos bind to the signed-in user's validated provider attempt. A confirmed
// upload opens the sale choices; neither file selection nor upload records a sale.
(function(){
  if(window.MCCOY_SALE_PHOTO_STAGING)return;
  window.MCCOY_SALE_PHOTO_STAGING=true;

  const BUCKET='provider-sale-staged-photos';
  const LEGACY_FINALIZE_KEY='mccoy_pending_sale_photo_finalize_v1';
  const RECOVERY_PREFIX='mccoy_sale_photo_recovery_v2:';
  const recoveryMemory=new Map(),recoveryFlights=new Map();
  let recoveryStorageUnavailable=false;
  const MAX_UPLOAD_BYTES=10*1024*1024;
  const MAX_DIMENSION=2000;
  const state={capture:null,captureValidated:false,rows:[],busy:false,picker:null,epoch:0,listVersion:0,lastMessage:'Press SALE first, then add the provider screenshot or photo.'};
  const byId=id=>document.getElementById(id);
  const accountIdentity=()=>window.MCCOY_ACCESS?.access?.active&&window.MCCOY_ACCESS?.user?.id?`${window.MCCOY_ACCESS.user.id}:${window.MCCOY_ACCESS.access.organization_id||''}`:'';
  const owned=capture=>!!(accountIdentity()&&capture?.actor_key===accountIdentity());
  const snapshot=()=>({capture:{...state.capture},account:accountIdentity(),epoch:state.epoch});
  const current=request=>!!(request&&request.account&&request.account===accountIdentity()&&request.epoch===state.epoch&&sameCapture(request.capture,state.capture)&&owned(state.capture));
  const outcomePending=()=>!!(state.capture?.outcome_pending||window.MCCOY_ACTIVE_PROVIDER_CAPTURE?.outcome_pending);
  window.MCCOY_SALE_PHOTO_STATE=()=>({capture:owned(state.capture)?{...state.capture}:null,busy:state.busy,canAdd:owned(state.capture)&&!!state.capture?.id&&state.captureValidated&&!state.busy&&!outcomePending()&&state.rows.length<3,message:owned(state.capture)?state.lastMessage:'',count:state.rows.length});
  window.MCCOY_OPEN_SALE_PHOTO_PICKER=openPhotoPicker;

  function client(requirements={}){
    if(typeof window.MCCOY_REQUIRE_SUPABASE_CLIENT==='function')return window.MCCOY_REQUIRE_SUPABASE_CLIENT(requirements);
    throw new Error('McCoy connection is not ready. Refresh Field Coach and retry.');
  }

  // Each action has its own key. Finishing an older sale cannot overwrite a
  // newer sale's retry, even when the active capture has already changed.
  const recoveryKey=record=>RECOVERY_PREFIX+encodeURIComponent(record.actor_key)+':'+encodeURIComponent(record.capture_id)+':'+record.action;
  function validRecovery(record){
    return !!(record&&record.actor_key&&record.capture_id&&record.id&&['finalize','discard'].includes(record.action)&&(record.action!=='finalize'||record.sale_id));
  }
  function storedRecovery(key){
    try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}
  }
  function rememberRecovery(record){
    const key=recoveryKey(record);
    recoveryMemory.set(key,record);
    try{localStorage.setItem(key,JSON.stringify(record));return true;}
    catch(_){recoveryStorageUnavailable=true;return false;}
  }
  function queueRecovery(action,captureId,details={}){
    const record={action,capture_id:captureId,actor_key:accountIdentity(),...details};
    const key=recoveryKey(record),existing=storedRecovery(key)||recoveryMemory.get(key);
    if(validRecovery(existing)&&existing.actor_key===record.actor_key&&existing.capture_id===captureId&&existing.action===action){
      if(action==='finalize'&&existing.sale_id!==record.sale_id)throw new Error('This attempt already has a different photo recovery sale. Review it before retrying.');
      recoveryMemory.set(key,existing);return existing;
    }
    record.id=crypto.randomUUID();record.created_at=new Date().toISOString();rememberRecovery(record);return record;
  }
  function pendingRecovery(){
    const actor=accountIdentity();if(!actor)return [];
    const records=new Map(recoveryMemory);
    try{
      for(let index=0;index<localStorage.length;index++){
        const key=localStorage.key(index);
        if(!key?.startsWith(RECOVERY_PREFIX+encodeURIComponent(actor)+':'))continue;
        const record=storedRecovery(key);
        if(validRecovery(record)&&recoveryKey(record)===key)records.set(key,record);
      }
    }catch(_){recoveryStorageUnavailable=true;}
    return [...records.values()].filter(record=>validRecovery(record)&&record.actor_key===actor).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  }
  function forgetRecovery(record){
    const key=recoveryKey(record);
    if(recoveryMemory.get(key)?.id===record.id)recoveryMemory.delete(key);
    // Remove only the exact acknowledged record, never a later record at its key.
    try{if(storedRecovery(key)?.id===record.id)localStorage.removeItem(key);}catch(_){recoveryStorageUnavailable=true;}
  }
  function migrateLegacyRecovery(){
    const legacy=storedRecovery(LEGACY_FINALIZE_KEY);
    // Unscoped legacy entries remain untouched: their owner cannot be inferred
    // from whichever account happens to be signed in now.
    if(!legacy?.actor_key||legacy.actor_key!==accountIdentity()||!legacy.saleId||!legacy.providerCaptureId)return;
    const record=queueRecovery('finalize',legacy.providerCaptureId,{sale_id:legacy.saleId});
    if(storedRecovery(recoveryKey(record))?.id===record.id){
      try{localStorage.removeItem(LEGACY_FINALIZE_KEY);}catch(_){recoveryStorageUnavailable=true;}
    }
  }

  function ensureControls(){
    const actions=document.querySelector('.spotio-disposition-actions');
    if(!actions)return false;

    const save=byId('savePinDispositionBtn');
    if(save){save.textContent='SAVE';save.title='Save disposition';save.setAttribute('aria-label','Save disposition');}

    let input=byId('salePhotoStageInput');
    if(!input){
      input=document.createElement('input');
      input.id='salePhotoStageInput';input.type='file';input.accept='image/*';input.tabIndex=-1;
      input.setAttribute('aria-hidden','true');
      input.style.cssText='position:fixed;left:-10000px;top:auto;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(input);
      input.addEventListener('change',handleFileSelection);
      input.addEventListener('cancel',()=>{state.picker=null;});
    }

    let button=byId('stageSalePhotoBtn');
    if(!button){
      button=document.createElement('button');button.id='stageSalePhotoBtn';button.type='button';button.textContent='PHOTO';
      button.className='sale-photo-stage-button';button.title='Take or choose an order photo for the current provider sale';
      button.setAttribute('aria-label','Take or choose an order photo');
      actions.appendChild(button);
      button.addEventListener('click',openPhotoPicker);
    }

    let status=byId('salePhotoStageStatus');
    if(!status){
      status=document.createElement('div');status.id='salePhotoStageStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      actions.insertAdjacentElement('afterend',status);
    }
    renderStatus();
    return true;
  }

  function setBusy(active,label='PHOTO'){
    state.busy=active;
    const button=byId('stageSalePhotoBtn');
    if(button){button.disabled=active;button.textContent=active?label:(state.rows.length?`PHOTO (${state.rows.length})`:'PHOTO');}
  }

  function renderStatus(){
    window.dispatchEvent(new CustomEvent('mccoy-sale-photo-state-changed'));
    const root=byId('salePhotoStageStatus');if(!root)return;
    root.replaceChildren();
    const pending=pendingRecovery();
    const message=document.createElement('span');message.textContent=state.lastMessage;root.appendChild(message);
    if(pending.length){
      const note=document.createElement('span');note.textContent=` ${pending.length} photo action${pending.length===1?'':'s'} pending.`;root.appendChild(note);
      if(recoveryStorageUnavailable){const warning=document.createElement('span');warning.textContent=' Recovery could not be saved on this device. Keep this page open and retry.';root.appendChild(warning);}
      const retry=document.createElement('button');retry.type='button';retry.textContent='RETRY PHOTOS';retry.title='Retry pending photo attachment or cleanup for your account';
      retry.disabled=pending.every(record=>recoveryFlights.has(recoveryKey(record)))||state.busy;
      retry.addEventListener('click',()=>retryPendingPhotos());
      root.appendChild(retry);
    }else if(state.rows.length&&state.captureValidated&&state.capture?.id&&!state.busy&&!outcomePending()){
      const remove=document.createElement('button');remove.type='button';remove.textContent='REMOVE';remove.title='Delete staged photos for this provider attempt';
      remove.addEventListener('click',()=>discardCapture(state.capture.id,'Photos removed.'));
      root.appendChild(remove);
    }
    const button=byId('stageSalePhotoBtn');
    if(button&&!state.busy)button.textContent=state.rows.length?`PHOTO (${state.rows.length})`:'PHOTO';
  }

  function errorMessage(error,fallback){
    return String(error?.message||fallback||'Photo action failed.').replaceAll('_',' ');
  }

  function sameCapture(left,right){
    if(!left||!right)return false;
    return !!((left.id&&right.id&&left.id===right.id)||(left.client_request_id&&right.client_request_id&&left.client_request_id===right.client_request_id));
  }

  function resetCapture(message='Press SALE first, then add the provider screenshot or photo.'){
    state.epoch++;state.listVersion++;state.picker=null;state.capture=null;state.captureValidated=false;state.rows=[];state.lastMessage=message;setBusy(false);renderStatus();
  }

  async function invoke(action,payload={}){
    const supabase=client({functions:true});
    const {data,error}=await supabase.functions.invoke('provider-sale-photo-stage',{body:{action,...payload}});
    if(error||!data?.ok){
      let detail=data?.detail||data?.error||error?.message||'photo_stage_request_failed';
      try{if(!data&&error?.context?.clone){const value=await error.context.clone().json();detail=value?.detail||value?.error||detail;}}catch(_){}
      throw new Error(String(detail));
    }
    return data;
  }

  async function validatedCurrentCapture(request){
    if(!current(request)||outcomePending()||typeof window.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE!=='function')return null;
    const capture=await window.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE();
    if(!current(request))return null;
    if(!owned(capture)||!sameCapture(capture,request.capture)){
      resetCapture('That provider attempt is no longer open. Press SALE to start a fresh attempt.');
      return null;
    }
    state.capture={...request.capture,...capture};state.captureValidated=true;
    return state.capture;
  }

  async function refreshForCapture(capture,quiet=false){
    if(!owned(capture)||!capture?.id||!sameCapture(capture,state.capture))return;
    const request=snapshot(),version=++state.listVersion;
    try{
      const data=await invoke('list',{capture_id:capture.id});
      if(!current(request)||version!==state.listVersion||state.busy)return;
      state.capture={...state.capture,...capture};state.rows=Array.isArray(data.rows)?data.rows:[];
      state.lastMessage=state.rows.length
        ? `${state.rows.length} photo${state.rows.length===1?'':'s'} staged. ${state.rows.length<3?'Add another or ':''}use the green check on return to attach.`
        : 'Provider attempt secured. PHOTO opens the camera or photo library.';
    }catch(error){
      if(!current(request)||version!==state.listVersion||state.busy)return;
      if(!quiet)state.lastMessage=errorMessage(error,'Unable to load staged photos.');
    }
    renderStatus();
  }

  function openPhotoPicker(event){
    event?.preventDefault();
    if(state.busy||outcomePending())return;
    if(!owned(state.capture)||!state.capture?.id){
      state.lastMessage='Press SALE first. PHOTO needs your current provider attempt.';
      renderStatus();
      return;
    }
    if(!state.captureValidated){
      state.lastMessage='McCoy is still securing this provider attempt. Wait for the provider dashboard, then press PHOTO again.';
      renderStatus();
      return;
    }
    if(state.rows.length>=3){state.lastMessage='This provider attempt already has the 3-photo maximum.';renderStatus();return;}

    // Keep file-input activation inside the original tap. Mobile Safari can block
    // a camera/photo-library picker when input.click() happens after an await.
    ensureControls();
    const input=byId('salePhotoStageInput');if(!input)return;
    state.picker=snapshot();
    input.value='';
    input.click();
    state.lastMessage='Choose a screenshot, Photo Library image, or take a new photo.';
    renderStatus();
  }

  function loadImage(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),image=new Image();
      image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('This image format could not be opened. Use a screenshot, JPEG, PNG, or WebP image.'));};
      image.src=url;
    });
  }

  async function normalizeImage(file){
    const extension=String(file?.name||'').toLowerCase().split('.').pop();
    const likelyImage=!!file&&(String(file.type||'').startsWith('image/')||['jpg','jpeg','png','webp','heic','heif'].includes(extension));
    if(!likelyImage)throw new Error('Choose an image file.');
    const directlyAllowed=['image/jpeg','image/png','image/webp'].includes(file.type);
    if(directlyAllowed&&file.size<=3*1024*1024)return file;

    let image;
    try{image=await loadImage(file);}catch(error){if(directlyAllowed&&file.size<=MAX_UPLOAD_BYTES)return file;throw error;}
    const width=Number(image.naturalWidth||image.width),height=Number(image.naturalHeight||image.height);
    if(!width||!height)throw new Error('The selected image has no readable dimensions.');
    const scale=Math.min(1,MAX_DIMENSION/Math.max(width,height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('This browser could not prepare the photo.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
    if(!blob)throw new Error('This browser could not compress the photo.');
    const base=String(file.name||'order-photo').replace(/\.[^.]+$/,'').slice(0,80)||'order-photo';
    return new File([blob],`${base}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
  }

  async function handleFileSelection(event){
    const selected=event.target?.files?.[0],request=state.picker;state.picker=null;
    if(!selected||state.busy||!current(request)||outcomePending()){event.target.value='';return;}
    state.listVersion++;
    setBusy(true,'PREPARING…');state.lastMessage='Validating this provider attempt and preparing the image…';renderStatus();
    let created=null;
    try{
      const capture=await validatedCurrentCapture(request);
      if(!current(request))return;
      if(!capture)throw new Error('The current provider attempt is no longer open. Press SALE and try again.');
      const file=await normalizeImage(selected);
      if(!current(request))return;
      if(file.size>MAX_UPLOAD_BYTES)throw new Error('Photo must be 10 MB or less after compression.');
      setBusy(true,'UPLOADING…');state.lastMessage='Creating a private signed upload…';renderStatus();
      created=await invoke('create_upload',{capture_id:capture.id,mime_type:file.type,file_size_bytes:file.size,original_file_name:selected.name||null});
      if(!current(request))return;
      const supabase=client({storage:true});
      const upload=await supabase.storage.from(BUCKET).uploadToSignedUrl(created.path,created.token,file,{contentType:file.type});
      if(!current(request))return;
      if(upload.error)throw upload.error;
      const committed=await invoke('commit_upload',{photo_id:created.photo_id});
      if(!current(request))return;
      const row=committed.row||{id:created.photo_id,provider_capture_id:capture.id,status:'staged'};
      state.listVersion++;
      state.rows=[...state.rows.filter(item=>item.id!==row.id),row];
      state.lastMessage=`${state.rows.length} photo${state.rows.length===1?'':'s'} staged privately. Choose the green check for a completed sale or the red X for an abandoned attempt.`;
      setBusy(false);renderStatus();
      window.dispatchEvent(new CustomEvent('mccoy-provider-sale-photo-staged',{detail:{capture:{...state.capture},photoId:row.id}}));
    }catch(error){
      if(current(request)){
        if(created?.photo_id)invoke('abort_upload',{photo_id:created.photo_id}).catch(()=>{});
        state.lastMessage=errorMessage(error,'Photo could not be staged.');
      }
    }
    finally{if(current(request)){event.target.value='';setBusy(false);renderStatus();}}
  }

  async function discardCapture(captureId,successMessage='Photos removed.',abandoned=false){
    if(!captureId||state.busy||!owned(state.capture)||state.capture.id!==captureId)return;
    const record=queueRecovery('discard',captureId,{abandoned,success_message:successMessage});
    if(abandoned)state.captureValidated=false;
    return runRecovery(record);
  }

  async function startExtraction(photoIds,saleId,request){
    const ids=Array.isArray(photoIds)?photoIds:[];
    if(request.account!==accountIdentity())return{failed:ids.length};
    const supabase=client({functions:true});
    const results=await Promise.allSettled(ids.map(photoId=>supabase.functions.invoke('sale-order-photo',{body:{action:'process',photo_id:photoId}})));
    const failed=results.filter(result=>result.status==='rejected'||result.value?.error||result.value?.data?.ok===false).length;
    if(!current(request))return{results,failed};
    window.dispatchEvent(new CustomEvent('mccoy-sale-order-photo-updated',{detail:{saleId,photoIds:ids,results}}));
    window.dispatchEvent(new CustomEvent('mccoy-sale-details-updated',{detail:{saleId}}));
    return{results,failed};
  }

  function runRecovery(record){
    if(record.actor_key!==accountIdentity())return Promise.resolve(false);
    const key=recoveryKey(record);
    if(recoveryFlights.has(key))return recoveryFlights.get(key);
    // Install the promise before starting the request to coalesce duplicate events.
    const flight=Promise.resolve().then(async()=>{
      const request=snapshot(),sameAttempt=current(request)&&request.capture.id===record.capture_id;
      if(sameAttempt){
        state.listVersion++;
        setBusy(true,record.action==='finalize'?'ATTACHING…':'REMOVING…');
        state.lastMessage=record.action==='finalize'?'Sale saved. Attaching staged photo evidence…':'Deleting staged photos…';renderStatus();
      }
      const updateCurrent=()=>sameAttempt&&current(request);
      try{
        const {data,error}=await client({auth:true}).auth.getSession();
        if(error||!data?.session?.user?.id||record.actor_key.split(':')[0]!==data.session.user.id)throw new Error('Sign in to the original account to retry photos.');
        if(record.actor_key!==accountIdentity())return false;
        const payload={capture_id:record.capture_id};
        if(record.action==='finalize')payload.sale_id=record.sale_id;
        const result=await invoke(record.action,payload);
        forgetRecovery(record);
        if(!updateCurrent())return true;
        state.rows=[];state.captureValidated=record.action==='discard'&&!record.abandoned;
        if(record.action==='discard'){
          if(record.abandoned)resetCapture('Provider attempt abandoned. Its staged photos were deleted. Press SALE to start another.');
          else state.lastMessage=record.success_message||'Photos removed.';
          return true;
        }
        const count=Array.isArray(result.sale_photo_ids)?result.sale_photo_ids.length:0;
        state.lastMessage=count?`${count} photo${count===1?'':'s'} attached to the sale. Extracting visible order details…`:'Sale completed with no staged photo.';renderStatus();
        if(count){
          const extraction=await startExtraction(result.sale_photo_ids,record.sale_id,request);
          if(updateCurrent())state.lastMessage=extraction.failed
            ? `${count} photo${count===1?'':'s'} attached. Automatic extraction was unavailable for ${extraction.failed}; enter or confirm the information in SALES TO COMPLETE.`
            : `${count} photo${count===1?'':'s'} attached. Review extracted suggestions in SALES TO COMPLETE.`;
        }
        return true;
      }catch(error){
        if(updateCurrent()||(!state.capture&&record.actor_key===accountIdentity()))state.lastMessage=record.action==='finalize'
          ? `Sale saved, but photo attachment is pending: ${errorMessage(error)}`
          : `Photo cleanup is pending: ${errorMessage(error)} Photos have not been confirmed deleted.`;
        return false;
      }finally{
        if(updateCurrent())setBusy(false);
        if(record.actor_key===accountIdentity())renderStatus();
      }
    }).finally(()=>{
      if(recoveryFlights.get(key)===flight)recoveryFlights.delete(key);
      if(record.actor_key===accountIdentity())renderStatus();
    });
    recoveryFlights.set(key,flight);return flight;
  }

  async function finalizePhotos(detail){
    const saleId=String(detail?.saleId||detail?.sale_id||''),captureId=String(detail?.providerCaptureId||detail?.capture_id||'');
    if(!saleId||!captureId||!owned(state.capture)||state.capture.id!==captureId)return;
    const record=queueRecovery('finalize',captureId,{sale_id:saleId});
    state.captureValidated=false;
    return runRecovery(record);
  }

  async function retryPendingPhotos(){
    migrateLegacyRecovery();
    for(const record of pendingRecovery()){
      if(record.actor_key!==accountIdentity())break;
      if(state.busy&&state.capture?.id===record.capture_id&&!recoveryFlights.has(recoveryKey(record)))continue;
      await runRecovery(record);
    }
    renderStatus();
  }

  function captureFromEvent(event){return event?.detail?.capture||null;}
  function startCurrentAttempt(capture){
    if(!owned(capture))return;
    if(!sameCapture(capture,state.capture))resetCapture();
    state.capture=capture;state.captureValidated=false;
    state.lastMessage='Provider attempt started. McCoy is securing it before PHOTO becomes available.';renderStatus();
  }
  function acceptValidatedCapture(capture,{restored=false}={}){
    if(!owned(capture)||!capture?.id||!['dashboard_opened','details_required'].includes(capture.status))return;
    if(!sameCapture(capture,state.capture)){
      if(!restored&&state.capture)return;
      resetCapture();state.capture=capture;
    }
    state.capture={...state.capture,...capture};state.captureValidated=true;
    if(!state.busy)refreshForCapture(state.capture,true);
  }

  window.addEventListener('mccoy-provider-sale-capture-started',event=>startCurrentAttempt(captureFromEvent(event)));
  window.addEventListener('mccoy-provider-sale-capture-ready',event=>acceptValidatedCapture(captureFromEvent(event)));
  window.addEventListener('mccoy-provider-sale-returned',event=>acceptValidatedCapture(captureFromEvent(event)));
  // Same-tab navigation can reload the app. Only server-validated, same-owner
  // recovery allows the user to explicitly attach evidence to that open attempt.
  window.addEventListener('mccoy-provider-sale-capture-restored',event=>{
    const capture=captureFromEvent(event);
    if(event.detail?.validated===true)acceptValidatedCapture(capture,{restored:true});
  });
  window.addEventListener('mccoy-provider-sale-capture-invalidated',()=>resetCapture('The prior provider attempt is no longer usable. Press SALE to start a fresh attempt.'));
  window.addEventListener('mccoy-provider-sale-abandoned',event=>{
    const captureId=String(event.detail?.providerCaptureId||'');
    discardCapture(captureId,'Provider attempt abandoned. Its staged photos were deleted.',true);
  });
  window.addEventListener('mccoy-sale-saved',event=>finalizePhotos(event.detail||{}));
  window.addEventListener('mccoy-sales-hub-layout-ready',ensureControls);
  window.addEventListener('mccoy-access-ready',()=>{if(state.capture&&!owned(state.capture))resetCapture();ensureControls();retryPendingPhotos();});

  function schedule(){[0,80,220,500,900,1500,2500].forEach(delay=>setTimeout(ensureControls,delay));}
  document.addEventListener('click',event=>{if(event.target?.closest?.('.nav-btn[data-view="field"]'))schedule();},true);
  schedule();
})();
