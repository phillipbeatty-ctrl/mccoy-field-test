export function normalizeVoipHomePhoneAddOn(value, internetProduct) {
  if (String(internetProduct || '') === 'None') return 0
  if (value === true || value === 1) return 1
  const normalized = String(value ?? '').trim().toLowerCase()
  if (['true', 'yes', 'on'].includes(normalized)) return 1
  const numeric = Number(normalized)
  return Number.isFinite(numeric) && numeric > 0 ? 1 : 0
}
