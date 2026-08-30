import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const norm = (value: unknown) => String(value || '').trim().toLowerCase()
const managerRole = (role: unknown) => role === 'manager' || role === 'trainer'
const representativeRole = (role: unknown) => role === 'rep' || role === 'tester'
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: { user }, error: userError } = await db.auth.getUser(jwt)
    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)

    const email = norm(user.email)
    const { data: access, error: accessError } = await db
      .from('app_user_access')
      .select('*')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || !access.organization_id) return json({ error: 'inactive_account' }, 403)

    const role = norm(access.role)
    const isAdmin = role === 'admin'
    const isManager = managerRole(role)
    const isRepresentative = representativeRole(role)
    if (!isAdmin && !isManager && !isRepresentative) return json({ error: 'field_role_required' }, 403)

    const organizationId = access.organization_id
    const { data: profile, error: profileError } = await db
      .from('users')
      .select('id,email,role,active,organization_id,auth_user_id')
      .eq('organization_id', organizationId)
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle()
    if (profileError) throw profileError
    if (!profile?.id) return json({ error: 'active_user_profile_required' }, 403)

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')

    let profiles: any[] | null = null
    const getProfiles = async () => {
      if (profiles) return profiles
      const { data, error } = await db
        .from('users')
        .select('id,email,role,active,organization_id')
        .eq('organization_id', organizationId)
        .eq('active', true)
      if (error) throw error
      profiles = data || []
      return profiles
    }
    const profileByEmail = async (value: unknown) =>
      (await getProfiles()).find(candidate => norm(candidate.email) === norm(value)) || null

    const adminForManager = async (managerAccess: any) => {
      const ownerEmail = norm(managerAccess?.assigned_manager_email)
      if (!ownerEmail || ownerEmail !== norm(managerAccess?.assigned_admin_email)) return null
      const { data, error } = await db
        .from('app_user_access')
        .select('email,role,active,organization_id')
        .eq('organization_id', organizationId)
        .eq('email', ownerEmail)
        .eq('role', 'admin')
        .eq('active', true)
        .maybeSingle()
      if (error) throw error
      return data ? ownerEmail : null
    }

    const managerInfo = async (managerAccess: any = access) => {
      if (!managerRole(managerAccess?.role)) return null
      const adminEmail = await adminForManager(managerAccess)
      const managerEmail = norm(managerAccess?.email || email)
      const managerProfile = await profileByEmail(managerEmail)
      if (!adminEmail || !managerProfile?.id) return null
      const { data: reports, error } = await db
        .from('app_user_access')
        .select('email,display_name,role,team_name,assigned_manager_email,assigned_admin_email')
        .eq('organization_id', organizationId)
        .eq('active', true)
        .in('role', ['rep', 'tester'])
        .ilike('assigned_manager_email', managerEmail)
        .order('display_name')
      if (error) throw error
      const profileRows = await getProfiles()
      const byEmail = new Map<string, any>(profileRows.map(item => [norm(item.email), item]))
      const reps = (reports || [])
        .map((report: any) => ({ ...report, user_id: byEmail.get(norm(report.email))?.id || null }))
        .filter((report: any) => report.user_id)
      return { id: managerProfile.id, email: managerEmail, adminEmail, reps }
    }

    const representativeManager = async (representativeAccess: any = access) => {
      const managerEmail = norm(representativeAccess?.assigned_manager_email)
      if (!managerEmail) return null
      const { data: managerAccess, error } = await db
        .from('app_user_access')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('email', managerEmail)
        .eq('active', true)
        .maybeSingle()
      if (error) throw error
      if (!managerAccess || !managerRole(managerAccess.role)) return null
      const info = await managerInfo(managerAccess)
      return info ? { ...info, email: managerEmail } : null
    }

    if (action === 'list_real_leads') {
      const page = Math.max(0, Math.floor(Number(body.page || 0)))
      const limit = Math.min(4000, Math.max(1, Math.floor(Number(body.limit || 1000))))
      const totalHint = Math.max(0, Math.floor(Number(body.total_hint || 0)))
      let scope = 'organization_all'
      let manager: any = null
      let assignmentReason: string | null = null

      if (isManager) {
        scope = 'manager_pool'
        manager = await managerInfo()
        if (!manager) assignmentReason = 'administrator_assignment_required'
      } else if (isRepresentative) {
        scope = 'rep_assigned'
        manager = await representativeManager()
        if (!manager) assignmentReason = 'manager_assignment_required'
      }

      if (assignmentReason) {
        return json({
          ok: true,
          scope,
          page,
          limit,
          total: 0,
          leads: [],
          owners: [],
          assignment_required: true,
          assignment_reason: assignmentReason,
          retention_mode: 'additive_missing_retained',
          import_batch_is_provenance_only: true,
        })
      }

      const columns = [
        'id','source_id','provider_lead_id','canonical_identity_key',
        'address1','address2','city','state','zip','latitude','longitude',
        'geocode_status','geocode_provider','geocode_precision',
        'geocode_verification_status','geocode_comparison_distance_meters',
        'geocode_candidate_latitude','geocode_candidate_longitude',
        'current_disposition','last_activity_type','visit_result','stage',
        'pin_color','pin_color_source','assigned_rep_id','assigned_manager_id',
        'assigned_admin_email','assigned_team_id','source_system','import_batch_id',
        'source_first_seen_at','source_last_seen_at','source_seen_count','created_at',
      ].join(',')

      const makeQuery = (includeCount = false) => {
        let query = db
          .from('leads')
          .select(columns, includeCount ? { count: 'exact' } : undefined)
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .not('source_system', 'ilike', '%demo%')
        if (isManager) {
          query = query
            .eq('assigned_manager_id', profile.id)
            .ilike('assigned_admin_email', manager.adminEmail)
        }
        if (isRepresentative) {
          query = query
            .eq('assigned_rep_id', profile.id)
            .eq('assigned_manager_id', manager.id)
            .ilike('assigned_admin_email', manager.adminEmail)
        }
        return query
      }

      const start = page * limit
      const slices: Array<{ start: number; end: number }> = []
      for (let offset = 0; offset < limit; offset += 1000) {
        slices.push({ start: start + offset, end: start + Math.min(limit, offset + 1000) - 1 })
      }
      const results = await Promise.all(slices.map((slice, index) =>
        makeQuery(index === 0 && !totalHint)
          .order('address1')
          .order('id')
          .range(slice.start, slice.end)
      ))
      for (const result of results) if (result.error) throw result.error
      const leads = results.flatMap(result => result.data || [])
      const total = totalHint || Number(results[0]?.count || 0)

      const { data: latest, error: latestError } = await db
        .from('spotio_import_batches')
        .select('id')
        .eq('organization_id', organizationId)
        .in('status', ['normalized', 'incomplete'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestError) throw latestError

      let allowedEmails: string[] | null = null
      if (isManager) allowedEmails = [email, manager.adminEmail, ...manager.reps.map((rep: any) => norm(rep.email))]
      if (isRepresentative) allowedEmails = [email, manager.email, manager.adminEmail]
      const { data: accounts, error: ownerError } = await db
        .from('app_user_access')
        .select('email,display_name,role,team_name,assigned_manager_email,assigned_admin_email')
        .eq('organization_id', organizationId)
        .eq('active', true)
        .in('role', ['admin', 'manager', 'trainer', 'rep', 'tester'])
        .order('display_name')
      if (ownerError) throw ownerError
      const profileRows = await getProfiles()
      const byEmail = new Map<string, any>(profileRows.map(item => [norm(item.email), item]))
      const owners = (accounts || [])
        .filter((account: any) => !allowedEmails || allowedEmails.includes(norm(account.email)))
        .map((account: any) => ({ user_id: byEmail.get(norm(account.email))?.id || null, ...account }))
        .filter((account: any) => account.user_id)

      return json({
        ok: true,
        scope,
        page,
        limit,
        total,
        leads,
        owners,
        batch_id: latest?.id || null,
        latest_import_batch_id: latest?.id || null,
        retention_mode: 'additive_missing_retained',
        import_batch_is_provenance_only: true,
        assignment_required: !isAdmin,
        assignment_reason: null,
        assigned_team: access.team_name || null,
      })
    }

    if (action === 'list_reps') {
      if (!isAdmin && !isManager) return json({ error: 'manager_or_admin_only' }, 403)
      if (isManager) {
        const manager = await managerInfo()
        return json({ ok: true, reps: manager?.reps || [], administrator_assigned: Boolean(manager) })
      }
      const { data: accounts, error } = await db
        .from('app_user_access')
        .select('email,display_name,role,team_name,assigned_manager_email,assigned_admin_email')
        .eq('organization_id', organizationId)
        .eq('active', true)
        .in('role', ['rep', 'tester', 'manager', 'trainer', 'admin'])
        .order('display_name')
      if (error) throw error
      const profileRows = await getProfiles()
      const byEmail = new Map<string, any>(profileRows.map(item => [norm(item.email), item]))
      return json({
        ok: true,
        reps: (accounts || [])
          .map((account: any) => ({ ...account, user_id: byEmail.get(norm(account.email))?.id || null }))
          .filter((account: any) => account.user_id),
      })
    }

    if (action === 'assign_lead' || action === 'assign_leads') {
      if (!isAdmin && !isManager) return json({ error: 'manager_or_admin_only' }, 403)
      const ids = action === 'assign_lead'
        ? [String(body.lead_id || '')]
        : [...new Set((Array.isArray(body.lead_ids) ? body.lead_ids : []).map((id: any) => String(id)).filter(Boolean))]
      if (!ids[0]) return json({ error: 'lead_ids_required' }, 400)
      if (ids.length > 1000) return json({ error: 'max_1000_leads_per_request' }, 400)

      const targetEmail = norm(body.rep_email)
      const targetQuery = targetEmail
        ? await db.from('app_user_access').select('*')
          .eq('organization_id', organizationId)
          .eq('email', targetEmail)
          .eq('active', true)
          .maybeSingle()
        : { data: null, error: null }
      if (targetQuery.error) throw targetQuery.error
      const target = targetQuery.data
      const targetProfile = target ? await profileByEmail(target.email) : null
      if (targetEmail && !targetProfile) return json({ error: 'rep_not_found' }, 404)

      let patch: any
      let destinationRole = 'unassigned'
      if (isManager) {
        const manager = await managerInfo()
        if (!manager) return json({ error: 'administrator_assignment_required' }, 403)
        if (target && (!representativeRole(target.role) || norm(target.assigned_manager_email) !== email)) {
          return json({ error: 'rep_not_managed_by_you' }, 403)
        }
        const { data: owned, error } = await db
          .from('leads')
          .select('id')
          .eq('organization_id', organizationId)
          .in('id', ids)
          .eq('assigned_manager_id', profile.id)
          .ilike('assigned_admin_email', manager.adminEmail)
          .is('deleted_at', null)
        if (error) throw error
        if ((owned || []).length !== ids.length) return json({ error: 'lead_outside_manager_pool' }, 403)
        patch = {
          assigned_rep_id: targetProfile?.id || null,
          assigned_manager_id: profile.id,
          assigned_admin_email: manager.adminEmail,
        }
        destinationRole = target?.role || 'manager_pool'
      } else if (!target) {
        patch = { assigned_rep_id: null, assigned_manager_id: null, assigned_admin_email: null }
      } else if (managerRole(target.role)) {
        const manager = await managerInfo(target)
        if (!manager || manager.adminEmail !== email) {
          return json({ error: 'manager_administrator_assignment_required' }, 403)
        }
        patch = {
          assigned_rep_id: null,
          assigned_manager_id: manager.id,
          assigned_admin_email: manager.adminEmail,
        }
        destinationRole = target.role
      } else if (representativeRole(target.role)) {
        const manager = await representativeManager(target)
        if (!manager || manager.adminEmail !== email) {
          return json({ error: 'rep_manager_assignment_required' }, 403)
        }
        patch = {
          assigned_rep_id: targetProfile.id,
          assigned_manager_id: manager.id,
          assigned_admin_email: manager.adminEmail,
        }
        destinationRole = target.role
      } else if (target.role === 'admin' && targetEmail === email) {
        patch = { assigned_rep_id: targetProfile.id, assigned_manager_id: null, assigned_admin_email: email }
        destinationRole = 'admin'
      } else {
        return json({ error: 'unsupported_assignment_target' }, 403)
      }

      let updated = 0
      for (let index = 0; index < ids.length; index += 75) {
        const { data, error } = await db.from('leads').update(patch)
          .eq('organization_id', organizationId)
          .in('id', ids.slice(index, index + 75))
          .is('deleted_at', null)
          .select('id')
        if (error) throw error
        updated += (data || []).length
      }
      return json({
        ok: true,
        updated,
        lead_id: action === 'assign_lead' ? ids[0] : undefined,
        rep_email: targetEmail || null,
        assigned_rep_id: patch.assigned_rep_id || null,
        assigned_manager_id: patch.assigned_manager_id || null,
        assigned_admin_email: patch.assigned_admin_email || null,
        destination_role: destinationRole,
      })
    }

    if (!isAdmin) return json({ error: 'admin_only' }, 403)

    if (action === 'duplicate_status') {
      const { data, error } = await db.rpc('lead_duplicate_status')
      if (error) throw error
      return json(data)
    }
    if (action === 'remove_duplicate_leads') {
      const { data, error } = await db.rpc('archive_verified_lead_duplicates', {
        p_actor_user_id: profile.id,
        p_actor_email: email,
        p_actor_role: role,
        p_snapshot_token: String(body.snapshot_token || ''),
        p_expected_extra_leads: Number(body.expected_extra_leads),
      })
      if (error) throw error
      return json(data)
    }
    if (action === 'delete_lead') {
      const { data, error } = await db.rpc('archive_lead', {
        p_lead_id: String(body.lead_id || ''),
        p_actor_user_id: profile.id,
        p_actor_email: email,
        p_actor_role: role,
        p_reason: 'manual',
      })
      if (error) throw error
      return json(data, data?.error === 'active_visit_exists' ? 409 : 200)
    }
    if (action === 'create_field_address') {
      const address1 = String(body.address1 || '').trim()
      const address2 = String(body.address2 || '').trim()
      const city = String(body.city || '').trim()
      const state = String(body.state || '').trim().toUpperCase()
      const zip = String(body.zip || '').trim()
      if (address1.length < 4 || !city || state.length !== 2 || !/^\d{5}(?:-\d{4})?$/.test(zip)) {
        return json({ error: 'complete_valid_address_required' }, 400)
      }
      const { data, error } = await db.from('leads').insert({
        organization_id: organizationId,
        address1,
        address2: address2 || null,
        city,
        state,
        zip,
        source_system: 'FIELD_ENTRY',
        source_id: crypto.randomUUID(),
        source_payload: { entered_by_email: email, entered_by_user_id: profile.id },
        geocode_status: 'pending_google',
        geocode_provider: 'field_entry',
        geocode_verification_status: 'pending_google',
      }).select('*').single()
      if (error) throw error
      return json({ ok: true, lead: data }, 201)
    }
    if (action === 'update_lead') {
      const patch: any = {}
      const coordinatesChanged = body.latitude !== undefined || body.longitude !== undefined
      const addressChanged = ['address1', 'address2', 'city', 'state', 'zip'].some(key => body[key] !== undefined)
      if (coordinatesChanged) {
        const latitude = Number(body.latitude), longitude = Number(body.longitude)
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
            || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
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
          geocode_attempted_at: new Date().toISOString(),
          geocode_verification_details: { reason: 'admin_dragged_pin_to_door' },
        })
      }
      for (const key of ['address1', 'address2', 'city', 'state', 'zip']) {
        if (body[key] !== undefined) patch[key] = String(body[key] || '').trim() || (key === 'address2' ? null : '')
      }
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
      const { data, error } = await db.from('leads').update(patch)
        .eq('id', String(body.lead_id || ''))
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data ? json({ ok: true, lead: data }) : json({ error: 'lead_not_found' }, 404)
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('lead-admin', error)
    return json({
      error: 'lead_admin_failed',
      detail: String((error as Error)?.message || error).slice(0, 500),
    }, 500)
  }
})
