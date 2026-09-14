import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'

const STAGING_BUCKET = 'provider-sale-staged-photos'
const SALE_BUCKET = 'sale-order-photos'
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp'])
const openCaptureStatuses = new Set(['dashboard_opened', 'details_required'])
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders, 'Cache-Control': 'no-store' }
})
const text = (value: unknown) => String(value ?? '').trim()
const ext = (mime: string) => mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'

serveWithOrganizationAccess('sales_tracking', async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !user?.email) return json({ error: 'unauthorized' }, 401)

    const email = user.email.toLowerCase()
    const { data: access, error: accessError } = await admin
      .from('app_user_access')
      .select('active,organization_id')
      .eq('email', email)
      .eq('active', true)
      .maybeSingle()
    if (accessError) throw accessError
    if (!access?.organization_id) return json({ error: 'forbidden' }, 403)
    const organizationId = access.organization_id
    const body = await request.json().catch(() => ({}))
    const action = text(body.action || 'list')

    async function purgeExpired() {
      const { data: expired, error } = await admin
        .from('provider_sale_capture_photos')
        .select('id,storage_path')
        .eq('organization_id', organizationId)
        .eq('uploaded_by', user.id)
        .in('status', ['uploading', 'staged', 'failed'])
        .lt('expires_at', new Date().toISOString())
      if (error) throw error
      const paths = (expired || []).map(row => row.storage_path).filter(Boolean)
      if (paths.length) {
        const { error: removeError } = await admin.storage.from(STAGING_BUCKET).remove(paths)
        if (removeError) throw removeError
      }
      if ((expired || []).length) {
        const { error: deleteError } = await admin
          .from('provider_sale_capture_photos')
          .delete()
          .in('id', (expired || []).map(row => row.id))
          .eq('uploaded_by', user.id)
        if (deleteError) throw deleteError
      }
    }

    async function captureFor(id: string, allowClosed = false) {
      const { data, error } = await admin
        .from('provider_sale_captures')
        .select('id,client_request_id,rep_user_id,rep_email,provider,status,service_address')
        .eq('id', id)
        .eq('rep_user_id', user.id)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('provider_capture_not_found_for_signed_in_user')
      if (!allowClosed && !openCaptureStatuses.has(data.status)) throw new Error('provider_capture_not_open')
      return data
    }

    async function stagedPhotoFor(id: string) {
      const { data, error } = await admin
        .from('provider_sale_capture_photos')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .eq('uploaded_by', user.id)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('staged_photo_not_found')
      return data
    }

    async function saleFor(id: string, captureId: string) {
      const { data, error } = await admin
        .from('sales_records')
        .select('id,organization_id,rep_user_id,provider_capture_id')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .eq('rep_user_id', user.id)
        .eq('provider_capture_id', captureId)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error('completed_sale_not_found_for_provider_capture')
      return data
    }

    async function objectExists(path: string) {
      const parts = path.split('/').filter(Boolean)
      const name = parts.pop()
      const folder = parts.join('/')
      if (!name) return false
      const { data, error } = await admin.storage.from(STAGING_BUCKET).list(folder, { limit: 20, search: name })
      if (error) throw error
      return (data || []).some(item => item.name === name)
    }

    await purgeExpired()

    if (action === 'create_upload') {
      const captureId = text(body.capture_id)
      const mime = text(body.mime_type).toLowerCase()
      const size = Number(body.file_size_bytes || 0)
      const originalFileName = text(body.original_file_name).slice(0, 160) || null
      await captureFor(captureId)
      if (!allowed.has(mime)) return json({ error: 'jpeg_png_or_webp_required' }, 400)
      if (!Number.isFinite(size) || size <= 0 || size > 10485760) return json({ error: 'photo_must_be_10mb_or_less' }, 400)

      const { count, error: countError } = await admin
        .from('provider_sale_capture_photos')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('uploaded_by', user.id)
        .eq('provider_capture_id', captureId)
        .in('status', ['uploading', 'staged', 'attaching', 'failed'])
      if (countError) throw countError
      if ((count || 0) >= 3) return json({ error: 'three_photo_limit_reached' }, 409)

      const id = crypto.randomUUID()
      const path = `${organizationId}/${user.id}/${captureId}/${id}.${ext(mime)}`
      const { error: insertError } = await admin.from('provider_sale_capture_photos').insert({
        id,
        provider_capture_id: captureId,
        organization_id: organizationId,
        uploaded_by: user.id,
        uploaded_by_email: email,
        original_file_name: originalFileName,
        storage_path: path,
        mime_type: mime,
        file_size_bytes: size,
        status: 'uploading'
      })
      if (insertError) throw insertError

      const { data: signed, error: signedError } = await admin.storage.from(STAGING_BUCKET).createSignedUploadUrl(path)
      if (signedError) {
        await admin.from('provider_sale_capture_photos').delete().eq('id', id).eq('uploaded_by', user.id)
        throw signedError
      }
      return json({ ok: true, photo_id: id, path, token: signed.token, remaining_capacity: Math.max(0, 2 - (count || 0)) })
    }

    if (action === 'abort_upload') {
      const photo = await stagedPhotoFor(text(body.photo_id))
      if (photo.status !== 'uploading') return json({ ok: true, unchanged: true })
      const { error: removeError } = await admin.storage.from(STAGING_BUCKET).remove([photo.storage_path])
      if (removeError) console.error('provider-sale-photo-stage abort object cleanup', removeError)
      const { error: deleteError } = await admin
        .from('provider_sale_capture_photos')
        .delete()
        .eq('id', photo.id)
        .eq('uploaded_by', user.id)
      if (deleteError) throw deleteError
      return json({ ok: true, deleted: true })
    }

    if (action === 'commit_upload') {
      const photo = await stagedPhotoFor(text(body.photo_id))
      await captureFor(photo.provider_capture_id)
      if (photo.status === 'staged') return json({ ok: true, row: photo, duplicate: true })
      if (photo.status !== 'uploading') return json({ error: 'photo_is_not_waiting_for_upload' }, 409)
      if (!await objectExists(photo.storage_path)) return json({ error: 'uploaded_photo_not_found' }, 409)
      const { data, error } = await admin
        .from('provider_sale_capture_photos')
        .update({ status: 'staged', updated_at: new Date().toISOString(), attachment_error: null })
        .eq('id', photo.id)
        .eq('uploaded_by', user.id)
        .select('id,provider_capture_id,status,mime_type,file_size_bytes,created_at,expires_at')
        .single()
      if (error) throw error
      return json({ ok: true, row: data })
    }

    if (action === 'list') {
      const capture = await captureFor(text(body.capture_id), true)
      const { data, error } = await admin
        .from('provider_sale_capture_photos')
        .select('id,provider_capture_id,status,mime_type,file_size_bytes,attachment_error,expires_at,created_at')
        .eq('organization_id', organizationId)
        .eq('uploaded_by', user.id)
        .eq('provider_capture_id', capture.id)
        .in('status', ['uploading', 'staged', 'attaching', 'failed'])
        .order('created_at', { ascending: true })
      if (error) throw error
      return json({ ok: true, capture, rows: data || [], maximum_photos: 3 })
    }

    if (action === 'discard') {
      const capture = await captureFor(text(body.capture_id), true)
      const { data: rows, error } = await admin
        .from('provider_sale_capture_photos')
        .select('id,storage_path,status')
        .eq('organization_id', organizationId)
        .eq('uploaded_by', user.id)
        .eq('provider_capture_id', capture.id)
        .neq('status', 'attached')
      if (error) throw error
      const paths = (rows || []).map(row => row.storage_path).filter(Boolean)
      if (paths.length) {
        const { error: removeError } = await admin.storage.from(STAGING_BUCKET).remove(paths)
        if (removeError) throw removeError
      }
      if ((rows || []).length) {
        const { error: deleteError } = await admin
          .from('provider_sale_capture_photos')
          .delete()
          .in('id', (rows || []).map(row => row.id))
          .eq('uploaded_by', user.id)
        if (deleteError) throw deleteError
      }
      return json({ ok: true, deleted: (rows || []).length })
    }

    if (action === 'finalize') {
      const captureId = text(body.capture_id)
      const saleId = text(body.sale_id)
      const capture = await captureFor(captureId, true)
      await saleFor(saleId, capture.id)

      const { data: rows, error } = await admin
        .from('provider_sale_capture_photos')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('uploaded_by', user.id)
        .eq('provider_capture_id', capture.id)
        .order('created_at', { ascending: true })
      if (error) throw error

      const salePhotoIds: string[] = []
      const failures: string[] = []
      for (const row of rows || []) {
        if (row.status === 'attached' && row.attached_sale_id === saleId && row.attached_sale_photo_id) {
          salePhotoIds.push(row.attached_sale_photo_id)
          continue
        }
        if (!['staged', 'attaching', 'failed'].includes(row.status)) continue

        const salePhotoId = row.attached_sale_photo_id || crypto.randomUUID()
        const targetPath = `${organizationId}/${saleId}/${salePhotoId}.${ext(row.mime_type)}`
        await admin.from('provider_sale_capture_photos').update({
          status: 'attaching',
          attached_sale_id: saleId,
          attached_sale_photo_id: salePhotoId,
          attachment_error: null,
          updated_at: new Date().toISOString()
        }).eq('id', row.id).eq('uploaded_by', user.id)

        try {
          const { data: file, error: downloadError } = await admin.storage.from(STAGING_BUCKET).download(row.storage_path)
          if (downloadError || !file) throw downloadError || new Error('staged_photo_download_failed')
          const { error: uploadError } = await admin.storage.from(SALE_BUCKET).upload(targetPath, file, {
            contentType: row.mime_type,
            upsert: true,
            cacheControl: '0'
          })
          if (uploadError) throw uploadError

          const { error: photoInsertError } = await admin.from('sale_order_photos').upsert({
            id: salePhotoId,
            sale_id: saleId,
            organization_id: organizationId,
            uploaded_by: user.id,
            uploaded_by_email: email,
            storage_path: targetPath,
            mime_type: row.mime_type,
            file_size_bytes: row.file_size_bytes,
            extraction_status: 'uploaded',
            extracted_fields: {}
          }, { onConflict: 'id' })
          if (photoInsertError) throw photoInsertError

          const now = new Date().toISOString()
          const { error: attachedError } = await admin.from('provider_sale_capture_photos').update({
            status: 'attached',
            attached_sale_id: saleId,
            attached_sale_photo_id: salePhotoId,
            attached_at: now,
            updated_at: now,
            attachment_error: null
          }).eq('id', row.id).eq('uploaded_by', user.id)
          if (attachedError) throw attachedError

          const { error: removeError } = await admin.storage.from(STAGING_BUCKET).remove([row.storage_path])
          if (removeError) console.error('provider-sale-photo-stage staged object cleanup', removeError)
          salePhotoIds.push(salePhotoId)
        } catch (attachError) {
          const detail = text((attachError as Error)?.message || attachError).slice(0, 300)
          failures.push(`${row.id}:${detail}`)
          await admin.from('provider_sale_capture_photos').update({
            status: 'failed',
            attached_sale_id: saleId,
            attached_sale_photo_id: salePhotoId,
            attachment_error: detail,
            updated_at: new Date().toISOString()
          }).eq('id', row.id).eq('uploaded_by', user.id)
        }
      }

      if (failures.length) return json({ error: 'photo_finalize_incomplete', detail: failures.join('; '), sale_photo_ids: salePhotoIds }, 409)
      return json({ ok: true, sale_id: saleId, provider_capture_id: capture.id, sale_photo_ids: salePhotoIds })
    }

    return json({ error: 'unsupported_action' }, 400)
  } catch (error) {
    console.error('provider-sale-photo-stage', error)
    return json({
      error: text((error as Error)?.message || error).replace(/\s+/g, '_').slice(0, 180)
    }, 400)
  }
})
