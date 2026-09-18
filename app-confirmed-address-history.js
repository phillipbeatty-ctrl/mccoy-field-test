// Predictive next-address prediction from confirmed sale history.
// Design and safety rationale (do not remove without re-reading):
// - Uses CONFIRMED sale addresses, not raw GPS pings, specifically because a
//   direction computed from two live GPS samples is dominated by noise at
//   the short distances that actually cause ambiguity (quantified directly:
//   ~21m of combined noise on a ~12m signal). Confirmed addresses carry only
//   geocoding error (~2-3m), making the direction calculation reliable.
// - Requires at least 2 confirmed stops before predicting anything, so a
//   single sale can't be treated as an established direction.
// - NEVER auto-selects. Only annotates/reorders the existing ambiguity list
//   that already requires explicit confirmation. Non-sequential canvassing
//   (skipped doors, backtracking, crossing the street) means a direction
//   heuristic can be confidently wrong in a way no amount of coordinate
//   precision fixes -- a human stays in the loop for genuine ambiguity.
(function(){
  if(window.MCCOY_CONFIRMED_ADDRESS_HISTORY)return;
  const STORAGE_KEY='mccoy_confirmed_address_history_v1';
  const MIN_CONFIRMATIONS=2;

  function readHistory(){
    try{return JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'[]');}catch(_){return [];}
  }
  function writeHistory(list){
    try{sessionStorage.setItem(STORAGE_KEY,JSON.stringify(list.slice(-20)));}catch(_){}
  }

  function distanceMeters(aLat,aLng,bLat,bLng){
    const toRad=v=>v*Math.PI/180;
    const dLat=toRad(bLat-aLat),dLng=toRad(bLng-aLng);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
    return 2*6371000*Math.asin(Math.min(1,Math.sqrt(a)));
  }
  function bearing(aLat,aLng,bLat,bLng){
    const toRad=v=>v*Math.PI/180;
    const dLng=toRad(bLng-aLng);
    const y=Math.sin(dLng)*Math.cos(toRad(bLat));
    const x=Math.cos(toRad(aLat))*Math.sin(toRad(bLat))-Math.sin(toRad(aLat))*Math.cos(toRad(bLat))*Math.cos(dLng);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }
  function angleDiff(a,b){const d=Math.abs(a-b)%360;return d>180?360-d:d;}

  async function getGpsForConfirmation(){
    if(!navigator.geolocation)return null;
    return new Promise(resolve=>{
      navigator.geolocation.getCurrentPosition(
        position=>resolve({lat:Number(position.coords.latitude),lng:Number(position.coords.longitude)}),
        ()=>resolve(null),
        {enableHighAccuracy:true,maximumAge:15000,timeout:6000}
      );
    });
  }

  async function recordConfirmedSale(address){
    if(!address)return;
    const gps=await getGpsForConfirmation();
    if(!gps)return; // No reliable position for this confirmation -- don't record a guess into the history.
    const history=readHistory();
    history.push({address,lat:gps.lat,lng:gps.lng,confirmed_at:Date.now()});
    writeHistory(history);
  }

  // Given a list of ambiguous candidates ({address, distance_meters}), returns
  // the same list with an added `likely` flag on at most one entry, and
  // reordered so that entry is first -- or the list unchanged if there isn't
  // enough confirmed history, or the entries don't carry coordinates to
  // compare against.
  function annotateLikelyCandidate(candidates,candidateCoordsByAddress){
    const history=readHistory();
    if(history.length<MIN_CONFIRMATIONS||!Array.isArray(candidates)||candidates.length<2)return candidates;
    const last=history[history.length-1],prev=history[history.length-2];
    if(distanceMeters(prev.lat,prev.lng,last.lat,last.lng)<3)return candidates; // No meaningful movement between the last two confirmed stops.
    const travelBearing=bearing(prev.lat,prev.lng,last.lat,last.lng);
    let best=null,bestDiff=Infinity;
    for(const candidate of candidates){
      const coords=candidateCoordsByAddress?.[candidate.address];
      if(!coords)continue;
      const candidateBearing=bearing(last.lat,last.lng,coords.lat,coords.lng);
      const diff=angleDiff(travelBearing,candidateBearing);
      if(diff<bestDiff){bestDiff=diff;best=candidate;}
    }
    if(!best||bestDiff>60)return candidates; // Not a confident enough match to annotate.
    const annotated=candidates.map(c=>c===best?{...c,likely:true}:{...c,likely:false});
    annotated.sort((a,b)=>(b.likely?1:0)-(a.likely?1:0));
    return annotated;
  }

  window.addEventListener('mccoy-sale-saved',event=>{
    const address=event?.detail?.serviceAddress;
    if(address)recordConfirmedSale(address);
  });

  window.MCCOY_CONFIRMED_ADDRESS_HISTORY={annotateLikelyCandidate,readHistory};
})();
