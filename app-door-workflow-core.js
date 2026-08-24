(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MCCOY_DOOR_WORKFLOW_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const QUARTER_MILE_METERS=402.336;
  const ACTIVITY_TYPES=['Visit','Call','Appointment','Text','Qualify','Investigate & Estimate','Make a Proposal','Get Feedback'];
  const VISIT_RESULTS=[
    {label:'No Answer',color:'#fbbf24'},
    {label:'Contacted',color:'#9ca3af'},
    {label:'Follow-Up',color:'#3b82f6'}
  ];
  const STAGES=[
    {label:'Prospecting',color:'#fbbf24'},
    {label:'Hot Lead',color:'#c4b5fd'},
    {label:'Contacted',color:'#93c5fd'},
    {label:'Follow Up',color:'#1d4ed8'},
    {label:'Migrator',color:'#f97316'},
    {label:'Existing Customer',color:'#ffffff'},
    {label:'SMB',color:'#ec4899'},
    {label:'Sale Made',color:'#22c55e'},
    {label:'No Sale',color:'#9ca3af'},
    {label:'Admin Hold',color:'#581c87'}
  ];

  function finiteCoordinate(value,min,max){
    const number=Number(value);
    return Number.isFinite(number)&&number>=min&&number<=max?number:null;
  }

  function metersBetween(left,right){
    const lat1=finiteCoordinate(left?.lat??left?.latitude,-90,90),lng1=finiteCoordinate(left?.lng??left?.longitude,-180,180);
    const lat2=finiteCoordinate(right?.lat??right?.latitude,-90,90),lng2=finiteCoordinate(right?.lng??right?.longitude,-180,180);
    if(lat1===null||lng1===null||lat2===null||lng2===null)return null;
    const radians=value=>value*Math.PI/180,R=6371000,dLat=radians(lat2-lat1),dLng=radians(lng2-lng1);
    const haversine=Math.sin(dLat/2)**2+Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(haversine));
  }

  function isFreshGps(gps,now=Date.now(),maxAgeMs=15000){
    const capturedAt=Number(gps?.capturedAt||gps?.captured_at||0),accuracy=Number(gps?.accuracy);
    return finiteCoordinate(gps?.lat??gps?.latitude,-90,90)!==null
      &&finiteCoordinate(gps?.lng??gps?.longitude,-180,180)!==null
      &&Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=150
      &&capturedAt>0&&now-capturedAt>=-5000&&now-capturedAt<=maxAgeMs;
  }

  function verifiedLead(lead){
    const statuses=new Set(['verified','exact','matched','google_mymaps','field_gps','rooftop','parcel','address','manual','field_verified','spotio_verified']);
    const status=String(lead?.geocodeStatus||lead?.geocode_status||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
    return lead?.isDemo!==true&&lead?.dbId&&finiteCoordinate(lead?.lat??lead?.latitude,-90,90)!==null&&finiteCoordinate(lead?.lng??lead?.longitude,-180,180)!==null&&statuses.has(status);
  }

  function nearestLead(leads,gps){
    if(!isFreshGps(gps))return null;
    let nearest=null,second=null;
    for(const lead of leads||[]){
      if(!verifiedLead(lead))continue;
      const distance=metersBetween(gps,lead);
      if(distance===null)continue;
      const candidate={lead,distance};
      if(!nearest||distance<nearest.distance){second=nearest;nearest=candidate;}
      else if(!second||distance<second.distance)second=candidate;
    }
    return nearest?{...nearest,secondDistance:second?.distance??null}:null;
  }

  function distanceState(selectedLead,gps){
    if(!isFreshGps(gps))return{distance:null,withinRange:false,reason:'location_unavailable'};
    if(!verifiedLead(selectedLead))return{distance:null,withinRange:false,reason:'lead_location_unverified'};
    const distance=metersBetween(gps,selectedLead);
    return{distance,withinRange:distance!==null&&distance<=QUARTER_MILE_METERS,reason:distance!==null&&distance<=QUARTER_MILE_METERS?'within_range':'outside_quarter_mile'};
  }

  function autoDispositionForDwell(dwellMs){
    return Number(dwellMs)>=60000
      ?{activityType:'Visit',visitResult:'Contacted',stage:null,visitOutcome:'Contacted',contactStatus:'Contacted',disposition:'no_sale'}
      :{activityType:'Visit',visitResult:'No Answer',stage:null,visitOutcome:'No Answer',contactStatus:'Not Contacted',disposition:'visit'};
  }

  function optionByLabel(options,value){
    const key=String(value||'').trim().toLowerCase().replace(/[\s-]+/g,' ');
    return options.find(option=>String(option.label||option).toLowerCase().replace(/[\s-]+/g,' ')===key)||null;
  }
  function activityType(value){const match=optionByLabel(ACTIVITY_TYPES,value);return match?String(match):null;}
  function visitResult(value){return optionByLabel(VISIT_RESULTS,value)?.label||null;}
  function stage(value){return optionByLabel(STAGES,value)?.label||null;}
  function pinState({stage:stageValue,visitResult:resultValue,previousColor='#fbbf24',previousSource='legacy'}={}){
    const stageMatch=optionByLabel(STAGES,stageValue);
    if(stageMatch)return{label:stageMatch.label,color:stageMatch.color,source:'stage'};
    const resultMatch=optionByLabel(VISIT_RESULTS,resultValue);
    if(resultMatch)return{label:resultMatch.label,color:resultMatch.color,source:'visit_result'};
    return{label:null,color:previousColor||'#fbbf24',source:previousSource||'legacy'};
  }

  function shouldAutoArrive({distance,accuracy,candidateHits}){
    return Number.isFinite(distance)&&Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=35&&distance<=20&&candidateHits>=2;
  }

  function shouldAutoDepart({activeDistance,accuracy,nearestIsDifferent,candidateHits}){
    if(!Number.isFinite(activeDistance)||!Number.isFinite(accuracy)||accuracy<0||accuracy>50||candidateHits<2)return false;
    return(activeDistance>12&&nearestIsDifferent)||activeDistance>Math.max(30,accuracy+10);
  }

  function normalizedAddress(value){return String(value||'').trim().replace(/\s+/g,' ');}
  function saleAddress({withinRange,leadAddress,manualAddress,providerAddress}){
    if(normalizedAddress(manualAddress))return{address:normalizedAddress(manualAddress),source:'manual'};
    if(normalizedAddress(providerAddress))return{address:normalizedAddress(providerAddress),source:'provider'};
    if(normalizedAddress(leadAddress))return{address:normalizedAddress(leadAddress),source:'lead'};
    return{address:'',source:'required'};
  }

  return{QUARTER_MILE_METERS,ACTIVITY_TYPES,VISIT_RESULTS,STAGES,metersBetween,isFreshGps,verifiedLead,nearestLead,distanceState,autoDispositionForDwell,activityType,visitResult,stage,pinState,shouldAutoArrive,shouldAutoDepart,saleAddress};
});
