import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

// Badge catalog: key -> {label, emoji, points}. Awarding is idempotent via
// the unique (rep_user_id, badge_key) constraint on rep_badges.
const BADGES: Record<string, { label: string; emoji: string; points: number }> = {
  first_knock: { label: 'First Knock', emoji: '\u{1F6AA}', points: 10 },
  first_sale: { label: 'First Sale', emoji: '\u{1F389}', points: 50 },
  streak_7: { label: 'Week Strong', emoji: '\u{1F525}', points: 25 },
  streak_30: { label: 'Marathon Month', emoji: '\u{1F3C6}', points: 100 },
  century_doors_day: { label: 'Century Day', emoji: '\u26A1', points: 30 },
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

    const { data: profile } = await admin.from('users').select('id').eq('auth_user_id', user.id).eq('organization_id', access.organization_id).maybeSingle()
    const repId = profile?.id || null

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')

    async function awardPoints(points: number, reason: string, detail?: string) {
      await admin.from('rep_points_ledger').insert({ rep_user_id: user.id, organization_id: access.organization_id, points, reason, reason_detail: detail || null })
    }
    async function awardBadge(key: string) {
      const badge = BADGES[key]; if (!badge) return
      const { error } = await admin.from('rep_badges').insert({ rep_user_id: user.id, organization_id: access.organization_id, badge_key: key, badge_label: badge.label, badge_emoji: badge.emoji })
      if (!error) await awardPoints(badge.points, 'badge_earned', key) // insert only succeeds once per badge_key due to the unique constraint
    }

    if (action === 'record_door_knock') {
      await awardPoints(1, 'door_knock')
      const { count } = await admin.from('rep_points_ledger').select('id', { count: 'exact', head: true }).eq('rep_user_id', user.id).eq('reason', 'door_knock')
      if ((count || 0) <= 1) await awardBadge('first_knock')
      if (repId) {
        const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
        const { count: todayCount } = await admin.from('door_visits').select('id', { count: 'exact', head: true }).eq('rep_id', repId).gte('created_at', todayStart.toISOString())
        if ((todayCount || 0) >= 100) await awardBadge('century_doors_day')
      }
      return json({ ok: true })
    }

    if (action === 'record_sale') {
      await awardPoints(25, 'sale_completed')
      const { count } = await admin.from('rep_points_ledger').select('id', { count: 'exact', head: true }).eq('rep_user_id', user.id).eq('reason', 'sale_completed')
      if ((count || 0) <= 1) await awardBadge('first_sale')
      return json({ ok: true })
    }

    if (action === 'get_status') {
      const { data: pointsRows } = await admin.from('rep_points_ledger').select('points').eq('rep_user_id', user.id)
      const earned = (pointsRows || []).reduce((sum, r) => sum + Number(r.points || 0), 0)
      const { data: purchases } = await admin.from('rep_personalization_purchases').select('item_key,purchased_at').eq('rep_user_id', user.id)
      const spent = (purchases || []).length
      const { data: badges } = await admin.from('rep_badges').select('badge_key,badge_label,badge_emoji,earned_at').eq('rep_user_id', user.id).order('earned_at', { ascending: false })
      const { data: streak } = await admin.from('rep_work_streaks').select('current_streak_days,longest_streak_days,grace_days_banked,last_worked_date').eq('rep_user_id', user.id).maybeSingle()
      const { data: theme } = await admin.from('rep_active_theme').select('item_key').eq('rep_user_id', user.id).maybeSingle()
      const { data: costRows } = await admin.from('personalization_items').select('item_key,point_cost').in('item_key', (purchases || []).map(p => p.item_key))
      const pointsSpentTotal = (costRows || []).reduce((sum, r) => sum + Number(r.point_cost || 0), 0)
      // Streak badges are awarded lazily here, on status read, since streaks are
      // updated by a scheduled evaluation rather than a live rep action.
      if ((streak?.current_streak_days || 0) >= 30) await awardBadge('streak_30')
      else if ((streak?.current_streak_days || 0) >= 7) await awardBadge('streak_7')
      return json({
        ok: true,
        points_balance: earned - pointsSpentTotal,
        points_earned_lifetime: earned,
        badges: badges || [],
        streak: streak || { current_streak_days: 0, longest_streak_days: 0, grace_days_banked: 0, last_worked_date: null },
        active_theme: theme?.item_key || 'theme_default',
        owned_items: (purchases || []).map(p => p.item_key).concat('theme_default'),
      })
    }

    if (action === 'list_store_items') {
      const { data } = await admin.from('personalization_items').select('item_key,label,point_cost,theme_class').eq('active', true).order('point_cost', { ascending: true })
      return json({ ok: true, items: data || [] })
    }

    if (action === 'purchase_item') {
      const itemKey = String(body.item_key || '')
      const { data: item } = await admin.from('personalization_items').select('item_key,point_cost').eq('item_key', itemKey).eq('active', true).maybeSingle()
      if (!item) return json({ error: 'item_not_found' }, 404)
      const { data: pointsRows } = await admin.from('rep_points_ledger').select('points').eq('rep_user_id', user.id)
      const earned = (pointsRows || []).reduce((sum, r) => sum + Number(r.points || 0), 0)
      const { data: purchases } = await admin.from('rep_personalization_purchases').select('item_key').eq('rep_user_id', user.id)
      const { data: costRows } = await admin.from('personalization_items').select('point_cost').in('item_key', (purchases || []).map(p => p.item_key))
      const spentSoFar = (costRows || []).reduce((sum, r) => sum + Number(r.point_cost || 0), 0)
      if (earned - spentSoFar < item.point_cost) return json({ error: 'insufficient_points' }, 400)
      const { error } = await admin.from('rep_personalization_purchases').insert({ rep_user_id: user.id, organization_id: access.organization_id, item_key: itemKey })
      if (error) { if (error.code === '23505') return json({ ok: true, already_owned: true }); throw error }
      return json({ ok: true })
    }

    if (action === 'set_active_theme') {
      const itemKey = String(body.item_key || 'theme_default')
      if (itemKey !== 'theme_default') {
        const { data: owned } = await admin.from('rep_personalization_purchases').select('item_key').eq('rep_user_id', user.id).eq('item_key', itemKey).maybeSingle()
        if (!owned) return json({ error: 'item_not_owned' }, 403)
      }
      const { error } = await admin.from('rep_active_theme').upsert({ rep_user_id: user.id, organization_id: access.organization_id, item_key: itemKey, updated_at: new Date().toISOString() })
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'list_goals') {
      const { data, error } = await admin.from('rep_personal_goals').select('id,goal_type,period,target_count').eq('rep_user_id', user.id).eq('active', true)
      if (error) throw error
      const goals = []
      for (const goal of data || []) {
        const since = goal.period === 'today' ? new Date(new Date().setUTCHours(0, 0, 0, 0)) : new Date(Date.now() - 7 * 86400000)
        let progress = 0
        if (goal.goal_type === 'doors' && repId) {
          const { count } = await admin.from('door_visits').select('id', { count: 'exact', head: true }).eq('rep_id', repId).gte('created_at', since.toISOString())
          progress = count || 0
        } else if (goal.goal_type === 'sales') {
          const { count } = await admin.from('sales_records').select('id', { count: 'exact', head: true }).eq('rep_user_id', user.id).eq('ranking_eligible', true).gte('created_at', since.toISOString())
          progress = count || 0
        }
        goals.push({ ...goal, progress })
      }
      return json({ ok: true, goals })
    }

    if (action === 'create_goal') {
      const goalType = String(body.goal_type || ''); const period = String(body.period || '')
      const target = Number(body.target_count)
      if (!['doors', 'sales'].includes(goalType) || !['today', 'this_week'].includes(period) || !Number.isFinite(target) || target <= 0) {
        return json({ error: 'invalid_goal' }, 400)
      }
      await admin.from('rep_personal_goals').update({ active: false }).eq('rep_user_id', user.id).eq('goal_type', goalType).eq('period', period).eq('active', true)
      const { data, error } = await admin.from('rep_personal_goals').insert({ rep_user_id: user.id, organization_id: access.organization_id, goal_type: goalType, period, target_count: target }).select().single()
      if (error) throw error
      return json({ ok: true, goal: data })
    }

    if (action === 'delete_goal') {
      if (!body.id) return json({ error: 'id_required' }, 400)
      await admin.from('rep_personal_goals').update({ active: false }).eq('id', String(body.id)).eq('rep_user_id', user.id)
      return json({ ok: true })
    }

    if (action === 'personal_bests') {
      if (!repId) return json({ ok: true, best_day_doors: 0, best_day_sales: 0 })
      const { data: doorRows } = await admin.from('door_visits').select('created_at').eq('rep_id', repId)
      const doorsByDay: Record<string, number> = {}
      for (const row of doorRows || []) { const d = String(row.created_at).slice(0, 10); doorsByDay[d] = (doorsByDay[d] || 0) + 1 }
      const bestDayDoors = Math.max(0, ...Object.values(doorsByDay))
      const { data: saleRows } = await admin.from('sales_records').select('created_at').eq('rep_user_id', user.id).eq('ranking_eligible', true)
      const salesByDay: Record<string, number> = {}
      for (const row of saleRows || []) { const d = String(row.created_at).slice(0, 10); salesByDay[d] = (salesByDay[d] || 0) + 1 }
      const bestDaySales = Math.max(0, ...Object.values(salesByDay))
      return json({ ok: true, best_day_doors: bestDayDoors, best_day_sales: bestDaySales })
    }

    if (action === 'leaderboard_today') {
      const { data, error } = await admin.rpc('rep_leaderboard_today', { p_organization_id: access.organization_id })
      if (error) throw error
      return json({ ok: true, leaderboard: data || [] })
    }

    if (action === 'list_battle_objections') {
      const { data, error } = await admin
        .from('sales_coaching_objections')
        .select('id,objection_text,options,correct_option_id,explanation,framework')
        .eq('organization_id', access.organization_id)
        .eq('active', true)
        .in('framework', ['feel_felt_found', 'laer'])
      if (error) throw error
      return json({ ok: true, objections: data || [] })
    }

    if (action === 'record_battle_victory') {
      const objectionId = String(body.objection_id || '')
      if (!objectionId) return json({ error: 'objection_id_required' }, 400)
      const { data: objection } = await admin.from('sales_coaching_objections').select('id').eq('id', objectionId).eq('organization_id', access.organization_id).maybeSingle()
      if (!objection) return json({ error: 'objection_not_found' }, 404)
      const { error: insertError } = await admin.from('game_battle_victories').insert({ rep_user_id: user.id, organization_id: access.organization_id, objection_id: objectionId })
      const firstVictory = !insertError
      if (firstVictory) await awardPoints(15, 'battle_victory', objectionId)
      else if (insertError.code !== '23505') throw insertError
      const { count } = await admin.from('game_battle_victories').select('id', { count: 'exact', head: true }).eq('rep_user_id', user.id)
      const level = 1 + Math.floor((count || 0) / 3)
      return json({ ok: true, first_victory: firstVictory, points_awarded: firstVictory ? 15 : 0, victories: count || 0, level })
    }

    if (action === 'game_status') {
      const { count } = await admin.from('game_battle_victories').select('id', { count: 'exact', head: true }).eq('rep_user_id', user.id)
      const victories = count || 0
      const level = 1 + Math.floor(victories / 3)
      const victoriesToNextLevel = 3 - (victories % 3)
      return json({ ok: true, victories, level, victories_to_next_level: victoriesToNextLevel })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('gamification', error)
    return json({ error: 'gamification_failed', detail: String((error as Error)?.message || error).slice(0, 240) }, 500)
  }
})
