// McCoy sale product options: VoIP for ISPs and AT&T mobile products on every provider order.
(function(){
  if(window.MCCOY_SALES_PRODUCTS_PATCHED)return;
  window.MCCOY_SALES_PRODUCTS_PATCHED=true;
  const byId=id=>document.getElementById(id);
  const ISP_PROVIDERS=new Set(['Quantum','Brightspeed','AT&T','T-Mobile / T-Fiber','Kinetic','Fidium','Ascend Fiber','Lightcurve','Ripple Fiber','Starlink','Other']);

  const style=document.createElement('style');
  style.textContent=`
    .sale-product-box{grid-column:1/-1;border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#f8fafc}
    .sale-product-box strong{display:block;margin-bottom:7px;font-size:13px}
    .sale-product-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .sale-product-options label{display:flex;align-items:center;gap:7px;padding:8px;border-radius:8px;background:#fff;border:1px solid #e5e7eb;font-size:12px}
    .sale-product-options input[type=checkbox]{width:auto;margin:0}
    .sale-product-options input[type=number]{width:90px;margin-left:auto;padding:7px}
    .sale-product-hint{font-size:11px;color:#6b7280;margin-top:7px}
    @media(max-width:650px){.sale-product-options{grid-template-columns:1fr}.sale-product-box{grid-column:auto}}
  `;
  document.head.appendChild(style);

  function ensureProductUi(){
    const grid=document.querySelector('#saleModal .sale-grid');
    const product=byId('saleInternetProduct');
    if(!grid||!product)return false;

    if(!byId('saleVoipLines')){
      const input=document.createElement('input');
      input.id='saleVoipLines';input.type='number';input.min='0';input.max='20';input.value='0';
      input.placeholder='VoIP home phone lines';
      const speed=byId('saleSpeed');
      if(speed?.parentNode===grid)grid.insertBefore(input,speed.nextSibling);else grid.appendChild(input);
    }

    if(!byId('mobileProductOptions')){
      const box=document.createElement('div');box.id='mobileProductOptions';box.className='sale-product-box';
      box.innerHTML=`<strong>AT&amp;T mobile products on this order</strong><div class="sale-product-options"><label>AT&amp;T mobile phone lines <input id="saleMobileLinesMirror" type="number" min="0" max="20" value="0"></label><label>AT&amp;T mobile devices <input id="saleMobileDeviceCount" type="number" min="0" max="20" value="0"></label><label><input id="saleMobileDeviceProtection" type="checkbox"> AT&amp;T device protection</label><label id="saleAttTotalHomeCareRow"><input id="saleAttTotalHomeCare" type="checkbox"> Total Home Care (AT&amp;T Internet only)</label></div><div class="sale-product-hint">AT&amp;T mobile phone lines and devices can be added to any provider order by every rep. VoIP home phone lines remain available for Internet providers.</div>`;
      grid.appendChild(box);
      const mirror=byId('saleMobileLinesMirror'),original=byId('saleMobile');
      if(original)original.style.display='none';
      const sync=()=>{if(original)original.value=String(Math.max(0,Math.min(20,Number(mirror?.value||0))))};
      mirror?.addEventListener('input',sync);sync();
    }
    return true;
  }

  function setProductOptions(values){
    const select=byId('saleInternetProduct');if(!select)return;
    const prior=select.value;
    select.innerHTML=values.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
    select.value=values.some(x=>x[0]===prior)?prior:values[0][0];
  }

  function syncProviderUi(){
    if(!ensureProductUi())return;
    const provider=byId('sessionIsp')?.value||'';
    const isAtt=provider==='AT&T';
    const isIsp=ISP_PROVIDERS.has(provider);
    const voip=byId('saleVoipLines');
    const mobile=byId('mobileProductOptions');
    if(voip){voip.style.display=isIsp?'block':'none';if(!isIsp)voip.value='0';}
    if(mobile)mobile.style.display='block';
    const careRow=byId('saleAttTotalHomeCareRow'),care=byId('saleAttTotalHomeCare');if(careRow)careRow.style.display=isAtt?'flex':'none';if(!isAtt&&care)care.checked=false;
    if(isAtt){
      setProductOptions([['Fiber','Fiber internet'],['Internet Air','AT&T Air — home internet / 5G hotspot'],['None','No home internet']]);
    }else if(isIsp){
      setProductOptions([['Internet','Internet'],['Fiber','Fiber internet'],['None','No internet']]);
    }else{
      setProductOptions([['None','No internet']]);
    }
    window.MCCOY_SYNC_SALE_PRODUCT_UI?.();
  }

  function readExtras(){
    const isAttInternet=byId('sessionIsp')?.value==='AT&T';
    const mobileLines=Math.max(0,Math.min(20,Math.round(Number(byId('saleMobileLinesMirror')?.value||0))));
    const mobileDevices=Math.max(0,Math.min(20,Math.round(Number(byId('saleMobileDeviceCount')?.value||0))));
    const mobileProtection=!!byId('saleMobileDeviceProtection')?.checked;
    return {
      voip_home_phone_lines:Math.max(0,Math.min(20,Math.round(Number(byId('saleVoipLines')?.value||0)))),
      mobile_phone_lines:mobileLines,
      mobile_device_count:mobileDevices,
      mobile_device_protection:mobileProtection,
      att_mobile_lines:mobileLines,
      att_device_count:mobileDevices,
      att_device_protection:mobileProtection,
      att_total_home_care:isAttInternet&&!!byId('saleAttTotalHomeCare')?.checked
    };
  }

  // Extend only sale-submit payloads; all other Supabase function calls are untouched.
  if(window.sb?.functions?.invoke){
    const originalInvoke=sb.functions.invoke.bind(sb.functions);
    sb.functions.invoke=(name,options)=>{
      if(name==='sale-submit'&&options?.body)options={...options,body:{...options.body,...readExtras()}};
      return originalInvoke(name,options);
    };
  }

  const providerSelect=byId('sessionIsp');
  providerSelect?.addEventListener('change',syncProviderUi);
  window.addEventListener('mccoy-sale-saved',()=>{
    const voip=byId('saleVoipLines');if(voip)voip.value='0';
    const mirror=byId('saleMobileLinesMirror');if(mirror)mirror.value='0';
    const devices=byId('saleMobileDeviceCount');if(devices)devices.value='0';
    const protection=byId('saleMobileDeviceProtection');if(protection)protection.checked=false;
    const care=byId('saleAttTotalHomeCare');if(care)care.checked=false;
  });

  let tries=0;const startup=setInterval(()=>{tries++;if(ensureProductUi()){syncProviderUi();clearInterval(startup)}else if(tries>=30)clearInterval(startup)},100);
  setTimeout(()=>{ensureProductUi();syncProviderUi();},0);
})();
