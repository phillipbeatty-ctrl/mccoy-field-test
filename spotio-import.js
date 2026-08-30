const SUPABASE_URL='https://athxxrfqxwlfnuvbqadp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const authMsg=document.getElementById('authMsg');
const uploadMsg=document.getElementById('uploadMsg');
const signInBtn=document.getElementById('signIn');
const uploadBtn=document.getElementById('upload');
const importType=document.getElementById('importType');
const fileInput=document.getElementById('file');
const policyEnrich=document.getElementById('policyEnrich');
const policyUnits=document.getElementById('policyUnits');
const policyDistinct=document.getElementById('policyDistinct');

function setAuth(message,ok=false){authMsg.textContent=message;authMsg.style.color=ok?'#166534':'#991b1b';}
async function verifyAdmin(){
  const {data:{user},error:userError}=await sb.auth.getUser();
  if(userError||!user?.email)throw new Error(userError?.message||'No signed-in McCoy user found.');
  const {data:access,error:accessError}=await sb.from('app_user_access').select('role,active,display_name').eq('email',user.email.toLowerCase()).maybeSingle();
  if(accessError)throw accessError;
  if(!access?.active||access.role!=='admin')throw new Error('Admin access required.');
  return {user,access};
}
async function restoreSession(){
  try{const {data:{session}}=await sb.auth.getSession();if(!session)return;const {access}=await verifyAdmin();setAuth(`Already signed in as ${access.display_name||session.user.email}.`,true);signInBtn.textContent='SIGNED IN';}
  catch{await sb.auth.signOut().catch(()=>{});}
}
signInBtn.addEventListener('click',async()=>{
  try{
    signInBtn.disabled=true;setAuth('Signing in…',true);
    const email=document.getElementById('email').value.trim().toLowerCase();
    const password=document.getElementById('password').value;
    if(!email||!password)throw new Error('Enter your McCoy Admin email and password.');
    const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;
    const {access}=await verifyAdmin();setAuth(`Admin signed in as ${access.display_name||email}.`,true);signInBtn.textContent='SIGNED IN';
  }catch(error){await sb.auth.signOut().catch(()=>{});setAuth(error?.message||String(error));signInBtn.textContent='SIGN IN';}
  finally{signInBtn.disabled=false;}
});

function refreshImportHelp(){
  document.getElementById('spotioHelp').style.display=importType.value==='spotio_json'?'block':'none';
  document.getElementById('csvHelp').style.display=importType.value==='csv'?'block':'none';
}
importType.addEventListener('change',refreshImportHelp);
function detectImportType(file,text=''){
  const name=String(file?.name||'').toLowerCase(),mime=String(file?.type||'').toLowerCase();
  if(name.endsWith('.csv')||mime.includes('csv'))return'csv';
  if(name.endsWith('.json')||mime.includes('json'))return'spotio_json';
  const sample=String(text||'').trimStart();
  if(sample.startsWith('{')||sample.startsWith('['))return'spotio_json';
  if(sample.includes(',')&&(sample.includes('\n')||sample.includes('\r')))return'csv';
  return importType.value;
}
fileInput.addEventListener('change',()=>{
  const files=[...(fileInput.files||[])];if(!files.length)return;
  const detected=detectImportType(files[0]);
  if(detected!==importType.value){importType.value=detected;refreshImportHelp();}
  uploadMsg.style.color='#166534';
  uploadMsg.textContent=`${files.length.toLocaleString()} ${files.length===1?'file':'files'} selected. The same provider lead will enrich its existing McCoy record; separate provider IDs and units remain separate.`;
});

function parseCSV(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let index=0;index<text.length;index++){
    const character=text[index],next=text[index+1];
    if(character==='"'){if(quoted&&next==='"'){field+='"';index++;}else quoted=!quoted;}
    else if(character===','&&!quoted){row.push(field);field='';}
    else if((character==='\n'||character==='\r')&&!quoted){if(character==='\r'&&next==='\n')index++;row.push(field);field='';if(row.some(value=>value!==''))rows.push(row);row=[];}
    else field+=character;
  }
  row.push(field);if(row.some(value=>value!==''))rows.push(row);
  if(!rows.length)return{headers:[],rows:[]};
  const headers=rows[0].map((header,index)=>(header||`column_${index+1}`).trim().replace(/^\uFEFF/,''));
  return{headers,rows:rows.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??''])))};
}
async function callImport(session,body){
  const response=await fetch(`${SUPABASE_URL}/functions/v1/spotio-import`,{
    method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    if(data?.preflight_rejected){
      const valid=Number(data.valid_records||0).toLocaleString(),input=Number(data.input_records||0).toLocaleString();
      throw new Error(`Import rejected before live changes: ${valid} of ${input} rows had usable addresses. ${data.reason||'Capture format needs review'}. Existing leads were retained.`);
    }
    throw new Error(data.detail||data.error||`Upload failed (${response.status})`);
  }
  return data;
}
function resultSummary(result){
  return[
    `${Number(result.created||0).toLocaleString()} new`,
    `${Number(result.updated||0).toLocaleString()} enriched`,
    `${Number(result.unchanged||0).toLocaleString()} unchanged`,
    `${Number(result.missing_retained||0).toLocaleString()} missing but retained`,
    `${Number(result.archived||0).toLocaleString()} explicitly archived`,
    `${Number(result.collisions||0).toLocaleString()} collisions`,
    `${Number(result.quarantined||0).toLocaleString()} quarantined`,
    `${Number(result.duplicate_input_records||0).toLocaleString()} repeat rows merged into durable leads`,
  ].join(' | ');
}
function parseJsonRecords(raw){
  const captures=Array.isArray(raw?.captures)?raw.captures:[];
  const domLeads=Array.isArray(raw?.dom_leads)?raw.dom_leads:[];
  if(domLeads.length){
    return{records:domLeads,metadata:{source:'spotio_dom_capture',capture_mode:'dom_rows',source_origin:raw.source_origin||null,started_at:raw.started_at||null,finished_at:raw.finished_at||null,summary:raw.summary||null,api_capture_count:captures.length,dom_row_count:domLeads.length,duplicate_policy:'enrich_existing_preserve_distinct_ids_and_units'}};
  }
  if(captures.length){
    return{records:captures,metadata:{source:'spotio_browser_capture',capture_mode:'api_responses',source_origin:raw.source_origin||null,started_at:raw.started_at||null,finished_at:raw.finished_at||null,summary:raw.summary||null,duplicate_policy:'enrich_existing_preserve_distinct_ids_and_units'}};
  }
  if(Array.isArray(raw))return{records:raw,metadata:{source:'spotio_legacy_array',capture_mode:'legacy',duplicate_policy:'enrich_existing_preserve_distinct_ids_and_units'}};
  return{records:[],metadata:{}};
}
async function uploadOne(session,file,fileNumber,totalFiles){
  const prefix=totalFiles>1?`File ${fileNumber} of ${totalFiles}: `:'';
  uploadMsg.textContent=`${prefix}Reading ${file.name}…`;
  const fileText=await file.text(),type=detectImportType(file,fileText);
  let records=[],metadata={};
  if(type==='csv'){
    const parsed=parseCSV(fileText);if(!parsed.headers.length)throw new Error(`${file.name}: CSV has no header row.`);
    records=parsed.rows;metadata={headers:parsed.headers,source:'csv',duplicate_policy:'enrich_existing_preserve_distinct_ids_and_units'};
  }else{
    let raw;try{raw=JSON.parse(fileText);}catch{throw new Error(`${file.name}: selected JSON is not valid JSON.`);}
    ({records,metadata}=parseJsonRecords(raw));
    if(!records.length)throw new Error(`${file.name}: no SPOTIO lead rows or captured responses were found.`);
  }
  const init=await callImport(session,{action:'init',source_filename:file.name,source_type:type,captured_at:new Date().toISOString(),record_count:records.length,metadata});
  const batchId=init.batch.id,isDom=type==='spotio_json'&&metadata.capture_mode==='dom_rows';
  const chunkSize=type==='csv'||isDom?250:20,totalChunks=Math.ceil(records.length/chunkSize);
  for(let index=0;index<totalChunks;index++){
    uploadMsg.textContent=`${prefix}Uploading chunk ${index+1} of ${totalChunks} from ${file.name}…`;
    await callImport(session,{action:'chunk',batch_id:batchId,chunk_index:index,records:records.slice(index*chunkSize,(index+1)*chunkSize)});
  }
  uploadMsg.textContent=`${prefix}Finalizing ${file.name}…`;
  await callImport(session,{action:'finalize',batch_id:batchId});
  uploadMsg.textContent=`${prefix}Matching durable identities, enriching duplicates, and preserving units…`;
  const result=await callImport(session,{action:'normalize',batch_id:batchId});
  return{file:file.name,batchId,result};
}

uploadBtn.addEventListener('click',async()=>{
  try{
    uploadBtn.disabled=true;
    const files=[...(fileInput.files||[])];if(!files.length)throw new Error('Choose one or more JSON or CSV files first.');
    if(!policyEnrich?.checked||!policyUnits?.checked||!policyDistinct?.checked)throw new Error('All permanent identity and unit-preservation controls must remain enabled.');
    uploadMsg.style.color='#374151';uploadMsg.textContent='Checking Admin session…';
    await verifyAdmin();const{data:{session}}=await sb.auth.getSession();if(!session)throw new Error('Sign in as Admin first.');
    const completed=[];
    for(let index=0;index<files.length;index++)completed.push(await uploadOne(session,files[index],index+1,files.length));
    const totals=completed.reduce((sum,item)=>{
      for(const key of ['created','updated','unchanged','missing_retained','archived','collisions','quarantined','duplicate_input_records'])sum[key]=(sum[key]||0)+Number(item.result[key]||0);
      return sum;
    },{});
    const complete=completed.every(item=>item.result.complete===true);
    const summary=resultSummary(totals);
    localStorage.setItem('mccoy_lead_pool_refresh_required',String(Date.now()));
    uploadMsg.style.color=complete?'#166534':'#991b1b';
    uploadMsg.innerHTML=`<strong>${complete?'IMPORT COMPLETE':'IMPORT NEEDS REVIEW'}.</strong> ${summary}. Existing assignments and newer McCoy field activity were preserved. Different units and different provider lead IDs remain separate. <a href="/?leadRefresh=${Date.now()}#leads">OPEN THE REFRESHED LEAD POOL</a>. Batches: ${completed.map(item=>item.batchId).join(', ')}.`;
  }catch(error){uploadMsg.style.color='#991b1b';uploadMsg.textContent=error?.message||String(error);}
  finally{uploadBtn.disabled=false;}
});
restoreSession();
