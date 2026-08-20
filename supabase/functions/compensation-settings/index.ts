import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { PAY_LEVELS } from '../_shared/compensation-calculator.mjs'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user?.email) return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })

    const email = user.email.toLowerCase()
    const [{ data: access }, { data: accounting }] = await Promise.all([
      admin.from('app_user_access').select('role,active').eq('email', email).maybeSingle(),
      admin.from('accounting_access').select('active').eq('email', email).maybeSingle()
    ])
    const canView = !!access?.active && (access.role === 'admin' || accounting?.active)
    const canEdit = !!access?.active && access.role === 'admin'
    if (!canView) return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders })

    if (req.method === 'GET') {
      const [{ data: compensation }, { data: global }, { data: managerControls }, { data: reps }, { data: repControls }] = await Promise.all([
        admin.from('compensation_rules').select('id,rule').eq('active', true).limit(1).maybeSingle(),
        admin.from('compensation_admin_settings').select('manager_overrides_enabled,updated_at').eq('singleton', true).maybeSingle(),
        admin.from('manager_override_controls').select('manager_name,manager_email,overrides_enabled,updated_at').order('manager_name'),
        admin.from('app_user_access').select('email,display_name,role,active,sales_classification,assigned_manager_name,assigned_manager_email').eq('active', true).order('display_name'),
        admin.from('rep_override_controls').select('rep_email,rep_display_name,manager_name,manager_email,overrides_enabled,updated_at')
      ])
      const rule:any = compensation?.rule || {}
      const repMap = new Map((repControls || []).map((row:any) => [String(row.rep_email).toLowerCase(), row]))
      const managerByEmail = new Map((managerControls || []).filter((row:any)=>row.manager_email).map((row:any)=>[String(row.manager_email).toLowerCase(),row]))
      const managerByName = new Map((managerControls || []).map((row:any)=>[String(row.manager_name||''),row]))
      const managerAccounts = (reps || []).filter((row:any)=>['manager','admin'].includes(row.role)).map((row:any)=>{
        const control:any=managerByEmail.get(String(row.email).toLowerCase())||managerByName.get(String(row.display_name||''))
        return {manager_name:row.display_name||row.email,manager_email:row.email,overrides_enabled:control?.overrides_enabled??true,updated_at:control?.updated_at||null}
      })
      const repRows = (reps || []).filter((row:any) => row.assigned_manager_name || row.assigned_manager_email).map((row:any) => {
        const control:any = repMap.get(String(row.email).toLowerCase())
        const manager:any = managerAccounts.find((candidate:any) =>
          (row.assigned_manager_email && candidate.manager_email && String(candidate.manager_email).toLowerCase() === String(row.assigned_manager_email).toLowerCase()) ||
          (row.assigned_manager_name && candidate.manager_name === row.assigned_manager_name)
        )
        const enabled = control?.overrides_enabled ?? true
        const globalEnabled = global?.manager_overrides_enabled ?? true
        const managerEnabled = manager?.overrides_enabled ?? true
        return {
          email: row.email,
          display_name: row.display_name || row.email,
          role: row.role,
          sales_classification: row.sales_classification || null,
          manager_name: row.assigned_manager_name || manager?.manager_name || null,
          manager_email: row.assigned_manager_email || manager?.manager_email || null,
          overrides_enabled: enabled,
          effective_overrides_enabled: !!(globalEnabled && managerEnabled && enabled)
        }
      })
      return Response.json({
        ok: true,
        can_edit: canEdit,
        global_manager_overrides_enabled: global?.manager_overrides_enabled ?? true,
        tiers: (rule.weekly_production_pay_increase || []).map((tier:any) => ({
          min_sales: Number(tier.min_sales),
          max_sales: tier.max_sales == null ? null : Number(tier.max_sales),
          increase_per_sale: Number(tier.increase_per_sale)
        })),
        pay_scale: {
          levels: PAY_LEVELS,
          quantum: rule.quantum || {},
          brightspeed: rule.brightspeed || {},
          att: {
            fiber_below_1_gig: rule.att?.fiber_below_1_gig || {},
            fiber_1_gig: rule.att?.fiber_1_gig || {},
            internet_air: Number(rule.att?.internet_air || 0),
            mobile_first_line: Number(rule.att?.mobile_first_line || 0),
            mobile_additional_line: Number(rule.att?.mobile_additional_line || 0)
          }
        },
        managers: managerAccounts,
        reps: repRows,
        manager_override_amount_per_sale: Number(rule.manager_override?.amount_per_sale || 25)
      }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } })
    }

    if (!canEdit) return Response.json({ error: 'admin_required' }, { status: 403, headers: corsHeaders })
    const body = await req.json().catch(() => ({}))

    if (body.action === 'set_global_manager_overrides') {
      const enabled = !!body.enabled
      const { error } = await admin.from('compensation_admin_settings').upsert({
        singleton: true,
        manager_overrides_enabled: enabled,
        updated_at: new Date().toISOString(),
        updated_by: user.id
      }, { onConflict: 'singleton' })
      if (error) throw error
      return Response.json({ ok: true, manager_overrides_enabled: enabled }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } })
    }

    if (body.action === 'set_weekly_thresholds') {
      const tier1 = Number(body.tier1_min_sales), tier2 = Number(body.tier2_min_sales)
      if (!Number.isInteger(tier1) || !Number.isInteger(tier2) || tier1 < 1 || tier2 <= tier1 || tier2 > 500) {
        return Response.json({ error: 'invalid_thresholds' }, { status: 400, headers: corsHeaders })
      }
      const { data: compensation } = await admin.from('compensation_rules').select('id,rule').eq('active', true).limit(1).maybeSingle()
      if (!compensation) return Response.json({ error: 'active_compensation_rule_missing' }, { status: 404, headers: corsHeaders })
      const rule:any = compensation.rule || {}
      rule.weekly_production_pay_increase = [
        { min_sales: tier1, max_sales: tier2 - 1, increase_per_sale: 25 },
        { min_sales: tier2, max_sales: null, increase_per_sale: 50 }
      ]
      const { error } = await admin.from('compensation_rules').update({ rule }).eq('id', compensation.id)
      if (error) throw error
      return Response.json({ ok: true, tiers: rule.weekly_production_pay_increase }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } })
    }

    if (body.action === 'set_manager_override') {
      const managerEmail = String(body.manager_email || '').trim().toLowerCase()
      if (!managerEmail) return Response.json({ error: 'manager_email_required' }, { status: 400, headers: corsHeaders })
      const { data: result, error } = await admin.rpc('admin_set_manager_override_authority',{
        p_manager_email:managerEmail,p_enabled:!!body.overrides_enabled,p_changed_by:user.id,p_changed_by_email:email
      })
      if (error) throw error
      return Response.json({ ok: true, ...(result||{}) }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } })
    }

    if (body.action === 'set_rep_override') {
      const repEmail = String(body.rep_email || '').trim().toLowerCase()
      if (!repEmail) return Response.json({ error: 'rep_email_required' }, { status: 400, headers: corsHeaders })
      const { data: rep } = await admin.from('app_user_access').select('email,display_name,assigned_manager_name,assigned_manager_email').eq('email', repEmail).maybeSingle()
      if (!rep) return Response.json({ error: 'rep_not_found' }, { status: 404, headers: corsHeaders })
      const { error } = await admin.from('rep_override_controls').upsert({
        rep_email: repEmail,
        rep_display_name: rep.display_name || rep.email,
        manager_name: rep.assigned_manager_name || null,
        manager_email: rep.assigned_manager_email || null,
        overrides_enabled: !!body.overrides_enabled,
        updated_at: new Date().toISOString(),
        updated_by: user.id
      }, { onConflict: 'rep_email' })
      if (error) throw error
      return Response.json({ ok: true }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } })
    }

    if (body.action === 'assign_rep_manager') {
      const repEmail = String(body.rep_email || '').trim().toLowerCase()
      const managerName = String(body.manager_name || '').trim() || null
      const managerEmail = String(body.manager_email || '').trim().toLowerCase() || null
      if (!repEmail) return Response.json({ error: 'rep_email_required' }, { status: 400, headers: corsHeaders })
      const { error } = await admin.from('app_user_access').update({
        assigned_manager_name: managerName,
        assigned_manager_email: managerEmail
      }).eq('email', repEmail)
      if (error) throw error
      return Response.json({ ok: true }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } })
    }

    return Response.json({ error: 'unsupported_action' }, { status: 400, headers: corsHeaders })
  } catch (error) {
    console.error('compensation-settings', error)
    return Response.json({ error: 'compensation_settings_failed' }, { status: 500, headers: corsHeaders })
  }
})
