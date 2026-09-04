var state={realLeads:[{id:'lead-1',dbId:'lead-1',address:'123 Main Street',city:'Battle Ground',stateCode:'WA',zip:'98604',assignedRepId:'rep-1'}]}
window.MCCOY_ACCESS={user:{id:'rep-1'},access:{role:'rep'}}
window.MCCOY_LEAD_MAP={invalidateSize(){}}
window.L={DomEvent:{disableClickPropagation(){}}}
document.getElementById('mockLeadPin').onclick=()=>window.dispatchEvent(new CustomEvent('mccoy-map-lead-selected',{detail:{leadId:'lead-1'}}))
document.getElementById('moveLeadPinBtn').onclick=()=>{
  window.MCCOY_MAP_MOVE_PIN_ACTIVE=true
  window.dispatchEvent(new CustomEvent('mccoy-map-move-pin-started',{detail:{leadId:'lead-1'}}))
}
document.getElementById('cancelLeadPinBtn').onclick=()=>{
  window.MCCOY_MAP_MOVE_PIN_ACTIVE=false
  window.dispatchEvent(new CustomEvent('mccoy-map-move-pin-ended',{detail:{leadId:'lead-1'}}))
}
