import test from 'node:test'
import assert from 'node:assert/strict'
import { assignedAdminManagerEmail, isManagerPermissionRole, managerControlsLead } from './manager-lead-assignment.mjs'

test('Trainer has the same permission class as Manager without becoming an Admin', () => {
  assert.equal(isManagerPermissionRole('manager'), true)
  assert.equal(isManagerPermissionRole('trainer'), true)
  assert.equal(isManagerPermissionRole('admin'), false)
  assert.equal(isManagerPermissionRole('rep'), false)
})

test('a manager supervisor must be the same active Admin in both hierarchy fields', () => {
  const access = {
    assigned_manager_email: 'Admin@McCoy.test',
    assigned_admin_email: 'admin@mccoy.test'
  }
  assert.equal(assignedAdminManagerEmail(access, {
    email: 'ADMIN@mccoy.test',
    role: 'admin',
    active: true
  }), 'admin@mccoy.test')
  assert.equal(assignedAdminManagerEmail({...access, assigned_manager_email: 'other@mccoy.test'}, {
    email: 'admin@mccoy.test', role: 'admin', active: true
  }), null)
  assert.equal(assignedAdminManagerEmail(access, {
    email: 'admin@mccoy.test', role: 'manager', active: true
  }), null)
})

test('a manager controls only Admin-assigned leads in their own pool', () => {
  const scope = {managerUserId: 'manager-1', adminEmail: 'admin@mccoy.test', reportIds: ['rep-1']}
  assert.equal(managerControlsLead({assigned_manager_id: 'manager-1', assigned_admin_email: 'admin@mccoy.test'}, scope), true)
  assert.equal(managerControlsLead({assigned_manager_id: 'manager-1', assigned_admin_email: 'admin@mccoy.test', assigned_rep_id: 'rep-1'}, scope), true)
  assert.equal(managerControlsLead({assigned_manager_id: null, assigned_admin_email: null}, scope), false)
  assert.equal(managerControlsLead({assigned_manager_id: 'manager-2', assigned_admin_email: 'admin@mccoy.test'}, scope), false)
  assert.equal(managerControlsLead({assigned_manager_id: 'manager-1', assigned_admin_email: 'other@mccoy.test'}, scope), false)
  assert.equal(managerControlsLead({assigned_manager_id: 'manager-1', assigned_admin_email: 'admin@mccoy.test', assigned_rep_id: 'rep-2'}, scope), false)
})
