(()=>{
  const SUPABASE_URL='https://athxxrfqxwlfnuvbqadp.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT';
  const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  const byId=id=>document.getElementById(id);
  const number=value=>Number.isFinite(Number(value))?Number(value):null;
  const meters=value=>number(value)==null?'—':`${Math.round(Number(value)).toLocaleString()} m`;
  const coordinate=value=>number(value)==null?'—':Number(value).toFixed(7);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const columns=[
    ['original_address','Original address'],['standardized_address','Standardized address'],['place_id','Place ID'],
    ['old_latitude','Old latitude'],['old_longitude','Old longitude'],['google_latitude','Google latitude'],['google_longitude','Google longitude'],
    ['field_confirmed_latitude','Field latitude'],['field_confirmed_longitude','Field longitude'],['field_confirmation_source','Field source'],
    ['old_to_google_meters','Old → Google'],['google_to_field_meters','Google → field'],['possible_next_action','Google action'],
    ['validation_granularity','Validation granularity'],['geocode_granularity','Geocode granularity'],['address_complete','Complete'],
    ['api_status','API status'],['api_error','API error'],['lead_id','Lead ID']
  ];

  function setStatus(text,tone=''){
    byId('status').textContent=text;
    byId('status').dataset.tone=tone;
  }

  function render(data){
    const rows=Array.isArray(data?.rows)?data.rows:[],summary=data?.summary||{},distance=summary.old_to_google_meters||{};
    byId('summary').innerHTML=`<strong>${Number(summary.validated||0).toLocaleString()} of ${Number(summary.returned||0).toLocaleString()} validated</strong>
      · ${Number(summary.moved_over_25m||0).toLocaleString()} moved over 25 m
      · ${Number(summary.moved_over_50m||0).toLocaleString()} moved over 50 m
      · ${Number(summary.moved_over_100m||0).toLocaleString()} moved over 100 m
      · median ${meters(distance.median)} · p90 ${meters(distance.p90)} · max ${meters(distance.max)}
      · ${Number(summary.field_confirmed||0).toLocaleString()} field-confirmed.`;
    byId('head').innerHTML=columns.map(([,label])=>`<th>${escapeHtml(label)}</th>`).join('');
    byId('body').innerHTML=rows.map(row=>`<tr>${columns.map(([key])=>{
      let value=row[key];
      if(key.endsWith('_latitude')||key.endsWith('_longitude'))value=coordinate(value);
      if(key.endsWith('_meters'))value=meters(value);
      if(key==='address_complete')value=value===true?'Yes':value===false?'No':'—';
      return `<td>${escapeHtml(value==null||value===''?'—':value)}</td>`;
    }).join('')}</tr>`).join('');
    byId('raw').textContent=JSON.stringify(data,null,2);
    byId('results').hidden=false;
  }

  async function run(){
    const button=byId('runPilot');
    button.disabled=true;button.textContent='RUNNING 100-LEAD PILOT…';
    byId('results').hidden=true;
    setStatus('Selecting 100 suspicious coordinate stacks and validating their addresses…');
    try{
      const {data,error}=await client.functions.invoke('address-validation-pilot',{body:{action:'run_read_only_pilot',limit:100}});
      if(error||!data?.ok)throw error||new Error(data?.detail||data?.error||'pilot_failed');
      render(data);
      const errors=Object.entries(data?.summary?.errors||{}).map(([key,count])=>`${key}: ${count}`).join(', ');
      setStatus(errors?`Pilot completed read-only, but Google returned errors: ${errors}`:'Pilot completed read-only. No lead data was changed.',errors?'error':'ok');
    }catch(error){
      let detail=error?.message||String(error);
      try{const payload=await error?.context?.json?.();detail=payload?.detail||payload?.error||detail;}catch{}
      setStatus(`Pilot stopped safely: ${detail}`,'error');
    }finally{
      button.disabled=false;button.textContent='RUN 100-LEAD READ-ONLY PILOT';
    }
  }

  async function initialize(){
    const button=byId('runPilot');
    try{
      const {data:{session}}=await client.auth.getSession();
      if(!session?.user?.email)throw new Error('Sign in to McCoy in this browser first.');
      const {data:access,error}=await client.from('app_user_access').select('role,active').eq('email',session.user.email.toLowerCase()).maybeSingle();
      if(error)throw error;
      if(!access?.active||access.role!=='admin')throw new Error('Active Admin access is required.');
      button.disabled=false;button.textContent='RUN 100-LEAD READ-ONLY PILOT';
      setStatus('Admin access verified. Ready to run the confirmed read-only pilot.','ok');
    }catch(error){
      button.disabled=true;button.textContent='ADMIN ACCESS REQUIRED';
      setStatus(error?.message||String(error),'error');
    }
  }

  byId('runPilot').addEventListener('click',run);
  initialize();
})();
