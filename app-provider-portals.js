// Approved seller-portal destinations only. URLs stay blank until the provider
// confirms the exact portal address. Never place usernames or passwords here.
window.MCCOY_PROVIDER_PORTALS=Object.freeze({
  Quantum:Object.freeze({label:'Quantum ASAP',url:'https://qfasap.docxtract.com/Login.aspx'}),
  Brightspeed:Object.freeze({label:'BASS',url:'https://bass.docxtract.com/General/SimHomePage.aspx',reportUrl:'https://bass.docxtract.com/Report/Orders_Report.aspx',reportLabel:'OPEN BASS ORDERS REPORT'}),
  'AT&T':Object.freeze({
    label:'Sara Plus — AT&T account',
    accountContext:'AT&T',
    sessionGroup:'sara_plus',
    url:'https://www.saraplus.com/e/ServicePages/Login.aspx?ReturnUrl=%2fe%2fDealerPages%2fSubmitOrders.aspx',
    reportUrl:'https://portal.saraplus.com/',
    reportLabel:'OPEN AT&T SARA PLUS REPORT'
  }),
  'T-Mobile / T-Fiber':Object.freeze({label:'T-Mobile seller account',url:''}),
  Kinetic:Object.freeze({label:'Kinetic seller account',url:''}),
  Fidium:Object.freeze({label:'Fidium seller account',url:''}),
  'Ascend Fiber':Object.freeze({label:'Ascend Fiber seller account',url:''}),
  Lightcurve:Object.freeze({label:'Lightcurve seller account',url:''}),
  'Ripple Fiber':Object.freeze({label:'Ripple Fiber seller account',url:''}),
  Starlink:Object.freeze({label:'Starlink seller account',url:''}),
  DIRECTV:Object.freeze({
    label:'Sara Plus — DIRECTV account',
    accountContext:'DIRECTV',
    sessionGroup:'sara_plus',
    url:'https://www.saraplus.com/e/ServicePages/Login.aspx?ReturnUrl=%2fe%2fDealerPages%2fSubmitOrders.aspx',
    reportUrl:'https://portal.saraplus.com/',
    reportLabel:'OPEN DIRECTV SARA PLUS REPORT'
  }),
  Vivint:Object.freeze({
    label:'Vivint Order Entry Tool',
    url:'https://oetool.vivint.com/',
    reportUrl:'https://oetool.vivint.com/',
    reportLabel:'OPEN VIVINT SALES REPORT'
  }),
  Other:Object.freeze({label:'Seller account',url:''})
});
