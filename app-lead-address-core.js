(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MCCOY_LEAD_ADDRESS_CORE=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  const MIN_ADDRESS_LENGTH=5,MAX_ADDRESS_LENGTH=240;

  function cleanAddress(value){
    return String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,MAX_ADDRESS_LENGTH);
  }
  function normalizeAddress(value){
    return cleanAddress(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  }
  function leadLabels(lead){
    if(!lead)return[];
    const street=cleanAddress(lead.address||[lead.address1,lead.address2].filter(Boolean).join(' '));
    const locality=[lead.city,[lead.stateCode||lead.state,lead.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [...new Set([lead.fullAddress,locality?`${street}, ${locality}`:street,street].map(cleanAddress).filter(Boolean))];
  }
  function matchingLeads(value,leads){
    const key=normalizeAddress(value);if(!key)return[];
    // Do not attach a sale to a different city or apartment by street alone.
    return (Array.isArray(leads)?leads:[]).filter(lead=>normalizeAddress(leadLabels(lead)[0])===key);
  }
  function selectedLead(selectedId,leads){
    const value=String(selectedId||'');
    return (Array.isArray(leads)?leads:[]).find(lead=>String(lead.id)===value||String(lead.dbId)===value)||null;
  }
  function context({value,leads,selectedId}={}){
    const address=cleanAddress(value),selected=selectedLead(selectedId,leads);
    if(selected&&normalizeAddress(leadLabels(selected)[0])===normalizeAddress(address)){
      return{kind:'assigned',address:leadLabels(selected)[0]||address,lead:selected,valid:true};
    }
    const matches=matchingLeads(address,leads);
    if(matches.length===1)return{kind:'assigned',address:leadLabels(matches[0])[0]||address,lead:matches[0],valid:true};
    if(!address)return{kind:'empty',address:'',lead:null,valid:false};
    if(address.length<MIN_ADDRESS_LENGTH)return{kind:'invalid',address,lead:null,valid:false,reason:'address_too_short'};
    return{kind:'typed',address,lead:null,valid:true,ambiguousAssignedMatch:matches.length>1};
  }
  function adHocLead(address){
    const clean=cleanAddress(address);
    return{id:`typed:${normalizeAddress(clean)}`,dbId:null,address:clean,fullAddress:clean,team:'Ad-hoc',isDemo:false,isAdHoc:true,selectionSource:'typed_address',disposition:'Prospecting',stage:'Prospecting',pinColor:'#fbbf24',pinColorSource:'stage'};
  }
  function saleSource({addressContext,activeVisit,sessionId=null}={}){
    if(!addressContext?.valid)return null;
    const address=cleanAddress(addressContext.address);
    if(address.length<MIN_ADDRESS_LENGTH)return null;
    const lead=addressContext.kind==='assigned'?addressContext.lead:null;
    const visitLead=activeVisit?.lead;
    const sameVisit=Boolean(activeVisit?.serverVisitId&&(lead?.dbId
      ?String(lead.dbId)===String(visitLead?.dbId)
      :!visitLead?.dbId&&normalizeAddress(address)===normalizeAddress(leadLabels(visitLead)[0])));
    const lat=lead?.lat??lead?.latitude,lng=lead?.lng??lead?.longitude;
    const mapped=lat!=null&&lng!=null&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lng))<=180;
    return{
      sale_context:'field',session_id:sessionId,lead_id:lead?.dbId||null,
      lead_label:address,service_address:address,
      source:'sales_hub',selection_source:lead?'manual_lead':'typed_address',
      source_door_visit_id:sameVisit?activeVisit.serverVisitId:null,
      preserve_active_visit:!sameVisit,
      customer_map_location:mapped?{latitude:Number(lat),longitude:Number(lng)}:null
    };
  }
  return{MIN_ADDRESS_LENGTH,MAX_ADDRESS_LENGTH,cleanAddress,normalizeAddress,leadLabels,matchingLeads,selectedLead,context,adHocLead,saleSource};
});
