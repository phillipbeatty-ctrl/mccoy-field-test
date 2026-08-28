// Preview bootstrap: block the superseded provider-return controller and load v2.
(function(){
  if(window.MCCOY_PROVIDER_RETURN_FOCUS_V3_LOADER)return;
  window.MCCOY_PROVIDER_RETURN_FOCUS_V3_LOADER=true;
  window.MCCOY_PROVIDER_RETURN_FOCUS=true;
  const script=document.createElement('script');
  script.src='app-provider-return-focus-v2.js?v=2026082802';
  script.defer=true;
  document.head.appendChild(script);
})();
