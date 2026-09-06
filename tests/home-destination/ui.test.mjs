import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from 'jsdom'
const ui=readFileSync(new URL('../../app-admin-workday.js',import.meta.url),'utf8')
const statusUi=readFileSync(new URL('../../app-sph-home-admin-only.js',import.meta.url),'utf8')
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const roster=[1,2,3].map(n=>({user_id:'rep'+n,display_name:'Rep '+n,role:'rep',home_configured:false,home_label:'',workday_timezone:'America/New_York'}))
async function setup(role='manager',invoke){
 const dom=new JSDOM('<html><head></head><body><button class="nav-btn" data-view="teams"></button><div id="field"><section id="sphWorkdayControl"><span id="sphWorkdayTitle"></span><strong id="sphHomeAddressDisplay"></strong><button id="sphEditHome"></button></section></div><div id="teams"></div></body></html>',{runScripts:'outside-only',url:'https://example.test'})
 const w=dom.window,calls=[]
 w.HTMLElement.prototype.scrollIntoView=function(){}
 w.MCCOY_ACCESS={user:{id:'actor'},access:{active:true,role,organization_id:'org'}}
 w.sb={functions:{invoke:async(name,{body})=>{calls.push(body);return invoke?invoke(body):{data:body.action==='list_home_settings'?{users:structuredClone(roster)}:{ok:true,updated_count:body.target_user_ids.length,home_label:body.home_address,workday_timezone:body.workday_timezone}}}},rpc:async()=>{calls.push({action:'timeline'});return{data:{ok:true,workdays:[],generated_at:new Date().toISOString()}}}}
 w.eval(ui);w.eval(statusUi)
 w.dispatchEvent(new w.CustomEvent('mccoy-sph-workday-ready',{detail:{homeConfigured:false,homeLabel:''}}))
 await tick();return{dom,w,d:w.document,calls}
}
test('manager editor is reachable in Sales Hub and never requests Admin timeline',async()=>{
 const {dom,w,d,calls}=await setup()
 assert.equal(d.getElementById('adminWorkdayPanel').parentElement.id,'field')
 assert.equal(d.getElementById('awTimelineSection').hidden,true)
 assert.equal(calls.some(c=>c.action==='timeline'),false)
 d.getElementById('sphManageHomes').click()
 assert.equal(d.getElementById('awDestinationDetails').open,true)
 dom.window.close()
})
test('bulk save updates selected users and preserves another unfinished address',async()=>{
 const {dom,d,calls}=await setup()
 d.getElementById('awAddress2').value='unfinished draft'
 for(const i of [0,1]){const box=d.getElementById('awSelected'+i);box.click()}
 d.getElementById('awBulkAddress').value='100 Hotel Street, Test City, NY 10001'
 d.getElementById('awBulkZone').value='America/Chicago'
 d.getElementById('awBulkSave').click();await tick()
 const save=calls.find(c=>c.action==='set_homes')
 assert.deepEqual(Array.from(save.target_user_ids),['rep1','rep2'])
 assert.equal(d.getElementById('awAddress2').value,'unfinished draft')
 assert.equal(d.getElementById('awZone0').value,'America/Chicago')
 assert.match(d.getElementById('awHomeStatus').textContent,/saved for 2 users/)
 assert.equal(d.getElementById('awSelected0').checked,false)
 dom.window.close()
})
test('failed save retains address and selection and allows retry',async()=>{
 const {dom,d}=await setup('manager',body=>body.action==='list_home_settings'?{data:{users:structuredClone(roster)}}:{data:{error:'rejected',detail:'An assignment changed.'}})
 d.getElementById('awSelected0').click();d.getElementById('awBulkAddress').value='100 Hotel Street, Test City, NY 10001';d.getElementById('awBulkZone').value='America/New_York'
 d.getElementById('awBulkSave').click();await tick()
 assert.match(d.getElementById('awHomeStatus').textContent,/assignment changed/)
 assert.equal(d.getElementById('awSelected0').checked,true)
 assert.equal(d.getElementById('awBulkSave').disabled,false)
 assert.equal(d.getElementById('awBulkAddress').value,'100 Hotel Street, Test City, NY 10001')
 dom.window.close()
})
test('rep sees saved end-of-shift destination and no editor',async()=>{
 const {dom,w,d,calls}=await setup('rep')
 w.dispatchEvent(new w.CustomEvent('mccoy-sph-workday-ready',{detail:{homeConfigured:true,homeLabel:'100 Current Lodging Street'}}))
 assert.equal(d.getElementById('sphHomeAddressDisplay').textContent,'100 Current Lodging Street')
 assert.equal(d.getElementById('sphManageHomes'),null)
 assert.equal(d.getElementById('adminWorkdayPanel'),null)
 assert.equal(d.getElementById('sphEditHome'),null)
 assert.equal(calls.length,0)
 dom.window.close()
})
test('an account switch discards a previous manager roster response',async()=>{
 let resolve
 const pending=new Promise(r=>resolve=r)
 const {dom,w,d}=await setup('manager',()=>pending)
 w.MCCOY_ACCESS={user:{id:'rep'},access:{active:true,role:'rep',organization_id:'org'}}
 w.dispatchEvent(new w.Event('mccoy-access-ready'))
 resolve({data:{users:structuredClone(roster)}});await tick()
 assert.equal(d.getElementById('adminWorkdayPanel'),null)
 assert.equal(d.body.textContent.includes('Rep 1'),false)
 dom.window.close()
})
