// Deferred message playback control. Both Live Wins and Rep Comms are
// real-time, broadcast-style notifications that previously played the
// instant they arrived over the realtime channel, regardless of whether the
// rep was actually looking at the screen -- a backgrounded tab or a
// PWA pushed to the background on mobile would still run this JS and pop
// a full-screen celebration or drop a falling message nobody saw arrive.
//
// This module provides one shared mechanism both features plug into:
// - Page Visibility API (`document.visibilityState`) gates whether queued
//   messages are allowed to actually display right now.
// - A localStorage-persisted per-source watermark (NOT sessionStorage,
//   which is cleared when the app is fully closed) survives a full app
//   close/reopen, so a source can ask "what happened since I was last
//   actually open" on a fresh launch, not just a backgrounded-tab refocus.
//
// A source is anything with: a way to check for missed items since a
// timestamp, a way to get an item's own timestamp, and a way to actually
// display one item. This module owns only the *timing* of when display is
// allowed to happen; each source keeps its own rendering.
(function(){
  if(window.MCCOY_DEFERRED_QUEUE)return;

  const WATERMARK_PREFIX='mccoy_deferred_watermark:';
  const sources={};

  function getWatermark(name){
    try{return localStorage.getItem(WATERMARK_PREFIX+name);}catch(_){return null;}
  }
  function setWatermark(name,isoTimestamp){
    if(!isoTimestamp)return;
    try{
      const current=getWatermark(name);
      if(!current||new Date(isoTimestamp)>new Date(current))localStorage.setItem(WATERMARK_PREFIX+name,isoTimestamp);
    }catch(_){}
  }

  function isVisible(){return document.visibilityState==='visible';}

  // Registers a source. config:
  //   getTimestamp(item) -> ISO string for that item
  //   deliver(item) -> actually display it (called only while visible)
  //   checkMissed(sinceIsoOrNull) -> Promise<item[]>, items that happened
  //     since that watermark (or a reasonable recent window if null, e.g.
  //     first-ever launch on this device)
  //   throttleMs -> minimum spacing between deliveries when draining a
  //     backlog, so a burst of missed items doesn't all render at once
  function registerSource(name,config){
    sources[name]={config,queue:[],draining:false};
    catchUp(name);
  }

  async function catchUp(name){
    const source=sources[name];if(!source)return;
    try{
      const since=getWatermark(name);
      const missed=await source.config.checkMissed(since);
      for(const item of missed||[])enqueue(name,item);
    }catch(error){console.error('Deferred queue catch-up failed for',name,error);}
  }

  function enqueue(name,item){
    const source=sources[name];if(!source)return;
    source.queue.push(item);
    drain(name);
  }

  async function drain(name){
    const source=sources[name];if(!source||source.draining)return;
    source.draining=true;
    while(source.queue.length){
      if(!isVisible()){source.draining=false;return;} // Stop here; visibilitychange below resumes.
      const item=source.queue.shift();
      setWatermark(name,source.config.getTimestamp(item));
      await source.config.deliver(item);
      if(source.config.throttleMs)await new Promise(resolve=>setTimeout(resolve,source.config.throttleMs));
    }
    source.draining=false;
  }

  document.addEventListener('visibilitychange',()=>{
    if(isVisible())for(const name in sources)drain(name);
  });

  window.MCCOY_DEFERRED_QUEUE={registerSource,enqueue,isVisible};
})();
