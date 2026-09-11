import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

export const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
export const turn=()=>new Promise(resolve=>setImmediate(resolve));
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

export const fieldMarkup=`<button class="nav-btn" data-view="field">Sales Hub</button><section id="field" class="view active"><div class="grid-2">
<div class="card" id="sessionCard"><button id="startKnockingBtn">START SESSION</button></div>
<div class="card" id="statsCard"><span id="elapsed">00:00</span></div>
<div class="card" id="doorCard"><select id="fieldLeadSelect"><option value=""></option></select><button id="arriveDoorBtn">ARRIVED AT DOOR</button><select id="sessionIsp"><option>Ziply</option><option>Fidium</option></select><button id="savePinDispositionBtn">SAVE</button></div>
</div><div id="coachMetrics" class="card">Coach</div></section>`;

export function ui(html=fieldMarkup){
  const dom=new JSDOM('<!doctype html><html><head></head><body>'+html+'</body></html>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://field-coach.test/'});
  const {window}=dom,document=window.document;
  let nextId=0,now=0;const pending=new Map(),intervals=new Map();
  window.setTimeout=(fn,delay=0)=>{const id=++nextId;pending.set(id,{fn,at:now+Number(delay)});return id;};
  window.clearTimeout=id=>pending.delete(id);
  window.setInterval=(fn,delay)=>{const id=++nextId;intervals.set(id,{fn,delay});return id;};
  window.clearInterval=id=>intervals.delete(id);
  window.state={leads:[],realLeads:[],teams:[],activeDoorVisit:null,session:null};
  const load=name=>vm.runInContext(read(name),dom.getInternalVMContext(),{filename:name});
  const clock={pending,intervals,flush(){let count=0;while(pending.size){if(++count>500)throw new Error('Unbounded timer loop');const [id,timer]=[...pending].sort((a,b)=>a[1].at-b[1].at)[0];pending.delete(id);now=timer.at;timer.fn();}return count;}};
  const emit=(name,detail)=>window.dispatchEvent(new window.CustomEvent(name,{detail}));
  const type=(input,value)=>{input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));};
  load('app-ui-refresh.js');
  return{window,document,load,clock,emit,type,close:()=>dom.window.close()};
}

export function loadAddress(h,leads=[]){
  h.window.state.leads=leads;h.window.state.realLeads=leads;
  h.load('app-field-features.js');h.load('app-door-workflow-core.js');h.load('app-lead-address-core.js');h.load('app-typed-lead-address.js');
  h.clock.flush();return h.document.getElementById('fieldLeadAddressInput');
}
