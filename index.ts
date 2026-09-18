import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function boundedText(value: any, maxLength: number) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, maxLength) : null
}

serveWithOrganizationAccess('field_coach_access', async request => {
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

    const email = user.email.toLowerCase()
    const { data: access, error: accessError } = await admin
      .from('app_user_access')
      .select('role,active,organization_id')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || !access.organization_id) return json({ error: 'forbidden' }, 403)
    const isAdmin = access.role === 'admin'

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'list_tips') {
      const { data, error } = await admin
        .from('sales_coaching_tips')
        .select('id,tip_text,category,sort_order,active')
        .eq('organization_id', access.organization_id)
        .eq('active', true)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return json({ ok: true, tips: data || [] })
    }

    if (action === 'list_objections') {
      const { data, error } = await admin
        .from('sales_coaching_objections')
        .select('id,objection_text,options,correct_option_id,explanation,framework,sort_order,active')
        .eq('organization_id', access.organization_id)
        .eq('active', true)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return json({ ok: true, objections: data || [] })
    }

    // Everything below is admin-only content management.
    if (!isAdmin) return json({ error: 'admin_required' }, 403)

    if (action === 'admin_list_all_tips') {
      const { data, error } = await admin
        .from('sales_coaching_tips')
        .select('id,tip_text,category,sort_order,active,created_by_email,updated_at')
        .eq('organization_id', access.organization_id)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return json({ ok: true, tips: data || [] })
    }

    if (action === 'admin_list_all_objections') {
      const { data, error } = await admin
        .from('sales_coaching_objections')
        .select('id,objection_text,options,correct_option_id,explanation,framework,sort_order,active,created_by_email,updated_at')
        .eq('organization_id', access.organization_id)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return json({ ok: true, objections: data || [] })
    }

    if (action === 'admin_upsert_tip') {
      const tipText = boundedText(body.tip_text, 500)
      if (!tipText) return json({ error: 'tip_text_required' }, 400)
      const row = {
        organization_id: access.organization_id,
        tip_text: tipText,
        category: boundedText(body.category, 80),
        sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
        active: body.active !== false,
        created_by_email: email,
        updated_at: new Date().toISOString(),
      }
      let query
      if (body.id) {
        query = admin.from('sales_coaching_tips').update(row).eq('id', String(body.id)).eq('organization_id', access.organization_id).select().single()
      } else {
        query = admin.from('sales_coaching_tips').insert(row).select().single()
      }
      const { data, error } = await query
      if (error) throw error
      return json({ ok: true, tip: data })
    }

    if (action === 'admin_delete_tip') {
      if (!body.id) return json({ error: 'id_required' }, 400)
      const { error } = await admin.from('sales_coaching_tips').delete().eq('id', String(body.id)).eq('organization_id', access.organization_id)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'admin_upsert_objection') {
      const objectionText = boundedText(body.objection_text, 500)
      const explanation = boundedText(body.explanation, 1000)
      const options = Array.isArray(body.options) ? body.options : null
      const correctOptionId = boundedText(body.correct_option_id, 20)
      if (!objectionText || !explanation) return json({ error: 'objection_text_and_explanation_required' }, 400)
      if (!options || options.length < 2 || options.length > 6) return json({ error: 'valid_options_required' }, 400)
      const cleanOptions = options.map((o: any) => ({ id: boundedText(o?.id, 20), text: boundedText(o?.text, 300) })).filter((o: any) => o.id && o.text)
      if (cleanOptions.length !== options.length) return json({ error: 'invalid_option_entries' }, 400)
      if (!correctOptionId || !cleanOptions.some((o: any) => o.id === correctOptionId)) return json({ error: 'correct_option_id_must_match_an_option' }, 400)
      const row = {
        organization_id: access.organization_id,
        objection_text: objectionText,
        options: cleanOptions,
        correct_option_id: correctOptionId,
        explanation,
        framework: boundedText(body.framework, 40),
        sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
        active: body.active !== false,
        created_by_email: email,
        updated_at: new Date().toISOString(),
      }
      let query
      if (body.id) {
        query = admin.from('sales_coaching_objections').update(row).eq('id', String(body.id)).eq('organization_id', access.organization_id).select().single()
      } else {
        query = admin.from('sales_coaching_objections').insert(row).select().single()
      }
      const { data, error } = await query
      if (error) throw error
      return json({ ok: true, objection: data })
    }

    if (action === 'admin_delete_objection') {
      if (!body.id) return json({ error: 'id_required' }, 400)
      const { error } = await admin.from('sales_coaching_objections').delete().eq('id', String(body.id)).eq('organization_id', access.organization_id)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('sales-coaching', error)
    return json({ error: 'sales_coaching_failed', detail: String((error as Error)?.message || error).slice(0, 240) }, 500)
  }
})
