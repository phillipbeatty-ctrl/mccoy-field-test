import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const coreScope={module:{exports:{}}};vm.runInNewContext(read('./app-lead-address-core.js'),coreScope);
const core=coreScope.module.exports;
const serviceAddress='123 Main St, Apt 2, Portland, OR 97201';
const fields={address1:'123 Main St',address2:'Apt 2',city:'Portland',state:'OR',zip:'97201'};
const copy=value=>JSON.parse(JSON.stringify(value));
function fn(file,name){const source=read(file),start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0);const end=source.indexOf('\n  }',start);assert.ok(end>start);return source.slice(start,end+4);}
function scope(seed={}){const s=vm.createContext({console:{error(){}},...seed});s.window=s;return s;}

test('one-line address parsing preserves unit, city, state and ZIP',()=>{
  for(const value of [serviceAddress,'123 Main St Apt 2, Portland, or 97201','123 Main St, Apt 2, Portland, OR, 97201','123 Main St, Apt 2, Portland, OR 97201, USA'])assert.deepEqual(copy(core.fieldAddress(value)),fields);
  assert.deepEqual(copy(core.fieldAddress('50 Oak Ave #4B, Battle Ground, WA 98604-1234')),{address1:'50 Oak Ave',address2:'#4B',city:'Battle Ground',state:'WA',zip:'98604-1234'});
  assert.equal(core.fieldAddress('123 Suite Street, Portland, OR 97201').address1,'123 Suite Street');
});

test('ambiguous or incomplete addresses do not guess structured pin fields',()=>{
  for(const value of ['', '123 Main St', '123 Main St Portland OR 97201','123 Main St, OR 97201','123 Main St, , OR 97201','123 Main St, Portland, OR','123 Main St, Portland, OR 9720','x'.repeat(241)])assert.equal(core.fieldAddress(value),null,value);
});

test('Sales Hub renders one address input with ADD ADDRESS and no suggestions or second entry action',()=>{
  const source=read('./app-typed-lead-address.js'),markup=source.match(/root.innerHTML='([^\n]+)';/)?.[1];assert.ok(markup);
  assert.equal((markup.match(/<input\b/g)||[]).length,1);
  assert.match(markup,/id="addFieldAddressBtn"[^>]*>ADD ADDRESS/);
  assert.doesNotMatch(markup,/<datalist|\slist=|clearFieldLeadAddress/);
  assert.match(source,/select.hidden=true/);
  const editor=read('./app-field-lead-editor.js');
  const shortcuts=fn('./app-field-lead-editor.js','ensureAddressShortcuts');
  assert.doesNotMatch(shortcuts,/field-lead-combobox|salesHubAddPinBtn/);
  assert.match(editor,/button.addEventListener\('click',addSalesHubAddress\)/);
});

test('ADD ADDRESS uses the same live address line without opening another form',async()=>{
  let supplied;
  const s=scope({creatingLead:false,fieldRole:()=>true,MCCOY_LEAD_ADDRESS_CORE:core,MCCOY_LEAD_ADDRESS:{current:()=>({address:serviceAddress}),revision:()=>3},createLead:async args=>{supplied=args;}});
  vm.runInContext(fn('./app-field-lead-editor.js','addSalesHubAddress'),s);await vm.runInContext('addSalesHubAddress()',s);
  assert.deepEqual(copy(supplied),{suppliedAddress:fields,source:'sales_hub',revision:3});
});

test('an invalid ADD ADDRESS attempt retains an independently usable sale address',async()=>{
  const address='123 Main St Portland OR 97201';let message='',calls=0;
  const s=scope({creatingLead:false,fieldRole:()=>true,MCCOY_LEAD_ADDRESS_CORE:core,MCCOY_LEAD_ADDRESS:{current:()=>({address}),setMessage:text=>{message=text;},focus(){}},createLead:async()=>calls++});
  vm.runInContext(fn('./app-field-lead-editor.js','addSalesHubAddress'),s);await vm.runInContext('addSalesHubAddress()',s);
  assert.equal(calls,0);assert.match(message,/street, city, ST ZIP/);
  assert.equal(core.saleSource({addressContext:core.context({value:address})}).service_address,address);
});

function creationHarness(){
  let resolve,revision=3;const calls=[],messages=[],button={disabled:false,textContent:'ADD ADDRESS'},request=new Promise(done=>{resolve=done});
  const s=scope({creatingLead:false,fieldRole:()=>true,byId:id=>{assert.equal(id,'addFieldAddressBtn');return button;},
    MCCOY_ACCESS:{user:{id:'rep-a'},access:{organization_id:'org-a'}},MCCOY_LEAD_ADDRESS:{revision:()=>revision,setMessage:text=>messages.push(text)},
    addressFields(){throw new Error('second address form read');},inputValue(){throw new Error('unrelated contact form read');},
    call:async(action,body)=>{calls.push({action,body:copy(body)});return request;},
    loadMcCoyLeads:async()=>calls.push('reload'),leadByAnyId:()=>({id:1,dbId:'lead-a'}),showSavedPin:()=>{calls.push('select');return true;}});
  vm.runInContext(fn('./app-field-lead-editor.js','createLead'),s);
  return{s,button,calls,messages,edit:()=>revision++,resolve,start:()=>vm.runInContext('createLead({suppliedAddress:'+JSON.stringify(fields)+',source:"sales_hub",revision:3})',s)};
}

test('one click saves one pin without reading another address or customer form',async()=>{
  const h=creationHarness(),pending=h.start();await h.start();assert.equal(h.calls.length,1);assert.equal(h.button.disabled,true);
  h.resolve({created:true,lead:{id:'lead-a'}});await pending;
  assert.deepEqual(h.calls,[{action:'create_lead',body:fields},'reload','select']);
  assert.match(h.messages.at(-1),/Ready for SALE/);assert.equal(h.button.disabled,false);assert.equal(h.button.textContent,'ADD ADDRESS');
});

for(const change of ['address','account'])test(`a late pin save cannot take over a changed ${change}`,async()=>{
  const h=creationHarness(),pending=h.start(),before=h.messages.length;
  if(change==='address')h.edit();else h.s.MCCOY_ACCESS.user.id='rep-b';
  h.resolve({created:true,lead:{id:'lead-a'}});await pending;
  assert.equal(h.calls.length,1);assert.equal(h.messages.length,before);assert.equal(h.button.disabled,false);
});

test('failed pin creation restores ADD ADDRESS and reports the error in the same line',async()=>{
  const h=creationHarness();h.s.call=async()=>{throw new Error('Map lookup is unavailable. You can still process a sale for this address.');};
  await h.start();assert.equal(h.button.disabled,false);assert.match(h.messages.at(-1),/still process a sale/);
});

test('a loader that resolves an error as [] reports a saved address without a second retry cycle',async()=>{
  const h=creationHarness();let loads=0;
  h.s.loadMcCoyLeads=async()=>{loads++;h.s.MCCOY_LAST_LEAD_LOAD={error:'offline'};return[];};
  const pending=h.start();h.resolve({created:true,lead:{id:'lead-a'}});await pending;
  assert.equal(loads,1);assert.equal(h.calls.includes('select'),false);
  assert.match(h.messages.at(-1),/address was saved, but its pin could not be refreshed/);
  assert.equal(h.button.disabled,false);
});
