export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function isManagerPermissionRole(role) {
  return role === 'manager' || role === 'trainer'
}

export function assignedAdminManagerEmail(access, administrator) {
  const assignedManagerEmail = normalizeEmail(access?.assigned_manager_email)
  const assignedAdminEmail = normalizeEmail(access?.assigned_admin_email)
  const administratorEmail = normalizeEmail(administrator?.email)
  const administratorIsActive = administrator?.active === true && administrator?.role === 'admin'

  if (!assignedManagerEmail || assignedManagerEmail !== assignedAdminEmail) return null
  if (!administratorIsActive || administratorEmail !== assignedManagerEmail) return null
  return administratorEmail
}

export function managerControlsLead(lead, { managerUserId, adminEmail, reportIds = [] }) {
  const managerId = String(managerUserId || '')
  const expectedAdminEmail = normalizeEmail(adminEmail)
  if (!managerId || !expectedAdminEmail) return false
  if (String(lead?.assigned_manager_id || '') !== managerId) return false
  if (normalizeEmail(lead?.assigned_admin_email) !== expectedAdminEmail) return false

  const assignedRepId = String(lead?.assigned_rep_id || '')
  if (!assignedRepId || assignedRepId === managerId) return true
  return new Set(reportIds.map(id => String(id))).has(assignedRepId)
}
