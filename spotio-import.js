const SUPABASE_URL = 'https://athxxrfqxwlfnuvbqadp.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT'
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

const authMsg = document.getElementById('authMsg')
const uploadMsg = document.getElementById('uploadMsg')
const signInBtn = document.getElementById('signIn')
const uploadBtn = document.getElementById('upload')
const importType = document.getElementById('importType')
const fileInput = document.getElementById('file')

function setAuth(message, ok = false) {
  authMsg.textContent = message
  authMsg.style.color = ok ? '#166534' : '#991b1b'
}

async function verifyAdmin() {
  const { data: { user }, error: userError } = await sb.auth.getUser()
  if (userError || !user?.email) throw new Error(userError?.message || 'No signed-in McCoy user found.')
  const { data: access, error: accessError } = await sb
    .from('app_user_access')
    .select('role,active,display_name')
    .eq('email', user.email.toLowerCase())
    .maybeSingle()
  if (accessError) throw accessError
  if (!access?.active || access.role !== 'admin') throw new Error('Admin access required.')
  return { user, access }
}

async function restoreSession() {
  try {
    const { data: { session } } = await sb.auth.getSession()
    if (!session) return
    const { access } = await verifyAdmin()
    setAuth(`Already signed in as ${access.display_name || session.user.email}.`, true)
    signInBtn.textContent = 'SIGNED IN'
  } catch (_error) {
    await sb.auth.signOut().catch(() => {})
  }
}

signInBtn.addEventListener('click', async () => {
  try {
    signInBtn.disabled = true
    setAuth('Signing in…', true)
    const email = document.getElementById('email').value.trim().toLowerCase()
    const password = document.getElementById('password').value
    if (!email || !password) throw new Error('Enter your McCoy Admin email and password.')
    const { error } = await sb.auth.signInWithPassword({ email, password })
    if (error) throw error
    const { access } = await verifyAdmin()
    setAuth(`Admin signed in as ${access.display_name || email}.`, true)
    signInBtn.textContent = 'SIGNED IN'
  } catch (error) {
    await sb.auth.signOut().catch(() => {})
    setAuth(error?.message || String(error))
    signInBtn.textContent = 'SIGN IN'
  } finally {
    signInBtn.disabled = false
  }
})

function refreshImportHelp() {
  document.getElementById('spotioHelp').style.display = importType.value === 'spotio_json' ? 'block' : 'none'
  document.getElementById('csvHelp').style.display = importType.value === 'csv' ? 'block' : 'none'
}
importType.addEventListener('change', refreshImportHelp)

function detectImportType(file, text = '') {
  const name = String(file?.name || '').toLowerCase()
  const mime = String(file?.type || '').toLowerCase()
  if (name.endsWith('.csv') || mime.includes('csv')) return 'csv'
  if (name.endsWith('.json') || mime.includes('json')) return 'spotio_json'
  const sample = String(text || '').trimStart()
  if (sample.startsWith('{') || sample.startsWith('[')) return 'spotio_json'
  if (sample.includes(',') && (sample.includes('\n') || sample.includes('\r'))) return 'csv'
  return importType.value
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (!file) return
  const detected = detectImportType(file)
  if (detected !== importType.value) {
    importType.value = detected
    refreshImportHelp()
    uploadMsg.style.color = '#166534'
    uploadMsg.textContent = detected === 'csv'
      ? 'CSV detected automatically. Ready to upload.'
      : 'JSON capture detected automatically. Ready to upload.'
  }
})

function parseCSV(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index], next = text[index + 1]
    if (character === '"') {
      if (quoted && next === '"') {
        field += '"'
        index++
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index++
      row.push(field)
      field = ''
      if (row.some(value => value !== '')) rows.push(row)
      row = []
    } else field += character
  }
  row.push(field)
  if (row.some(value => value !== '')) rows.push(row)
  if (!rows.length) return { headers: [], rows: [] }
  const headers = rows[0].map((header, index) =>
    (header || `column_${index + 1}`).trim().replace(/^\uFEFF/, ''),
  )
  return {
    headers,
    rows: rows.slice(1).map(values =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
    ),
  }
}

async function callImport(session, body) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/spotio-import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || data.error || `Upload failed (${response.status})`)
  return data
}

function resultMessage(result, type, batchId) {
  if (type === 'csv') {
    return `CSV import ${result.complete ? 'COMPLETE' : 'INCOMPLETE'}. ${result.created || 0} created, ${result.updated || 0} updated, ${result.unchanged || 0} unchanged. Prior active leads were retained. Batch ${batchId}.`
  }
  return `SPOTIO additive import ${result.complete ? 'COMPLETE' : 'INCOMPLETE'}. ${result.created || 0} created, ${result.updated || 0} updated, ${result.unchanged || 0} unchanged, ${result.collisions || 0} collisions, ${result.quarantined || 0} quarantined. ${Number(result.active_leads_retained || 0).toLocaleString()} active leads retained. Batch ${batchId}.`
}

uploadBtn.addEventListener('click', async () => {
  try {
    uploadBtn.disabled = true
    const file = fileInput.files?.[0]
    if (!file) throw new Error('Choose a JSON or CSV file first.')

    uploadMsg.style.color = '#374151'
    uploadMsg.textContent = 'Checking Admin session…'
    await verifyAdmin()
    const { data: { session } } = await sb.auth.getSession()
    if (!session) throw new Error('Sign in as Admin first.')

    uploadMsg.textContent = 'Reading file…'
    const fileText = await file.text()
    const type = detectImportType(file, fileText)
    if (type !== importType.value) {
      importType.value = type
      refreshImportHelp()
    }

    let records = [], metadata = {}
    if (type === 'csv') {
      const parsed = parseCSV(fileText)
      if (!parsed.headers.length) throw new Error('CSV has no header row.')
      records = parsed.rows
      metadata = { headers: parsed.headers, source: 'csv' }
    } else {
      let raw
      try {
        raw = JSON.parse(fileText)
      } catch (_error) {
        if (detectImportType(file, fileText) === 'csv') {
          throw new Error('This is a CSV file. McCoy detected it as CSV; please try the upload again.')
        }
        throw new Error('The selected JSON file is not valid JSON.')
      }
      const captures = Array.isArray(raw?.captures) ? raw.captures : []
      const domLeads = Array.isArray(raw?.dom_leads) ? raw.dom_leads : []
      if (domLeads.length) {
        records = domLeads
        metadata = {
          source: 'spotio_dom_capture',
          capture_mode: 'dom_rows',
          source_origin: raw.source_origin || null,
          started_at: raw.started_at || null,
          finished_at: raw.finished_at || null,
          summary: raw.summary || null,
          api_capture_count: captures.length,
          dom_row_count: domLeads.length,
        }
      } else if (captures.length) {
        records = captures
        metadata = {
          source: 'spotio_browser_capture',
          capture_mode: 'api_responses',
          source_origin: raw.source_origin || null,
          started_at: raw.started_at || null,
          finished_at: raw.finished_at || null,
          summary: raw.summary || null,
        }
      } else if (Array.isArray(raw)) {
        records = raw
        metadata = { source: 'spotio_legacy_array', capture_mode: 'legacy' }
      }
      if (!records.length) throw new Error('No SPOTIO lead rows or captured responses found in this JSON file.')
    }

    const initialized = await callImport(session, {
      action: 'init',
      source_filename: file.name,
      source_type: type,
      captured_at: new Date().toISOString(),
      record_count: records.length,
      metadata,
    })
    const batchId = initialized.batch.id
    const isDom = type === 'spotio_json' && metadata.capture_mode === 'dom_rows'
    const chunkSize = type === 'csv' || isDom ? 250 : 20
    const totalChunks = Math.ceil(records.length / chunkSize)
    for (let index = 0; index < totalChunks; index++) {
      uploadMsg.textContent = `Uploading chunk ${index + 1} of ${totalChunks}…`
      await callImport(session, {
        action: 'chunk',
        batch_id: batchId,
        chunk_index: index,
        records: records.slice(index * chunkSize, (index + 1) * chunkSize),
      })
    }

    uploadMsg.textContent = 'Finalizing upload…'
    await callImport(session, { action: 'finalize', batch_id: batchId })
    uploadMsg.textContent = type === 'csv'
      ? 'Adding or updating CSV leads without removing prior leads…'
      : 'Adding or updating SPOTIO leads without removing prior leads…'
    const result = await callImport(session, { action: 'normalize', batch_id: batchId })

    uploadMsg.style.color = result.complete ? '#166534' : '#991b1b'
    uploadMsg.textContent = resultMessage(result, type, batchId)
  } catch (error) {
    uploadMsg.style.color = '#991b1b'
    uploadMsg.textContent = error?.message || String(error)
  } finally {
    uploadBtn.disabled = false
  }
})

refreshImportHelp()
restoreSession()
