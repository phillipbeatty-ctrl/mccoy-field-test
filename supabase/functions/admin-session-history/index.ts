import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const TIME_ZONE = 'America/Los_Angeles'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_ROWS = 5000

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

function pacificDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const get = (type: string) => parts.find(part => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function pacificMidnight(value: string) {
  if (!DATE_PATTERN.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(year, month - 1, day, 12))
  if (Number.isNaN(probe.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(probe)
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value || 0)
  const represented = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  const offset = represented - probe.getTime()
  const midnight = new Date(Date.UTC(year, month - 1, day) - offset)
  return pacificDate(midnight) === value ? midnight : null
}

function addCalendarDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function reasonLabel(code: string | null) {
  const labels: Record<string, string> = {
    manual_stop: 'Stopped by user',
    outside_assigned_area: 'Auto-stopped outside assigned area',
    stationary_after_disposition: 'Auto-stopped after inactivity',
    inactive_30_minutes: 'Auto-closed after inactivity',
    maximum_16_hours: 'Auto-closed at maximum session length',
    ended: 'Session terminated',
  }
  return labels[code || ''] || 'Session terminated'
}

function chunks<T>(values: T[], size = 200) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
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
      .select('role,active,organization_id,display_name')
      .eq('email', email)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.active || access.role !== 'admin' || !access.organization_id) return json({ error: 'admin_required' }, 403)

    const body = await req.json().catch(() => ({}))
    const selectedDate = String(body?.date || pacificDate()).trim()
    const today = pacificDate()
    if (!DATE_PATTERN.test(selectedDate) || selectedDate > today) return json({ error: 'valid_non_future_date_required' }, 400)

    const dayStart = pacificMidnight(selectedDate)
    const dayEnd = pacificMidnight(addCalendarDays(selectedDate, 1))
    if (!dayStart || !dayEnd || dayEnd <= dayStart) return json({ error: 'invalid_date' }, 400)

    const startIso = dayStart.toISOString()
    const endIso = dayEnd.toISOString()
    const columns = 'id,tester_name,tester_user_id,tester_email,started_at,ended_at,app_version,device_type'
    const base = () => admin.from('test_sessions').select(columns).eq('organization_id', access.organization_id).limit(MAX_ROWS)

    const [startedResult, endedResult, openResult, spanningResult] = await Promise.all([
      base().gte('started_at', startIso).lt('started_at', endIso).order('started_at', { ascending: true }),
      base().gte('ended_at', startIso).lt('ended_at', endIso).order('ended_at', { ascending: true }),
      base().lt('started_at', endIso).is('ended_at', null).order('started_at', { ascending: true }),
      base().lt('started_at', endIso).gte('ended_at', endIso).order('started_at', { ascending: true }),
    ])

    for (const result of [startedResult, endedResult, openResult, spanningResult]) {
      if (result.error) throw result.error
    }

    const sessionMap = new Map<string, any>()
    for (const row of [
      ...(startedResult.data || []),
      ...(endedResult.data || []),
      ...(openResult.data || []),
      ...(spanningResult.data || []),
    ]) {
      const startedAt = new Date(row.started_at)
      const endedAt = row.ended_at ? new Date(row.ended_at) : null
      if (startedAt < dayEnd && (!endedAt || endedAt >= dayStart)) sessionMap.set(row.id, row)
    }

    const sessions = [...sessionMap.values()]
    const ids = sessions.map(row => row.id)
    const terminationEvents: any[] = []
    const autoClosures: any[] = []

    for (const idChunk of chunks(ids)) {
      const [eventResult, closureResult] = await Promise.all([
        admin.from('test_events')
          .select('session_id,event_type,event_time,payload')
          .eq('organization_id', access.organization_id)
          .in('session_id', idChunk)
          .in('event_type', ['session_end', 'auto_stop'])
          .order('event_time', { ascending: true }),
        admin.from('field_session_auto_closures')
          .select('session_id,closed_at,reason')
          .eq('organization_id', access.organization_id)
          .in('session_id', idChunk),
      ])
      if (eventResult.error) throw eventResult.error
      if (closureResult.error) throw closureResult.error
      terminationEvents.push(...(eventResult.data || []))
      autoClosures.push(...(closureResult.data || []))
    }

    const eventBySession = new Map<string, any>()
    for (const event of terminationEvents) eventBySession.set(event.session_id, event)
    const closureBySession = new Map(autoClosures.map(row => [row.session_id, row]))
    const now = new Date()
    const effectiveDayEnd = now < dayEnd ? now : dayEnd

    const rows = sessions.map(session => {
      const startedAt = new Date(session.started_at)
      const endedAt = session.ended_at ? new Date(session.ended_at) : null
      const event = eventBySession.get(session.id)
      const closure = closureBySession.get(session.id)
      const reasonCode = endedAt
        ? String(closure?.reason || event?.payload?.reason || 'ended')
        : null
      const terminationSource = endedAt
        ? closure ? 'stale_session_control' : event?.event_type === 'auto_stop' ? 'session_control' : event?.event_type === 'session_end' ? 'manual' : 'legacy'
        : null
      const overlapStart = startedAt > dayStart ? startedAt : dayStart
      const rawOverlapEnd = endedAt || effectiveDayEnd
      const overlapEnd = rawOverlapEnd < effectiveDayEnd ? rawOverlapEnd : effectiveDayEnd
      const overlapSeconds = Math.max(0, Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 1000))
      return {
        id: session.id,
        user_id: session.tester_user_id,
        user_name: session.tester_name || session.tester_email || 'User',
        user_email: session.tester_email || null,
        started_at: session.started_at,
        ended_at: session.ended_at,
        started_on_selected_day: startedAt >= dayStart && startedAt < dayEnd,
        ended_on_selected_day: !!endedAt && endedAt >= dayStart && endedAt < dayEnd,
        duration_seconds: Math.max(0, Math.floor(((endedAt || now).getTime() - startedAt.getTime()) / 1000)),
        overlap_seconds: overlapSeconds,
        status: endedAt ? 'terminated' : 'active',
        termination_reason: reasonCode,
        termination_label: endedAt ? reasonLabel(reasonCode) : 'Active session',
        termination_source: terminationSource,
        app_version: session.app_version || null,
        device_type: session.device_type || null,
      }
    }).sort((left, right) => String(left.started_at).localeCompare(String(right.started_at)))

    const timeline: any[] = []
    for (const row of rows) {
      if (row.started_on_selected_day) timeline.push({
        session_id: row.id,
        user_name: row.user_name,
        user_email: row.user_email,
        type: 'started',
        event_at: row.started_at,
        label: 'Session started',
      })
      if (row.ended_on_selected_day) timeline.push({
        session_id: row.id,
        user_name: row.user_name,
        user_email: row.user_email,
        type: 'terminated',
        event_at: row.ended_at,
        label: row.termination_label,
        reason: row.termination_reason,
        source: row.termination_source,
      })
    }
    timeline.sort((left, right) => String(left.event_at).localeCompare(String(right.event_at)))

    const startedRows = rows.filter(row => row.started_on_selected_day)
    const endedRows = rows.filter(row => row.ended_on_selected_day)
    const uniqueUsers = new Set(rows.map(row => row.user_email || row.user_name))

    return json({
      ok: true,
      date: selectedDate,
      timezone: TIME_ZONE,
      day_start: startIso,
      day_end: endIso,
      generated_at: now.toISOString(),
      summary: {
        sessions_started: startedRows.length,
        sessions_terminated: endedRows.length,
        unique_users: uniqueUsers.size,
        active_sessions: rows.filter(row => {
          const startedAt = new Date(row.started_at)
          const endedAt = row.ended_at ? new Date(row.ended_at) : null
          return startedAt < effectiveDayEnd && (!endedAt || endedAt >= effectiveDayEnd)
        }).length,
        tracked_seconds: rows.reduce((sum, row) => sum + Number(row.overlap_seconds || 0), 0),
      },
      sessions: rows,
      timeline,
    })
  } catch (error) {
    console.error('admin-session-history', error)
    return json({ error: 'admin_session_history_failed' }, 500)
  }
})
