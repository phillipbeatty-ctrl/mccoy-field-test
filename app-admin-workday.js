// Admin-only Home-address management and authoritative workday timeline.
(()=>{
  if(window.MCCOY_ADMIN_WORKDAY)return
  window.MCCOY_ADMIN_WORKDAY=true
  const $=id=>document.getElementById(id)
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const seconds=value=>Math.max(0,Number(value)||0)
  const duration=value=>{const total=Math.round(seconds(value)),h=Math.floor(total/3600),m=Math.floor(total%3600/60);return h?`${h}h ${m}m`:`${m}m`}
  const time=(value,zone)=>{if(!value)return'—';try{return new Date(value).toLocaleTimeString([],{timeZone:zone,hour:'numeric',minute:'2-digit'})}catch{return new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}}
  const dateValue=()=>{const d=new Date(),offset=d.getTimezoneOffset();return new Date(d.getTime()-offset*60000).toISOString().slice(0,10)}
  const TYPES={
    working:{label:'Working',color:'#16a34a'},
    allowed_break:{label:'Allowed Break',color:'#2563eb'},
    excessive_idle:{label:'Excessive Idle',color:'#f97316'},
    tracking_gap:{label:'Tracking Gap',color:'#64748b'},
    homeward_travel:{label:'Homeward Travel Excluded',color:'#9333ea'},
  }
  const ZONES=['America/Los_Angeles','America/Denver','America/Chicago','America/New_York']
  let users=[]

  async function edge(action,payload={}){
    const {data,error}=await sb.functions.invoke('admin-workday',{body:{action,...payload}})
    if(error){let detail=error.message||'Request failed.';try{const body=await error.context?.json?.();detail=body?.detail||body?.error||detail}catch{}throw new Error(detail)}
    if(data?.error)throw new Error(data.detail||data.error)
    return data
  }

  function styles(){
    if($('adminWorkdayStyles'))return
    const style=document.createElement('style');style.id='adminWorkdayStyles';style.textContent=`
      #adminWorkdayPanel{display:none;margin-top:14px}#adminWorkdayPanel.show{display:block}
      .aw-head,.aw-controls,.aw-home-head,.aw-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .aw-head h2,.aw-home-head h3{margin:0}.aw-grid{display:grid;gap:10px}.aw-home-list{display:grid;gap:8px;margin-top:12px}
      .aw-home-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(260px,2fr) minmax(180px,1fr) auto;gap:8px;align-items:end;padding:10px;border:1px solid #e5e7eb;border-radius:10px}
      .aw-home-row label,.aw-controls label{display:grid;gap:4px;font-size:10px;font-weight:900;color:#475569;text-transform:uppercase;letter-spacing:.03em}
      .aw-home-row input,.aw-home-row select,.aw-controls input,.aw-controls select{min-width:0;padding:9px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font:inherit}
      .aw-status{min-height:18px;margin-top:8px;font-size:12px;color:#64748b}.aw-status.error{color:#991b1b}.aw-status.success{color:#166534}
      .aw-section{margin-top:18px;padding-top:16px;border-top:1px solid #e5e7eb}.aw-legend{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;font-size:11px}.aw-key{display:flex;align-items:center;gap:5px}.aw-dot{width:10px;height:10px;border-radius:3px}
      .aw-day{margin-top:12px;padding:12px;border:1px solid #e5e7eb;border-radius:12px}.aw-day h3{margin:0;font-size:15px}.aw-metrics{display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;font-size:11px;color:#475569}
      .aw-track{display:flex;width:100%;min-height:36px;margin:12px 0 9px;overflow:hidden;border-radius:8px;background:#e5e7eb}.aw-segment{min-width:2px;border:0;padding:0;position:relative}.aw-segment:focus{outline:3px solid #111827;outline-offset:-3px}.aw-segment:hover{filter:brightness(.9)}
      .aw-detail-list{display:grid;gap:6px}.aw-detail{display:grid;grid-template-columns:12px minmax(110px,.8fr) minmax(105px,.8fr) minmax(85px,.6fr) minmax(140px,1.6fr);gap:8px;align-items:start;padding:7px 0;border-top:1px solid #eef2f7;font-size:11px}.aw-detail:first-child{border-top:0}.aw-detail strong{font-size:11px}.aw-evidence{color:#64748b;line-height:1.35}
      @media(max-width:760px){.aw-home-row{grid-template-columns:1fr}.aw-home-row button{width:100%}.aw-detail{grid-template-columns:12px 1fr 1fr}.aw-evidence{grid-column:2/-1}.aw-track{min-height:46px}}
    `;document.head.appendChild(style)
  }

  function ensurePanel(){
    const teams=$('teams');if(!teams)return null
    styles();let panel=$('adminWorkdayPanel')
    if(!panel){
      panel=document.createElement('section');panel.id='adminWorkdayPanel';panel.setAttribute('aria-label','Admin workday administration')
      panel.innerHTML=`<div class="card"><div class="aw-head"><div><h2>Workday Administration</h2><p class="muted">Admins set Home addresses. Reps cannot enter or change them.</p></div><button id="awRefresh" class="assign-btn" type="button">REFRESH</button></div><div id="awHomeStatus" class="aw-status" role="status" aria-live="polite"></div><div id="awHomeList" class="aw-home-list">Loading users…</div><div class="aw-section"><div class="aw-head"><div><h2>Workday Timeline</h2><p class="muted">Derived segments only. Raw GPS coordinates and Home coordinates are never shown.</p></div><div class="aw-controls"><label>Date<input id="awDate" type="date" max="${dateValue()}" value="${dateValue()}"></label><label>User<select id="awRep"><option value="">All users</option></select></label><button id="awLoadTimeline" class="primary" type="button">LOAD TIMELINE</button></div></div><div class="aw-legend">${Object.entries(TYPES).map(([key,item])=>`<span class="aw-key"><span class="aw-dot" style="background:${item.color}"></span>${esc(item.label)}</span>`).join('')}</div><div id="awTimelineStatus" class="aw-status" role="status" aria-live="polite"></div><div id="awTimeline"></div></div></div>`
      teams.appendChild(panel)
      $('awRefresh').onclick=()=>loadAll()
      $('awLoadTimeline').onclick=()=>loadTimeline()
    }
    return panel
  }

  function zoneOptions(selected){return ZONES.map(zone=>`<option value="${zone}" ${zone===selected?'selected':''}>${zone.replace('America/','').replace('_',' ')}</option>`).join('')}
  function renderHomes(){
    const root=$('awHomeList');if(!root)return
    root.innerHTML=users.length?users.map((user,index)=>`<div class="aw-home-row"><div><strong>${esc(user.display_name)}</strong><div class="muted small">${esc(user.role)}${user.team_name?` · ${esc(user.team_name)}`:''}</div></div><label>Home address<input id="awAddress${index}" autocomplete="street-address" maxlength="240" value="${esc(user.home_label||'')}" placeholder="Street address, city, state ZIP" ${user.user_id?'':'disabled'}></label><label>Local workday timezone<select id="awZone${index}" ${user.user_id?'':'disabled'}>${zoneOptions(user.workday_timezone)}</select></label><button id="awSave${index}" class="primary" type="button" ${user.user_id?'':'disabled'}>${user.home_configured?'UPDATE HOME':'SET HOME'}</button></div>`).join(''):'<div class="muted">No active users found.</div>'
    users.forEach((user,index)=>{const button=$('awSave'+index);if(!button||!user.user_id)return;button.onclick=()=>saveHome(user,index)})
    const rep=$('awRep'),selected=rep.value;rep.innerHTML='<option value="">All users</option>'+users.filter(user=>user.user_id).map(user=>`<option value="${esc(user.user_id)}">${esc(user.display_name)}</option>`).join('');if([...rep.options].some(option=>option.value===selected))rep.value=selected
  }

  async function loadHomes(){
    const status=$('awHomeStatus');status.className='aw-status';status.textContent='Loading Home settings…'
    try{const result=await edge('list_home_settings');users=result.users||[];renderHomes();status.textContent=`${users.filter(user=>user.home_configured).length} of ${users.length} active users have an Admin-set Home address.`}
    catch(error){status.className='aw-status error';status.textContent=error?.message||'Unable to load Home settings.'}
  }

  async function saveHome(user,index){
    const button=$('awSave'+index),input=$('awAddress'+index),zone=$('awZone'+index),status=$('awHomeStatus'),address=String(input.value||'').trim().replace(/\s+/g,' ')
    if(address.length<8){status.className='aw-status error';status.textContent='Enter a complete street address.';input.focus();return}
    button.disabled=true;button.textContent='VERIFYING…';status.className='aw-status';status.textContent=`Verifying ${user.display_name}'s address with Google…`
    try{const result=await edge('set_home',{target_user_id:user.user_id,home_address:address,workday_timezone:zone.value});status.className='aw-status success';status.textContent=`Home saved for ${user.display_name}: ${result.home_label}`;await loadHomes()}
    catch(error){status.className='aw-status error';status.textContent=error?.message||'Unable to save Home address.';button.disabled=false;button.textContent=user.home_configured?'UPDATE HOME':'SET HOME'}
  }

  function evidence(segment){
    const pieces=[]
    if(segment.gps_confidence)pieces.push(`GPS ${segment.gps_confidence}`)
    if(segment.average_accuracy_meters!=null)pieces.push(`avg accuracy ${Math.round(segment.average_accuracy_meters)} m`)
    if(segment.maximum_distance_outside_area_meters!=null)pieces.push(`max ${Math.round(segment.maximum_distance_outside_area_meters)} m outside area`)
    if(segment.gps_sample_count!=null)pieces.push(`${segment.gps_sample_count} sample${segment.gps_sample_count===1?'':'s'}`)
    if(segment.evidence?.movement_meters!=null)pieces.push(`${Math.round(segment.evidence.movement_meters)} m movement`)
    if(segment.evidence?.door_interaction)pieces.push('door interaction')
    const reasons={customer_interaction:'customer interaction',verified_movement:'verified movement',automatic_idle:'automatic inactivity',telemetry_missing_over_15_minutes:'telemetry missing over 15 minutes',location_unavailable:'location unavailable',location_accuracy_over_100m:'location accuracy over 100 m',homeward_travel_and_post_work_idle_excluded:'direct homeward travel with no later field activity'}
    pieces.push(reasons[segment.reason]||String(segment.reason||'derived evidence').replaceAll('_',' '))
    return pieces.join(' · ')
  }

  function renderTimeline(workdays){
    const root=$('awTimeline');if(!root)return
    if(!workdays.length){root.innerHTML='<div class="muted">No workdays were recorded for this date.</div>';return}
    root.innerHTML=workdays.map(day=>{
      const zone=day.timezone||'America/Los_Angeles',span=Math.max(1,new Date(day.calendar_end_at||day.effective_end_at).getTime()-new Date(day.started_at).getTime())
      const bars=(day.segments||[]).map((segment,index)=>{const type=TYPES[segment.type]||TYPES.tracking_gap,width=Math.max(.2,new Date(segment.ended_at).getTime()-new Date(segment.started_at).getTime())/span*100;return `<button class="aw-segment" style="width:${width}%;background:${type.color}" title="${esc(type.label)} · ${esc(time(segment.started_at,zone))}–${esc(time(segment.ended_at,zone))} · ${esc(duration(segment.duration_seconds))}" aria-label="${esc(type.label)}, ${esc(duration(segment.duration_seconds))}" data-detail="awDetail${day.id}-${index}"></button>`}).join('')
      const details=(day.segments||[]).map((segment,index)=>{const type=TYPES[segment.type]||TYPES.tracking_gap;return `<div class="aw-detail" id="awDetail${day.id}-${index}"><span class="aw-dot" style="background:${type.color}"></span><strong>${esc(type.label)}</strong><span>${esc(time(segment.started_at,zone))}–${esc(time(segment.ended_at,zone))}</span><span>${esc(duration(segment.duration_seconds))}</span><span class="aw-evidence">${esc(evidence(segment))}</span></div>`}).join('')
      return `<article class="aw-day"><div class="aw-summary"><div><h3>${esc(day.user_name)}</h3><div class="muted small">${esc(day.work_date)} · ${esc(zone)} · ${esc(day.status)}</div></div><div class="aw-metrics"><span>Working <strong>${duration(day.working_seconds)}</strong></span><span>Break <strong>${duration(day.allowed_break_seconds)}</strong></span><span>Excessive <strong>${duration(day.excessive_idle_seconds)}</strong></span><span>Gap <strong>${duration(day.tracking_gap_seconds)}</strong></span><span>SPH time <strong>${duration(day.sph_counted_seconds)}</strong></span></div></div><div class="aw-track" aria-label="Colorized workday timeline">${bars}</div><div class="aw-detail-list">${details}</div></article>`
    }).join('')
    root.querySelectorAll('.aw-segment').forEach(button=>button.onclick=()=>$(button.dataset.detail)?.scrollIntoView({behavior:'smooth',block:'center'}))
  }

  async function loadTimeline(){
    const status=$('awTimelineStatus'),date=$('awDate')?.value,rep=$('awRep')?.value||null
    status.className='aw-status';status.textContent='Loading authoritative segments…';$('awTimeline').innerHTML=''
    try{const {data,error}=await sb.rpc('get_admin_workday_timeline',{p_work_date:date,p_rep_user_id:rep});if(error||!data?.ok)throw error||new Error(data?.error||'Timeline unavailable');renderTimeline(data.workdays||[]);status.textContent=`Timeline refreshed ${new Date(data.generated_at).toLocaleTimeString()}.`}
    catch(error){status.className='aw-status error';status.textContent=error?.message||'Unable to load the workday timeline.'}
  }

  async function loadAll(){await loadHomes();await loadTimeline()}
  function activate(){
    const panel=ensurePanel(),isAdmin=window.MCCOY_ACCESS?.access?.role==='admin'
    if(!panel)return
    panel.classList.toggle('show',isAdmin)
    if(isAdmin&&!panel.dataset.loaded){panel.dataset.loaded='1';loadAll()}
  }
  window.addEventListener('mccoy-access-ready',activate)
  document.querySelector('.nav-btn[data-view="teams"]')?.addEventListener('click',()=>{activate();if(window.MCCOY_ACCESS?.access?.role==='admin')loadAll()})
  const timer=setInterval(()=>{activate();if(window.MCCOY_ACCESS?.access?.role==='admin')clearInterval(timer)},500)
})();
