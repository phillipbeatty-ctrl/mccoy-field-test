const TARGET = 'https://athxxrfqxwlfnuvbqadp.supabase.co/functions/v1/spotio-direct-force-load'

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const url = new URL(TARGET)
    for (const [key, value] of Object.entries(req.query || {})) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item))
      } else if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
    const response = await fetch(url, { headers: { 'Cache-Control': 'no-store' } })
    const text = await response.text()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
    return res.status(response.status).send(text)
  } catch (error) {
    return res.status(500).json({ error: 'relay_failed', detail: String(error?.message || error) })
  }
}
