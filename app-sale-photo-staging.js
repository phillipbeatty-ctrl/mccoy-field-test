// Mobile order-photo staging beside SAVE and SALE.
// Photos are bound to the signed-in user's active provider capture, then moved
// onto the completed sale. Abandoned attempts delete their staged photos.
(function(){
  if(window.MCCOY_SALE_PHOTO_STAGING)return;
  window.MCCOY_SALE_PHOTO_STAGING=true;

  const BUCKET='provider-sale-staged-photos';
  const PENDING_FINALIZE_KEY='mccoy_pending_sale_photo_finalize_v1';
  const MAX_UPLOAD_BYTES=10*1024*1024;
  const MAX_DIMENSION=2000;
  const state={capture:null,rows:[],busy:false,pendingFinalize:null,lastMessage:'Press SALE first, then use PHOTO after the ISP dashboard opens.'};
  const byId=id=>document.getElementById(id);

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
    }

    let button=byId('stageSalePhotoBtn');
    if(!button){
      button=document.createElement('button');button.id='stageSalePhotoBtn';button.type='button';button.textContent='PHOTO';
      button.className='sale-photo-stage-button';button.title='Take or choose an order photo for the active provider sale';
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
    const root=byId('salePhotoStageStatus');if(!root)return;
    root.replaceChildren();
    const message=document.createElement('span');message.textContent=state.lastMessage;root.appendChild(message);
    if(state.pendingFinalize&&!state.busy){
      const retry=document.createElement('button');retry.type='button';retry.textContent='RETRY';retry.title='Retry attaching the staged photo to the completed sale';
      retry.addEventListener('click',()=>finalizePhotos(state.pendingFinalize,{retry:true}));
      root.appendChild(retry);
    }else if(state.rows.length&&state.capture?.id&&!state.busy){
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

  async function invoke(action,payload={}){
    if(!window.sb?.functions?.invoke)throw new Error('McCoy connection is not ready.');
    const {data,error}=await sb.functions.invoke('provider-sale-photo-stage',{body:{action,...payload}});
    if(error||!data?.ok){
      let detail=data?.detail||data?.error||error?.message||'photo_stage_request_failed';
      try{if(!data&&error?.context?.clone){const value=await error.context.clone().json();detail=value?.detail||value?.error||detail;}}catch(_){}
      throw new Error(String(detail));
    }
    return data;
  }

  function localCapture(){
    if(state.capture?.id)return state.capture;
    if(window.MCCOY_ACTIVE_PROVIDER_CAPTURE?.id)return window.MCCOY_ACTIVE_PROVIDER_CAPTURE;
    try{
      const stored=JSON.parse(localStorage.getItem('mccoy_active_provider_sale_capture_v1')||'null');
      return stored?.id?stored:null;
    }catch(_){return null;}
  }

  async function validatedCapture(){
    if(typeof window.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE!=='function')return null;
    const capture=await window.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE();
    if(capture?.id)state.capture=capture;
    return capture?.id?capture:null;
  }

  async function refreshForCapture(capture,quiet=false){
    if(!capture?.id){state.capture=null;state.rows=[];if(!quiet)state.lastMessage='Press SALE first, then use PHOTO after the ISP dashboard opens.';renderStatus();return;}
    try{
      const data=await invoke('list',{capture_id:capture.id});
      state.capture=capture;state.rows=Array.isArray(data.rows)?data.rows:[];
      state.lastMessage=state.rows.length
        ? `${state.rows.length} photo${state.rows.length===1?'':'s'} staged. ${state.rows.length<3?'Add another or ':''}press COMPLETE SALE to attach.`
        : 'No order photo staged. PHOTO opens the camera or photo library.';
    }catch(error){
      if(!quiet)state.lastMessage=errorMessage(error,'Unable to load staged photos.');
    }
    renderStatus();
  }

  function openPhotoPicker(event){
    event?.preventDefault();
    if(state.busy)return;
    const capture=localCapture();
    if(!capture?.id){
      state.lastMessage='Press SALE first. PHOTO is available after McCoy secures the provider attempt.';
      renderStatus();
      return;
    }
    if(state.rows.length>=3){state.lastMessage='This provider attempt already has the 3-photo maximum.';renderStatus();return;}

    // Keep file-input activation inside the original tap. Mobile Safari can block
    // a camera/photo-library picker when input.click() happens after an await.
    const input=byId('salePhotoStageInput');
    input.value='';
    input.click();
    state.lastMessage='Choose a screenshot, Photo Library image, or take a new photo.';
    renderStatus();

    // Validation remains authoritative before upload in handleFileSelection.
    validatedCapture().then(validated=>{
      if(validated)refreshForCapture(validated,true);
      else{state.lastMessage='That provider attempt is no longer open. Press SALE to start a fresh attempt.';renderStatus();}
    }).catch(error=>{state.lastMessage=errorMessage(error,'McCoy could not validate this provider attempt.');renderStatus();});
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
    const selected=event.target?.files?.[0];if(!selected||state.busy)return;
    setBusy(true,'PREPARING…');state.lastMessage='Preparing the image for secure upload…';renderStatus();
    let created=null;
    try{
      const capture=await validatedCapture();
      if(!capture)throw new Error('The provider attempt is no longer open. Press SALE and try again.');
      const file=await normalizeImage(selected);
      if(file.size>MAX_UPLOAD_BYTES)throw new Error('Photo must be 10 MB or less after compression.');
      setBusy(true,'UPLOADING…');state.lastMessage='Creating a private signed upload…';renderStatus();
      created=await invoke('create_upload',{capture_id:capture.id,mime_type:file.type,file_size_bytes:file.size,original_file_name:selected.name||null});
      const upload=await sb.storage.from(BUCKET).uploadToSignedUrl(created.path,created.token,file,{contentType:file.type});
      if(upload.error)throw upload.error;
      await invoke('commit_upload',{photo_id:created.photo_id});
      state.lastMessage='Photo staged privately. It will attach when COMPLETE SALE succeeds.';
      await refreshForCapture(capture,true);
    }catch(error){
      if(created?.photo_id)invoke('abort_upload',{photo_id:created.photo_id}).catch(()=>{});
      state.lastMessage=errorMessage(error,'Photo could not be staged.');
    }
    finally{event.target.value='';setBusy(false);renderStatus();}
  }

  async function discardCapture(captureId,successMessage='Staged photos deleted because the provider attempt was abandoned.'){
    if(!captureId)return;
    setBusy(true,'REMOVING…');state.lastMessage='Deleting staged photos…';renderStatus();
    try{await invoke('discard',{capture_id:captureId});state.rows=[];state.lastMessage=successMessage;}
    catch(error){state.lastMessage=errorMessage(error,'Staged photos could not be deleted.');}
    finally{setBusy(false);renderStatus();}
  }

  async function startExtraction(photoIds,saleId){
    const ids=Array.isArray(photoIds)?photoIds:[];
    const results=await Promise.allSettled(ids.map(photoId=>sb.functions.invoke('sale-order-photo',{body:{action:'process',photo_id:photoId}})));
    const failed=results.filter(result=>result.status==='rejected'||result.value?.error||result.value?.data?.ok===false).length;
    window.dispatchEvent(new CustomEvent('mccoy-sale-order-photo-updated',{detail:{saleId,photoIds:ids,results}}));
    window.dispatchEvent(new CustomEvent('mccoy-sale-details-updated',{detail:{saleId}}));
    return{results,failed};
  }

  async function finalizePhotos(detail,{retry=false}={}){
    const saleId=String(detail?.saleId||detail?.sale_id||''),captureId=String(detail?.providerCaptureId||detail?.capture_id||'');
    if(!saleId||!captureId)return;
    const pending={saleId,providerCaptureId:captureId,createdAt:new Date().toISOString()};
    localStorage.setItem(PENDING_FINALIZE_KEY,JSON.stringify(pending));
    setBusy(true,'ATTACHING…');state.lastMessage=retry?'Retrying photo attachment…':'Sale saved. Attaching staged photo evidence…';renderStatus();
    try{
      const data=await invoke('finalize',{capture_id:captureId,sale_id:saleId});
      localStorage.removeItem(PENDING_FINALIZE_KEY);state.pendingFinalize=null;state.rows=[];state.capture=null;
      const count=Array.isArray(data.sale_photo_ids)?data.sale_photo_ids.length:0;
      state.lastMessage=count?`${count} photo${count===1?'':'s'} attached to the sale. Extracting visible order details…`:'Sale completed with no staged photo.';
      renderStatus();
      if(count){const extraction=await startExtraction(data.sale_photo_ids,saleId);state.lastMessage=extraction.failed?`${count} photo${count===1?'':'s'} attached. Automatic extraction was unavailable for ${extraction.failed}; enter or confirm the information in SALES TO COMPLETE.`:`${count} photo${count===1?'':'s'} attached. Review extracted suggestions in SALES TO COMPLETE.`;}
    }catch(error){
      state.pendingFinalize=pending;
      state.lastMessage=`Sale saved, but photo attachment is pending: ${errorMessage(error)}`;
    }finally{setBusy(false);renderStatus();}
  }

  async function retryPendingFinalize(){
    let pending=null;try{pending=JSON.parse(localStorage.getItem(PENDING_FINALIZE_KEY)||'null');}catch(_){localStorage.removeItem(PENDING_FINALIZE_KEY);}
    if(pending?.saleId&&pending?.providerCaptureId)await finalizePhotos(pending,{retry:true});
  }

  function captureFromEvent(event){return event?.detail?.capture||null;}
  for(const eventName of ['mccoy-provider-sale-capture-ready','mccoy-provider-sale-returned','mccoy-provider-sale-capture-restored']){
    window.addEventListener(eventName,event=>{const capture=captureFromEvent(event);if(capture?.id)refreshForCapture(capture,true);});
  }
  window.addEventListener('mccoy-provider-sale-capture-started',event=>{state.capture=captureFromEvent(event);state.rows=[];state.lastMessage='Provider attempt started. Return from the ISP dashboard, then use PHOTO.';renderStatus();});
  window.addEventListener('mccoy-provider-sale-capture-invalidated',()=>{state.capture=null;state.rows=[];state.lastMessage='The prior provider attempt is no longer usable. Press SALE to start a fresh attempt.';renderStatus();});
  window.addEventListener('mccoy-provider-sale-abandoned',event=>discardCapture(String(event.detail?.providerCaptureId||'')));
  window.addEventListener('mccoy-sale-saved',event=>finalizePhotos(event.detail||{}));
  window.addEventListener('mccoy-sales-hub-layout-ready',ensureControls);
  window.addEventListener('mccoy-access-ready',()=>{ensureControls();retryPendingFinalize();validatedCapture().then(capture=>capture&&refreshForCapture(capture,true)).catch(()=>{});});

  function schedule(){[0,80,220,500,900,1500,2500].forEach(delay=>setTimeout(ensureControls,delay));}
  document.addEventListener('click',event=>{if(event.target?.closest?.('.nav-btn[data-view="field"]'))schedule();},true);
  schedule();
})();
