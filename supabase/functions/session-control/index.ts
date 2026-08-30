import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const EARTH_RADIUS_METERS = 6_371_000
const OUTSIDE_AREA_GRACE_MS = 30 * 60 * 1000
const toRadians = (value: number) => value * Math.PI / 180

function distanceMeters(left: any, right: any) {
  if (!left || !right || left.latitude == null || left.longitude == null || right.latitude == null || right.longitude == null) return null
  const latitudeDelta = toRadians(right.latitude - left.latitude)
  const longitudeDelta = toRadians(right.longitude - left.longitude)
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(left.latitude)) * Math.cos(toRadians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(value))
}

function nearestDistance(point: any, references: any[]) {
  let best: number | null = null
  for (const reference of references) {
    const distance = distanceMeters(point, reference)
    if (distance != null && (best == null || distance < best)) best = distance
  }
  return best
}

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
})

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

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

    const { data: access } = await admin
      .from('app_user_access')
      .select('role,active')
      .eq('email', user.email.toLowerCase())
      .maybeSingle()
    if (!access?.active) return json({ error: 'forbidden' }, 403)

    const body = await request.json().catch(() => ({}))
    const sessionId = body.session_id
    if (!sessionId) return json({ error: 'session_id_required' }, 400)

    const { data: session } = await admin
      .from('test_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('tester_user_id', user.id)
      .maybeSingle()
    if (!session) return json({ error: 'session_not_found' }, 404)
    if (session.ended_at) return json({ ok: true, action: 'stop', reason: 'session_already_ended' })

    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    if (body.action === 'manual_stop') {
      const { data: last } = await admin
        .from('test_events')
        .select('latitude,longitude,accuracy_meters')
        .eq('session_id', sessionId)
        .order('event_time', { ascending: false })
        .limit(1)
        .maybeSingle()

      await admin.from('test_events').insert({
        session_id: sessionId,
        event_type: 'session_end',
        event_time: nowIso,
        latitude: last?.latitude ?? null,
        longitude: last?.longitude ?? null,
        accuracy_meters: last?.accuracy_meters ?? null,
        payload: { reason: 'manual_stop', controlEngine: '1.2' },
      })
      await admin.from('test_sessions').update({ ended_at: nowIso }).eq('id', sessionId)
      return json({ ok: true, action: 'stop', reason: 'manual_stop' })
    }

    const { data: ruleRow } = await admin
      .from('session_control_rules')
      .select('*')
      .eq('active', true)
      .order('id')
      .limit(1)
      .maybeSingle()

    const rule = ruleRow || {
      outside_area_distance_m: 200,
      outside_area_grace_ms: OUTSIDE_AREA_GRACE_MS,
      stationary_radius_m: 12,
      post_disposition_idle_ms: 120_000,
      post_sale_idle_ms: 240_000,
    }

    const { data: events, error: eventsError } = await admin
      .from('test_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('event_time', { ascending: true })
    if (eventsError) throw eventsError

    const allEvents = events || []
    const points = allEvents.filter((event: any) => event.latitude != null && event.longitude != null)
    if (!points.length) return json({ ok: true, action: 'continue' })

    const current = points[points.length - 1]
    const { data: assigned } = await admin
      .from('field_area_assignments')
      .select('center_latitude,center_longitude,radius_m')
      .eq('user_id', user.id)
      .eq('active', true)

    const explicitAreas = (assigned || []).map((row: any) => ({
      latitude: row.center_latitude,
      longitude: row.center_longitude,
      radius_m: row.radius_m,
    }))

    const fallbackReferences: any[] = []
    for (const event of allEvents) {
      if (event.lead_latitude != null && event.lead_longitude != null) {
        fallbackReferences.push({ latitude: event.lead_latitude, longitude: event.lead_longitude })
      }
      if (event.event_type === 'address_reference' && event.latitude != null && event.longitude != null) {
        fallbackReferences.push({ latitude: event.latitude, longitude: event.longitude })
      }
    }

    function outsideAssignedArea(point: any) {
      if (explicitAreas.length) {
        return explicitAreas.every((area: any) => {
          const distance = distanceMeters(point, area)
          return distance == null || distance > area.radius_m
        })
      }
      if (fallbackReferences.length) {
        const distance = nearestDistance(point, fallbackReferences)
        return distance != null && distance > Number(rule.outside_area_distance_m)
      }
      return false
    }

    if (outsideAssignedArea(current)) {
      const breadcrumbs = allEvents.filter((event: any) =>
        event.event_type === 'breadcrumb' && event.latitude != null && event.longitude != null
      )
      let outsideSince = +new Date(current.event_time)
      for (let index = breadcrumbs.length - 1; index >= 0; index--) {
        if (outsideAssignedArea(breadcrumbs[index])) outsideSince = +new Date(breadcrumbs[index].event_time)
        else break
      }

      if (now - outsideSince >= Number(rule.outside_area_grace_ms)) {
        const payload = {
          reason: 'outside_assigned_area',
          outsideSince: new Date(outsideSince).toISOString(),
          outsideAreaGraceMs: Number(rule.outside_area_grace_ms),
          controlEngine: '1.2',
        }
        await admin.from('test_events').insert({
          session_id: sessionId,
          event_type: 'auto_stop',
          event_time: nowIso,
          latitude: current.latitude,
          longitude: current.longitude,
          accuracy_meters: current.accuracy_meters,
          payload,
        })
        await admin.from('test_sessions').update({ ended_at: nowIso }).eq('id', sessionId)
        return json({ ok: true, action: 'stop', reason: 'outside_assigned_area' })
      }
    }

    const dispositions = allEvents.filter((event: any) => event.event_type === 'disposition')
    const lastDisposition = dispositions[dispositions.length - 1]
    if (lastDisposition) {
      const dispositionTime = +new Date(lastDisposition.event_time)
      const laterArrival = allEvents.find((event: any) =>
        event.event_type === 'door_arrival' && +new Date(event.event_time) > dispositionTime
      )

      if (!laterArrival) {
        const afterDisposition = points.filter((event: any) => +new Date(event.event_time) >= dispositionTime)
        const latest = afterDisposition[afterDisposition.length - 1] || current
        let stationarySince = +new Date(latest.event_time)
        for (let index = afterDisposition.length - 1; index >= 0; index--) {
          const distance = distanceMeters(afterDisposition[index], latest)
          if (distance != null && distance <= Number(rule.stationary_radius_m)) {
            stationarySince = +new Date(afterDisposition[index].event_time)
          } else {
            break
          }
        }

        const idleLimit = lastDisposition.disposition === 'Sale'
          ? Number(rule.post_sale_idle_ms)
          : Number(rule.post_disposition_idle_ms)

        if (now - stationarySince >= idleLimit) {
          const payload = {
            reason: 'stationary_after_disposition',
            afterDisposition: lastDisposition.disposition,
            stationarySince: new Date(stationarySince).toISOString(),
            transitionElapsedMs: now - dispositionTime,
            controlEngine: '1.2',
          }
          await admin.from('test_events').insert({
            session_id: sessionId,
            event_type: 'auto_stop',
            event_time: nowIso,
            latitude: latest.latitude,
            longitude: latest.longitude,
            accuracy_meters: latest.accuracy_meters,
            payload,
          })
          await admin.from('test_sessions').update({ ended_at: nowIso }).eq('id', sessionId)
          return json({ ok: true, action: 'stop', reason: 'stationary_after_disposition' })
        }
      }
    }

    return json({ ok: true, action: 'continue' })
  } catch (error) {
    console.error(error)
    return json({ error: 'session_control_failed' }, 500)
  }
})
