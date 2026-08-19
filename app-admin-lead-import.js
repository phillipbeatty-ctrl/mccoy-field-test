// Restrict real-lead imports to McCoy administrators. The control is hidden and inert for every other role.
(()=> {
  const btn = document.getElementById('adminLeadImportBtn');
  if (!btn) return;

  const isAdmin = window.MCCOY_ACCESS?.access?.role === 'admin';
  if (!isAdmin) {
    btn.hidden = true;
    btn.disabled = true;
    btn.setAttribute('aria-hidden', 'true');
    btn.tabIndex = -1;
    return;
  }

  btn.hidden = false;
  btn.disabled = false;
  btn.removeAttribute('aria-hidden');
  btn.addEventListener('click', () => {
    if (window.MCCOY_ACCESS?.access?.role !== 'admin') return;
    location.href = 'spotio-import.html';
  });
})();