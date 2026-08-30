import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import {
  assignedAdminManagerEmail,
  isManagerPermissionRole,
  normalizeEmail,
} from '../_shared/manager-lead-assignment.mjs'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

const FIELD_ROLES = new Set(['admin', 'manager', 'trainer', 'rep', 'tester'])
const REPRESENTATIVE_ROLES = new Set(['rep', 'tester'])
const MANAGER_ACTIONS = new Set(['list_reps', 'assign_lead', 'assign_leads'])
const ADMIN_ACTIONS = new Set([
  'duplicate_status',
  'delete_lead',
  'remove_duplicate_leads',
  'create_field_address',
  'update_lead',
])

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)

    const email = normalizeEmail(user.email)
    const { data: access, error: accessError } = await admin
      .from('app_user_access')
      .select('role,active,team_name,assigned_manager_email,assigned_admin_email,display_name,sales_classification,organization_id')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || !access.organization_id) return json({ error: 'inactive_account' }, 403)

    const role = String(access.role || '').toLowerCase()
    if (!FIELD_ROLES.has(role)) return json({ error: 'field_role_required' }, 403)
    const isAdmin = role === 'admin'
    const isManager = isManagerPermissionRole(role)
    const isRepresentative = REPRESENTATIVE_ROLES.has(role)

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id,email,role,active,organization_id,auth_user_id')
      .eq('organization_id', access.organization_id)
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle()
    if (profileError) throw profileError
    if (!profile?.id) return json({ error: 'active_user_profile_required' }, 403)

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '')
    if (action === 'list_real_leads') {
      // All active field roles may list leads, but the server applies the caller's assignment scope below.
    } else if (MANAGER_ACTIONS.has(action)) {
      if (!isAdmin && !isManager) return json({ error: 'manager_or_admin_only' }, 403)
    } else if (ADMIN_ACTIONS.has(action)) {
      if (!isAdmin) return json({ error: 'admin_only' }, 403)
    } else {
      return json({ error: 'unknown_action' }, 400)
    }

    let profilesPromise: Promise<any[]> | null = null
    const getProfiles = async () => {
      if (!profilesPromise) {
        profilesPromise = admin
          .from('users')
          .select('id,email,role,active,organization_id,auth_user_id')
          .eq('organization_id', access.organization_id)
          .eq('active', true)
          .then(({ data, error }: any) => {
            if (error) throw error
            return data || []
          })
      }
      return await profilesPromise
    }
    const profileForEmail = async (value: unknown) => {
      const target = normalizeEmail(value)
      if (!target) return null
      return (await getProfiles()).find(candidate => normalizeEmail(candidate.email) === target) || null
    }

    let managerScopePromise: Promise<any> | null = null
    const getManagerScope = async () => {
      if (!isManager) return null
      if (!managerScopePromise) {
        managerScopePromise = (async () => {
          const ownerEmail = normalizeEmail(access.assigned_manager_email)
          const [{ data: reports, error: reportsError }, { data: owner, error: ownerError }] = await Promise.all([
            admin
              .from('app_user_access')
              .select('email,display_name,role,team_name,assigned_manager_email,assigned_admin_email,organization_id')
              .eq('organization_id', access.organization_id)
              .eq('active', true)
              .in('role', ['rep', 'tester'])
              .ilike('assigned_manager_email', email)
              .order('display_name'),
            ownerEmail
              ? admin
                .from('app_user_access')
                .select('email,display_name,role,active,organization_id')
                .eq('organization_id', access.organization_id)
                .eq('email', ownerEmail)
                .eq('role', 'admin')
                .eq('active', true)
                .maybeSingle()
              : Promise.resolve({ data: null, error: null }),
          ])
          if (reportsError) throw reportsError
          if (ownerError) throw ownerError
          const adminEmail = assignedAdminManagerEmail(access, owner)
          const profiles = await getProfiles()
          const profileByEmail = new Map(profiles.map(item => [normalizeEmail(item.email), item]))
          const managedReps = (reports || [])
            .map((rep: any) => ({ ...rep, user_id: profileByEmail.get(normalizeEmail(rep.email))?.id || null }))
            .filter((rep: any) => rep.user_id)
          return {
            reports: managedReps,
            reportIds: managedReps.map((rep: any) => String(rep.user_id)),
            adminEmail,
            adminAssigned: Boolean(adminEmail),
          }
        })()
      }
      return await managerScopePromise
    }

    const getRepresentativeManager = async (representativeAccess: any = access) => {
      const managerEmail = normalizeEmail(representativeAccess?.assigned_manager_email)
      if (!managerEmail) return { invalid: true, reason: 'manager_assignment_required' }
      const { data: managerAccess, error: managerError } = await admin
        .from('app_user_access')
        .select('email,display_name,role,active,assigned_manager_email,assigned_admin_email,organization_id')
        .eq('organization_id', access.organization_id)
        .eq('email', managerEmail)
        .maybeSingle()
      if (managerError) throw managerError
      if (!managerAccess?.active || !isManagerPermissionRole(managerAccess.role)) {
        return { invalid: true, reason: 'manager_assignment_required' }
      }
      const ownerEmail = normalizeEmail(managerAccess.assigned_manager_email)
      if (!ownerEmail) return { invalid: true, reason: 'manager_administrator_assignment_required' }
      const { data: owner, error: ownerError } = await admin
        .from('app_user_access')
        .select('email,role,active,organization_id')
        .eq('organization_id', access.organization_id)
        .eq('email', ownerEmail)
        .eq('role', 'admin')
        .eq('active', true)
        .maybeSingle()
      if (ownerError) throw ownerError
      const adminEmail = assignedAdminManagerEmail(managerAccess, owner)
      const managerProfile = await profileForEmail(managerEmail)
      if (!adminEmail || !managerProfile?.id) {
        return { invalid: true, reason: 'manager_administrator_assignment_required' }
      }
      return {
        id: managerProfile.id,
        email: managerEmail,
        display_name: managerAccess.display_name || managerEmail,
        adminEmail,
      }
    }

    const resolveTarget = async (targetEmail: string) => {
      const normalized = normalizeEmail(targetEmail)
      if (!normalized) return null
      const { data: targetAccess, error: targetError } = await admin
        .from('app_user_access')
        .select('email,active,display_name,role,team_name,assigned_manager_email,assigned_admin_email,organization_id')
        .eq('organization_id', access.organization_id)
        .eq('email', normalized)
        .maybeSingle()
      if (targetError) throw targetError
      if (!targetAccess?.active) return null
      if (isManager && (!REPRESENTATIVE_ROLES.has(targetAccess.role) || normalizeEmail(targetAccess.assigned_manager_email) !== email)) {
        return { forbidden: true }
      }
      const targetProfile = await profileForEmail(normalized)
      if (!targetProfile?.id) return null
      return { ...targetAccess, id: targetProfile.id, email: normalized }
    }

    const managerMayAssign = async (ids: string[]) => {
      if (!isManager) return { ok: true }
      const scope = await getManagerScope()
      if (!scope?.adminAssigned) return { ok: false, error: 'administrator_assignment_required' }
      const unique = [...new Set(ids.map(String))]
      const rows: any[] = []
      for (let index = 0; index < unique.length; index += 75) {
        const { data, error } = await admin
          .from('leads')
          .select('id,assigned_rep_id,assigned_manager_id,assigned_admin_email,organization_id,source_system')
          .eq('organization_id', access.organization_id)
          .in('id', unique.slice(index, index + 75))
          .is('deleted_at', null)
        if (error) throw error
        rows.push(...(data || []))
      }
      if (rows.length !== unique.length) return { ok: false, error: 'lead_outside_manager_pool' }
      const allowed = rows.every(lead =>
        String(lead.assigned_manager_id || '') === String(profile.id)
        && normalizeEmail(lead.assigned_admin_email) === normalizeEmail(scope.adminEmail)
        && !String(lead.source_system || '').toUpperCase().includes('DEMO')
      )
      return allowed ? { ok: true } : { ok: false, error: 'lead_outside_manager_pool' }
    }

    const getAssignmentPatch = async (target: any) => {
      if (isManager) {
        const scope = await getManagerScope()
        if (!scope?.adminAssigned) return { error: 'administrator_assignment_required' }
        return {
          patch: {
            assigned_rep_id: target?.id || null,
            assigned_manager_id: profile.id,
            assigned_admin_email: scope.adminEmail,
          },
          assigned_manager_id: profile.id,
          assigned_admin_email: scope.adminEmail,
          destination_role: target?.role || 'manager_pool',
        }
      }

      if (!target) {
        return {
          patch: { assigned_rep_id: null, assigned_manager_id: null, assigned_admin_email: null },
          assigned_manager_id: null,
          assigned_admin_email: null,
          destination_role: 'unassigned',
        }
      }

      if (isManagerPermissionRole(target.role)) {
        const ownerEmail = normalizeEmail(target.assigned_manager_email)
        const { data: owner, error: ownerError } = ownerEmail
          ? await admin
            .from('app_user_access')
            .select('email,role,active,organization_id')
            .eq('organization_id', access.organization_id)
            .eq('email', ownerEmail)
            .eq('role', 'admin')
            .eq('active', true)
            .maybeSingle()
          : { data: null, error: null }
        if (ownerError) throw ownerError
        const adminEmail = assignedAdminManagerEmail(target, owner)
        if (!adminEmail || adminEmail !== email) return { error: 'manager_administrator_assignment_required' }
        return {
          patch: { assigned_rep_id: null, assigned_manager_id: target.id, assigned_admin_email: adminEmail },
          assigned_manager_id: target.id,
          assigned_admin_email: adminEmail,
          destination_role: target.role,
        }
      }

      if (REPRESENTATIVE_ROLES.has(target.role)) {
        const manager = await getRepresentativeManager(target)
        if (manager?.invalid || manager.adminEmail !== email) {
          return { error: manager?.reason || 'rep_manager_assignment_required' }
        }
        return {
          patch: { assigned_rep_id: target.id, assigned_manager_id: manager.id, assigned_admin_email: manager.adminEmail },
          assigned_manager_id: manager.id,
          assigned_admin_email: manager.adminEmail,
          destination_role: target.role,
        }
      }

      if (target.role === 'admin' && target.email === email) {
        return {
          patch: { assigned_rep_id: target.id, assigned_manager_id: null, assigned_admin_email: email },
          assigned_manager_id: null,
          assigned_admin_email: email,
          destination_role: 'admin',
        }
      }
      return { error: 'unsupported_assignment_target' }
    }

    if (action === 'duplicate_status') {
      const { data, error } = await admin.rpc('lead_duplicate_status')
      if (error) throw error
      return json(data || { ok: true, duplicate_address_groups: 0, extra_leads: 0, removable_extra_leads: 0, blocked_by_active_visits: 0, snapshot_token: 'none', samples: [] })
    }

    if (action === 'delete_lead') {
      const leadId = String(body?.lead_id || '')
      if (!leadId) return json({ error: 'lead_id_required' }, 400)
      const { data: ownedLead, error: ownedError } = await admin
        .from('leads')
        .select('id')
        .eq('id', leadId)
        .eq('organization_id', access.organization_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (ownedError) throw ownedError
      if (!ownedLead) return json({ error: 'lead_not_found' }, 404)
      const { data, error } = await admin.rpc('archive_lead', {
        p_lead_id: leadId,
        p_actor_user_id: profile.id,
        p_actor_email: email,
        p_actor_role: role,
        p_reason: 'manual',
      })
      if (error) throw error
      if (!data?.ok) return json(data || { error: 'lead_removal_failed' }, data?.error === 'active_visit_exists' ? 409 : 404)
      return json(data)
    }

    if (action === 'remove_duplicate_leads') {
      const snapshotToken = String(body?.snapshot_token || '')
      const expectedExtra = Math.floor(Number(body?.expected_extra_leads))
      if (!snapshotToken || !Number.isFinite(expectedExtra) || expectedExtra < 0) {
        return json({ error: 'verified_duplicate_snapshot_required' }, 400)
      }
      const { data, error } = await admin.rpc('archive_verified_lead_duplicates', {
        p_actor_user_id: profile.id,
        p_actor_email: email,
        p_actor_role: role,
        p_snapshot_token: snapshotToken,
        p_expected_extra_leads: expectedExtra,
      })
      if (error) throw error
      if (!data?.ok) return json(data || { error: 'duplicate_cleanup_failed' }, data?.error === 'duplicate_set_changed' ? 409 : 400)
      return json(data)
    }

    if (action === 'create_field_address') {
      const address1 = String(body?.address1 || '').trim()
      const address2 = String(body?.address2 || '').trim()
      const city = String(body?.city || '').trim()
      const state = String(body?.state || '').trim().toUpperCase()
      const zip = String(body?.zip || '').trim()
      if (address1.length < 4) return json({ error: 'valid_street_address_required' }, 400)
      if (!city || !state || !zip) return json({ error: 'complete_address_required' }, 400)
      if (state.length !== 2) return json({ error: 'state_must_be_two_letters' }, 400)
      if (!/^\d{5}(?:-\d{4})?$/.test(zip)) return json({ error: 'invalid_zip_code' }, 400)
      const row = {
        organization_id: access.organization_id,
        address1,
        address2: address2 || null,
        city,
        state,
        zip,
        latitude: null,
        longitude: null,
        current_disposition: 'Uncontacted',
        source_system: 'FIELD_ENTRY',
        source_id: crypto.randomUUID(),
        source_payload: { entered_by_email: email, entered_by_user_id: profile.id, entered_by_role: role, entered_by_team: access.team_name || null },
        geocode_status: 'pending_google',
        geocode_provider: 'field_entry',
        geocode_verification_status: 'pending_google',
      }
      const { data: lead, error } = await admin
        .from('leads')
        .insert(row)
        .select('id,source_id,address1,address2,city,state,zip,latitude,longitude,geocode_status,geocode_provider,geocode_precision,geocode_verification_status,geocode_comparison_distance_meters,geocode_candidate_latitude,geocode_candidate_longitude,current_disposition,last_activity_type,visit_result,stage,pin_color,pin_color_source,assigned_rep_id,assigned_manager_id,assigned_admin_email,assigned_team_id,source_system,import_batch_id,created_at')
        .single()
      if (error) throw error
      return json({ ok: true, lead }, 201)
    }

    if (action === 'list_reps') {
      if (isManager) {
        const scope = await getManagerScope()
        return json({
          ok: true,
          reps: scope?.adminAssigned ? scope.reports.map(({ assigned_manager_email, assigned_admin_email, organization_id, ...rep }: any) => rep) : [],
          administrator_assigned: Boolean(scope?.adminAssigned),
        })
      }
      const { data: rows, error } = await admin
        .from('app_user_access')
        .select('email,display_name,role,team_name,assigned_manager_email,assigned_admin_email,organization_id')
        .eq('organization_id', access.organization_id)
        .eq('active', true)
        .in('role', ['rep', 'tester', 'manager', 'trainer', 'admin'])
        .order('display_name')
      if (error) throw error
      const profiles = await getProfiles()
      const profileByEmail = new Map(profiles.map(item => [normalizeEmail(item.email), item]))
      const reps = (rows || [])
        .map((account: any) => ({ ...account, user_id: profileByEmail.get(normalizeEmail(account.email))?.id || null }))
        .filter((account: any) => account.user_id)
      return json({ ok: true, reps })
    }

    if (action === 'list_real_leads') {
      const page = Math.max(0, Math.floor(Number(body?.page || 0)))
      const limit = Math.min(4000, Math.max(1, Math.floor(Number(body?.limit || 1000))))
      const knownTotal = Math.max(0, Math.floor(Number(body?.total_hint || 0)))
      const { data: batches, error: batchError } = await admin
        .from('spotio_import_batches')
        .select('id,created_at,status,raw_payload')
        .eq('status', 'normalized')
        .order('created_at', { ascending: false })
        .limit(100)
      if (batchError) throw batchError
      const normalized = batches || []
      const canonicalSpotio = normalized.find((batch: any) => String(batch?.raw_payload?.source_type || '') === 'spotio_json')
      const csvBatches = normalized.filter((batch: any) => String(batch?.raw_payload?.source_type || '') === 'csv')
      const selectedIds = [canonicalSpotio?.id, ...csvBatches.map((batch: any) => batch.id)].filter(Boolean)

      let scopeName = 'organization_all'
      let assignmentRequired = false
      let assignmentReason: string | null = null
      let managerScope: any = null
      let representativeManager: any = null
      if (isManager) {
        scopeName = 'manager_pool'
        assignmentRequired = true
        managerScope = await getManagerScope()
        if (!managerScope?.adminAssigned) assignmentReason = 'administrator_assignment_required'
      } else if (isRepresentative) {
        scopeName = 'rep_assigned'
        assignmentRequired = true
        representativeManager = await getRepresentativeManager()
        if (representativeManager?.invalid) assignmentReason = representativeManager.reason
      }

      const applyRoleScope = (query: any) => {
        query = query.eq('organization_id', access.organization_id)
        if (isManager) {
          if (!managerScope?.adminAssigned) return query.eq('assigned_manager_id', '00000000-0000-0000-0000-000000000000')
          return query
            .eq('assigned_manager_id', profile.id)
            .ilike('assigned_admin_email', managerScope.adminEmail)
        }
        if (isRepresentative) {
          if (representativeManager?.invalid) return query.eq('assigned_rep_id', '00000000-0000-0000-0000-000000000000')
          return query
            .eq('assigned_rep_id', profile.id)
            .eq('assigned_manager_id', representativeManager.id)
            .ilike('assigned_admin_email', representativeManager.adminEmail)
        }
        return query
      }

      const loadOwnershipDirectory = async () => {
        let allowedEmails: string[] | null = null
        if (isManager) {
          allowedEmails = [email, managerScope?.adminEmail, ...(managerScope?.reports || []).map((rep: any) => rep.email)].filter(Boolean)
        } else if (isRepresentative) {
          allowedEmails = [email, representativeManager?.email, representativeManager?.adminEmail].filter(Boolean)
        }
        let query = admin
          .from('app_user_access')
          .select('email,display_name,role,team_name,assigned_manager_email,assigned_admin_email,organization_id')
          .eq('organization_id', access.organization_id)
          .eq('active', true)
          .in('role', ['admin', 'manager', 'trainer', 'rep', 'tester'])
        const allowedSet = allowedEmails
          ? new Set(allowedEmails.map(normalizeEmail).filter(Boolean))
          : null
        if (allowedSet && !allowedSet.size) return []
        const { data: accounts, error: accountError } = await query.order('display_name')
        if (accountError) throw accountError
        const profiles = await getProfiles()
        const profileByEmail = new Map(profiles.map(item => [normalizeEmail(item.email), item]))
        return (accounts || [])
          .filter((account: any) => !allowedSet || allowedSet.has(normalizeEmail(account.email)))
          .map((account: any) => ({
            user_id: profileByEmail.get(normalizeEmail(account.email))?.id || null,
            email: account.email,
            display_name: account.display_name || account.email,
            role: account.role,
            team_name: account.team_name || null,
            assigned_manager_email: account.assigned_manager_email || null,
            assigned_admin_email: account.assigned_admin_email || null,
          }))
          .filter((account: any) => account.user_id)
      }

      const selectColumns = 'id,source_id,address1,address2,city,state,zip,latitude,longitude,geocode_status,geocode_provider,geocode_precision,geocode_verification_status,geocode_comparison_distance_meters,geocode_candidate_latitude,geocode_candidate_longitude,current_disposition,last_activity_type,visit_result,stage,pin_color,pin_color_source,assigned_rep_id,assigned_manager_id,assigned_admin_email,assigned_team_id,source_system,import_batch_id,created_at'
      const makeQuery = (includeCount = false) => {
        let query = admin
          .from('leads')
          .select(selectColumns, includeCount ? { count: 'exact' } : undefined)
          .is('deleted_at', null)
        query = applyRoleScope(query)
        query = selectedIds.length
          ? query.or(`import_batch_id.in.(${selectedIds.join(',')}),source_system.eq.FIELD_ENTRY`)
          : query.eq('source_system', 'FIELD_ENTRY')
        return query.not('source_system', 'ilike', '%demo%')
      }

      const metadata = {
        batch_id: csvBatches[0]?.id || canonicalSpotio?.id || null,
        batch_ids: selectedIds,
        page,
        limit,
        scope: scopeName,
        assigned_team: access.team_name || null,
        assignment_required: assignmentRequired,
        assignment_reason: assignmentReason,
      }
      if (assignmentReason) return json({ ok: true, ...metadata, total: 0, leads: [], owners: [] })

      const ownershipPromise = page === 0 ? loadOwnershipDirectory() : Promise.resolve(null)
      const start = page * limit
      const slices: Array<{ start: number; end: number }> = []
      for (let offset = 0; offset < limit; offset += 1000) {
        slices.push({ start: start + offset, end: start + Math.min(limit, offset + 1000) - 1 })
      }
      const [results, owners] = await Promise.all([
        Promise.all(slices.map((slice, index) =>
          makeQuery(index === 0 && !knownTotal)
            .order('address1', { ascending: true })
            .order('id', { ascending: true })
            .range(slice.start, slice.end)
        )),
        ownershipPromise,
      ])
      for (const result of results) if (result.error) throw result.error
      const rows = results.flatMap(result => result.data || [])
      const total = knownTotal || Number(results[0]?.count || 0)
      return json({ ok: true, ...metadata, total, leads: rows, ...(owners ? { owners } : {}) })
    }

    if (action === 'update_lead') {
      const leadId = String(body?.lead_id || '')
      if (!leadId) return json({ error: 'lead_id_required' }, 400)
      const patch: Record<string, unknown> = {}
      const coordinatesChanged = body?.latitude !== undefined || body?.longitude !== undefined
      const addressChanged = ['address1', 'address2', 'city', 'state', 'zip'].some(key => body?.[key] !== undefined)
      if (coordinatesChanged) {
        const latitude = Number(body.latitude), longitude = Number(body.longitude)
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          return json({ error: 'invalid_coordinates' }, 400)
        }
        Object.assign(patch, {
          latitude,
          longitude,
          geocode_status: 'manual',
          geocode_provider: 'manual',
          geocode_precision: 'door_manual',
          geocode_verification_status: 'manual_door_verified',
          geocode_verified_at: new Date().toISOString(),
          geocode_verification_details: { reason: 'admin_dragged_pin_to_door' },
          geocode_attempted_at: new Date().toISOString(),
        })
      }
      if (body?.address1 !== undefined) patch.address1 = String(body.address1 || '').trim()
      if (body?.address2 !== undefined) patch.address2 = String(body.address2 || '').trim() || null
      if (body?.city !== undefined) patch.city = String(body.city || '').trim()
      if (body?.state !== undefined) patch.state = String(body.state || '').trim().toUpperCase()
      if (body?.zip !== undefined) patch.zip = String(body.zip || '').trim()
      if (addressChanged && !coordinatesChanged) {
        Object.assign(patch, {
          latitude: null,
          longitude: null,
          geocode_status: 'pending_google',
          geocode_provider: 'address_edit',
          geocode_precision: null,
          geocode_formatted_address: null,
          geocode_place_id: null,
          geocode_verified_at: null,
          geocode_verification_status: 'pending_google',
          geocode_comparison_distance_meters: null,
          geocode_candidate_latitude: null,
          geocode_candidate_longitude: null,
          geocode_verification_details: { reason: 'address_changed_coordinates_invalidated' },
        })
      }
      if (!Object.keys(patch).length) return json({ error: 'no_updates' }, 400)
      const { data, error } = await admin
        .from('leads')
        .update(patch)
        .eq('id', leadId)
        .eq('organization_id', access.organization_id)
        .is('deleted_at', null)
        .select('id,address1,address2,city,state,zip,latitude,longitude,geocode_status,geocode_provider,geocode_precision,geocode_verification_status,geocode_comparison_distance_meters,geocode_candidate_latitude,geocode_candidate_longitude')
        .maybeSingle()
      if (error) throw error
      if (!data) return json({ error: 'lead_not_found' }, 404)
      return json({ ok: true, lead: data })
    }

    if (action === 'assign_lead') {
      const leadId = String(body?.lead_id || '')
      const targetEmail = normalizeEmail(body?.rep_email)
      if (!leadId) return json({ error: 'lead_id_required' }, 400)
      let target: any = null
      if (targetEmail) {
        target = await resolveTarget(targetEmail)
        if (target?.forbidden) return json({ error: 'rep_not_managed_by_you' }, 403)
        if (!target) return json({ error: 'rep_not_found' }, 404)
      }
      const allowed = await managerMayAssign([leadId])
      if (!allowed.ok) return json({ error: allowed.error }, 403)
      const destination: any = await getAssignmentPatch(target)
      if (destination.error) return json({ error: destination.error }, 403)
      const { data: updated, error } = await admin
        .from('leads')
        .update(destination.patch)
        .eq('id', leadId)
        .eq('organization_id', access.organization_id)
        .is('deleted_at', null)
        .select('id')
      if (error) throw error
      if (!updated?.length) return json({ error: 'lead_not_found' }, 404)
      return json({
        ok: true,
        lead_id: leadId,
        rep_email: target?.email || null,
        assigned_rep_id: destination.patch.assigned_rep_id || null,
        assigned_manager_id: destination.assigned_manager_id || null,
        assigned_admin_email: destination.assigned_admin_email || null,
        destination_role: destination.destination_role,
      })
    }

    if (action === 'assign_leads') {
      const ids = Array.isArray(body?.lead_ids) ? [...new Set(body.lead_ids.map((id: unknown) => String(id)).filter(Boolean))] : []
      if (!ids.length) return json({ error: 'lead_ids_required' }, 400)
      if (ids.length > 1000) return json({ error: 'max_1000_leads_per_request' }, 400)
      const targetEmail = normalizeEmail(body?.rep_email)
      let target: any = null
      if (targetEmail) {
        target = await resolveTarget(targetEmail)
        if (target?.forbidden) return json({ error: 'rep_not_managed_by_you' }, 403)
        if (!target) return json({ error: 'rep_not_found' }, 404)
      }
      const allowed = await managerMayAssign(ids)
      if (!allowed.ok) return json({ error: allowed.error }, 403)
      const destination: any = await getAssignmentPatch(target)
      if (destination.error) return json({ error: destination.error }, 403)
      let updated = 0
      for (let index = 0; index < ids.length; index += 75) {
        const chunk = ids.slice(index, index + 75)
        const { data, error } = await admin
          .from('leads')
          .update(destination.patch)
          .eq('organization_id', access.organization_id)
          .in('id', chunk)
          .is('deleted_at', null)
          .select('id')
        if (error) return json({ error: 'bulk_update_failed', detail: error.message || String(error), updated, failed_chunk_start: index, failed_chunk_size: chunk.length }, 500)
        updated += (data || []).length
      }
      return json({
        ok: true,
        updated,
        rep_email: target?.email || null,
        assigned_rep_id: destination.patch.assigned_rep_id || null,
        assigned_manager_id: destination.assigned_manager_id || null,
        assigned_admin_email: destination.assigned_admin_email || null,
        destination_role: destination.destination_role,
      })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('lead-admin', error)
    return json({ error: 'lead_admin_failed', detail: String((error as Error)?.message || error).slice(0, 320) }, 500)
  }
})