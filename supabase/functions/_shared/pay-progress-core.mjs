export function pacificWeekWindow(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_week_reference_date');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
  if (weekday == null) throw new Error('invalid_pacific_weekday');
  const monday = new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), 12));
  monday.setUTCDate(monday.getUTCDate() - ((weekday + 6) % 7));
  const nextMonday = new Date(monday);nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  return {
    startDate: monday.toISOString().slice(0, 10),
    endDateExclusive: nextMonday.toISOString().slice(0, 10)
  };
}

export function adminApprovalAllows(snapshot = {}) {
  const outside = snapshot?.sale_origin === 'outside_system' || snapshot?.sale_context === 'out_of_area_phone';
  return !outside || String(snapshot?.admin_approval?.status || '').toLowerCase() === 'approved';
}
