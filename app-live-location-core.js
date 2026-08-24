(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MCCOY_LIVE_LOCATION_CORE=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const LIVE_MAX_AGE_MS=30_000;
  const SIGNAL_GRACE_MS=120_000;
  const MAX_VISUAL_ACCURACY_METERS=1_000;

  function finite(value,min,max){
    const number=Number(value);
    return Number.isFinite(number)&&number>=min&&number<=max?number:null;
  }

  function normalizeGps(gps){
    const lat=finite(gps?.lat??gps?.latitude,-90,90),lng=finite(gps?.lng??gps?.longitude,-180,180);
    const accuracy=Number(gps?.accuracy??gps?.accuracy_meters),capturedAt=Number(gps?.capturedAt??gps?.captured_at);
    if(lat===null||lng===null||!Number.isFinite(accuracy)||accuracy<0||accuracy>MAX_VISUAL_ACCURACY_METERS||!Number.isFinite(capturedAt)||capturedAt<=0)return null;
    return{lat,lng,accuracy,capturedAt};
  }

  function freshness(gps,now=Date.now()){
    const fix=normalizeGps(gps);if(!fix)return{state:'unavailable',ageMs:null,visible:false};
    const ageMs=Math.max(0,Number(now)-fix.capturedAt);
    if(ageMs<=LIVE_MAX_AGE_MS)return{state:'live',ageMs,visible:true};
    if(ageMs<=SIGNAL_GRACE_MS)return{state:'signal_lost',ageMs,visible:true};
    return{state:'expired',ageMs,visible:false};
  }

  function metersBetween(left,right){
    const a=normalizeGps(left),b=normalizeGps(right);if(!a||!b)return null;
    const radians=value=>value*Math.PI/180,R=6_371_000,dLat=radians(b.lat-a.lat),dLng=radians(b.lng-a.lng);
    const h=Math.sin(dLat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }

  function isImplausibleJump(previous,next){
    const left=normalizeGps(previous),right=normalizeGps(next);if(!left||!right)return false;
    const elapsedMs=right.capturedAt-left.capturedAt;if(elapsedMs<=0||elapsedMs>15_000)return false;
    const distance=metersBetween(left,right);if(distance===null)return false;
    const accuracyAllowance=Math.max(250,(left.accuracy+right.accuracy)*4);
    const speedMps=distance/(elapsedMs/1000);
    return distance>accuracyAllowance&&speedMps>40;
  }

  function confirmsJump(candidate,next){
    const left=normalizeGps(candidate),right=normalizeGps(next);if(!left||!right)return false;
    const distance=metersBetween(left,right);
    return distance!==null&&distance<=Math.max(75,(left.accuracy+right.accuracy)*2);
  }

  function shouldAppendTrail(previous,next){
    const left=normalizeGps(previous),right=normalizeGps(next);if(!right)return false;if(!left)return true;
    const distance=metersBetween(left,right),elapsed=right.capturedAt-left.capturedAt;
    return elapsed>=10_000||(distance!==null&&distance>=3);
  }

  return{LIVE_MAX_AGE_MS,SIGNAL_GRACE_MS,MAX_VISUAL_ACCURACY_METERS,normalizeGps,freshness,metersBetween,isImplausibleJump,confirmsJump,shouldAppendTrail};
});
