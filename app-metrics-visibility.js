// Metrics Visibility uses the existing analytics services for every active user.
(()=>{
  const $=id=>document.getElementById(id)
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
  const isAdmin=()=>window.MCCOY_ACCESS?.access?.role==='admin'
  let users=[]
  let metrics=new Map()
  let selectedEmail=''
  let ready=false

  const css=document.createElement('style')
  css.textContent='.metrics-grid{display:grid;grid-template-columns:minmax(250px,.7fr) minmax(0,1.5fr);gap:10px;margin-top:10px;align-items:start}.metrics-list{display:grid;gap:6px;max-height:650px;overflow:auto}.metrics-person{display:flex;justify-content:space-between;gap:8px;width:100%;padding:9px 11px;text-align:left;background:#fff;border:1px solid #e5e7eb;border-radius:10px}.metrics-person.active{background:#f3f4f6;border-color:#111827}.metrics-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.metrics-kpi{padding:9px;border:1px solid #e5e7eb;border-radius:10px}.metrics-kpi span{display:block;color:#6b7280;font-size:12px}.metrics-kpi strong{font-size:20px}.metrics-control{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #eee}.metrics-always{font-size:12px;font-weight:700;color:#166534}@media(max-width:850px){.metrics-grid{grid-template-columns:1fr}.metrics-kpis{grid-template-columns:repeat(2,1fr)}}'
  document.head.appendChild(css)

  async function visibility(method='GET',body){
    const {data:{session}}=await sb.auth.getSession()
    if(!session)throw Error('not_signed_in')
    const response=await fetch(SUPABASE_URL+'/functions/v1/metrics-visibility',{
      method,
      headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined
    })
    const data=await response.json().catch(()=>({}))
    if(!response.ok)throw Error(data.error||'metrics_visibility_failed')
    return data
  }

  async function summary(email){
    const {data,error}=await sb.functions.invoke('rep-coach-summary',{body:{tester_email:email}})
    if(error)throw error
    return data?.summary||null
  }

  function advice(summaryData){
    if(!summaryData)return['Complete a tracked field session to establish a coaching baseline.']
    const doors=+summaryData.doors||0
    const contacts=+summaryData.contacts||0
    const sales=+summaryData.sales||0
    const hours=Math.max((+summaryData.duration_ms||0)/36e5,0)
    const recommendations=[]
    if(doors<10)recommendations.push('Track at least 20 doors in a session before changing your approach.')
    if(hours&&doors/hours<12)recommendations.push('Tighten route flow and aim for at least 12 tracked doors per field hour.')
    if(doors>=10&&contacts/doors<.25)recommendations.push('Contact rate is below 25%; revisit knock timing and return to not-home doors.')
    if(contacts>=5&&sales/contacts<.1)recommendations.push('Close rate is below 10%; practice discovery questions and a direct next-step close.')
    if(+summaryData.transition?.average_ms>18e4)recommendations.push('Average transition exceeds three minutes; cluster the next doors before leaving each address.')
    return recommendations.length?recommendations:['No major flag is present. Keep the current route pace and repeat what worked in completed conversations.']
  }

  function detail(user){
    const root=$('metricsDetail')
    if(!root||!user)return
    const metric=metrics.get(user.email)
    if(metric===undefined){root.innerHTML='<span class="muted">Loading metrics…</span>';return}
    if(!metric){
      root.innerHTML='<h2>'+esc(user.display_name||user.email)+'</h2><p class="muted">No tracked field session yet.</p><h3>Recommendations</h3><ul><li>'+esc(advice(null)[0])+'</li></ul>'
      return
    }
    const doors=+metric.doors||0
    const contacts=+metric.contacts||0
    const sales=+metric.sales||0
    const hours=Math.max((+metric.duration_ms||0)/36e5,0)
    const values=[['Doors',doors],['Contacts',contacts],['Sales',sales],['Contact rate',doors?Math.round(contacts/doors*100)+'%':'—'],['Close rate',contacts?Math.round(sales/contacts*100)+'%':'—'],['Doors / hour',hours?(doors/hours).toFixed(1):'—'],['Avg transition',metric.transition?.average_ms!=null?(metric.transition.average_ms/1000).toFixed(1)+' sec':'—'],['Avg contact',metric.dwell?.contacted_ms!=null?(metric.dwell.contacted_ms/1000).toFixed(1)+' sec':'—']]
    root.innerHTML='<h2>'+esc(user.display_name||user.email)+'</h2><p class="muted">Latest session · '+esc(metric.started_at?new Date(metric.started_at).toLocaleString():'Unknown date')+'</p><div class="metrics-kpis">'+values.map(value=>'<div class="metrics-kpi"><span>'+esc(value[0])+'</span><strong>'+esc(value[1])+'</strong></div>').join('')+'</div><h3>Door-knocking recommendations</h3><ul>'+advice(metric).map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>'
  }

  function list(){
    const root=$('metricsRepList')
    if(!root)return
    root.innerHTML=users.map(user=>{const metric=metrics.get(user.email);return '<button class="metrics-person '+(user.email===selectedEmail?'active':'')+'" data-email="'+esc(user.email)+'"><span><strong>'+esc(user.display_name||user.email)+'</strong><small class="muted" style="display:block">'+esc(user.role||'user')+'</small></span><small class="muted">'+esc(metric?.doors??'—')+' doors · '+esc(metric?.contacts??'—')+' contacts</small></button>'}).join('')||'<span class="muted">No active users available.</span>'
    root.querySelectorAll('button').forEach(button=>button.onclick=()=>{const user=users.find(entry=>entry.email===button.dataset.email);if(!user)return;selectedEmail=user.email;list();detail(user)})
  }

  async function load(force=false){
    const notice=$('metricsPageNotice')
    if(!notice||(!force&&metrics.size))return
    notice.textContent='Loading field metrics…'
    metrics.clear()
    try{
      let visibilityData=null
      if(isAdmin()){visibilityData=await visibility();users=visibilityData.users||visibilityData.reps||[]}
      else{const access=window.MCCOY_ACCESS?.access||{},authUser=window.MCCOY_ACCESS?.user;users=[{email:String(authUser?.email||'').toLowerCase(),display_name:access.display_name,role:access.role}].filter(user=>user.email)}
      if(!users.some(user=>user.email===selectedEmail))selectedEmail=users[0]?.email||''
      list()
      const selected=users.find(user=>user.email===selectedEmail)
      if(selected)detail(selected)
      await Promise.all(users.map(async user=>{try{metrics.set(user.email,await summary(user.email))}catch(error){console.error(error);metrics.set(user.email,null)}}))
      list()
      const refreshedSelection=users.find(user=>user.email===selectedEmail)
      if(refreshedSelection)detail(refreshedSelection)
      notice.textContent='Updated '+new Date().toLocaleTimeString()+' · '+users.length+' active user'+(users.length===1?'':'s')+' visible'+(isAdmin()?' · Admin access always on':'')
    }catch(error){console.error(error);notice.textContent=error.message||'Unable to load metrics.'}
  }

  function setup(){
    if(ready)return
    const teamsSection=$('teams')
    if(!teamsSection)return
    ready=true
    const block=document.createElement('div')
    block.id='metrics-visibility-block'
    block.innerHTML='<div class="card" style="margin-top:14px"><div class="card-head"><div><h2>Metrics Visibility</h2><p id="metricsPageIntro" class="muted">Field performance and coaching for every active McCoy user. Admin can always see all users; other access remains role- and assignment-scoped.</p></div><button id="metricsPageRefresh" class="assign-btn">Refresh</button></div><div id="metricsPageNotice" class="muted small">Open this page to load metrics.</div></div><div class="metrics-grid"><div class="card"><h2>All Active Users</h2><div id="metricsRepList" class="metrics-list"></div></div><div id="metricsDetail" class="card"><span class="muted">Select a user.</span></div></div>'
    teamsSection.appendChild(block)
    window.MCCOY_WRAP_EXPLANATION?.(document.getElementById('metricsPageIntro'),'What this page shows')
    document.querySelector('.nav-btn[data-view="teams"]')?.addEventListener('click',()=>load())
    $('metricsPageRefresh').onclick=()=>load(true)
  }

  window.addEventListener('mccoy-access-ready',setup)
  const timer=setInterval(()=>{if(!window.MCCOY_ACCESS?.access)return;clearInterval(timer);setup()},300)
})()
