// McCoy Field Coach V9.2 admin logout compatibility shim.
// The persistent upper-right Sign Out button has been removed.
// Sign out is handled by the account strip that displays the user's name and title.
(function(){
  const old=document.getElementById('adminLogoutBtn');
  if(old)old.remove();
})();
