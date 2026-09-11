import assert from 'node:assert/strict'
import test from 'node:test'
import { PROJECT, RECOVERY_CAPTURE, loadPackage, sha256 } from './scripts/ziply-release-package.mjs'
import { verifyOriginalSource } from './scripts/ziply-source-verification.mjs'

const release = await loadPackage()

function multipart(files, { transform = name => name, fields = [] } = {}) {
  const chunks = []
  for (const file of files) {
    chunks.push(Buffer.from(`--ziply-source-test\r\nContent-Disposition: form-data; name="file"; filename="${transform(file.name)}"\r\nContent-Type: application/octet-stream\r\n\r\n`))
    chunks.push(Buffer.from(file.content), Buffer.from('\r\n'))
  }
  for (const [name, value] of fields) chunks.push(Buffer.from(`--ziply-source-test\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  chunks.push(Buffer.from('--ziply-source-test--\r\n'))
  return new Response(Buffer.concat(chunks), { headers: { 'Content-Type': 'multipart/form-data; boundary=ziply-source-test' } })
}

for (const fn of release.functions) {
  test(`${fn.slug}: original source bytes verify with Supabase relative and deployment-absolute paths`, async () => {
    const actual = fn.slug === RECOVERY_CAPTURE.slug ? RECOVERY_CAPTURE : fn
    const deployment = `/tmp/user_fn_${PROJECT}_${actual.id}_${actual.version}/`
    for (const prefix of ['', 'functions/', 'source/functions/', deployment, `${deployment}source/`, `${deployment}source/functions/`]) {
      const result = await verifyOriginalSource(multipart(fn.files, { transform: name => prefix + name }), actual, fn.files)
      assert.deepEqual(result, fn.files.map(file => ({ name: file.name, sha256: sha256(file.content) })).sort((a, b) => a.name.localeCompare(b.name)))
    }
  })
}

test('UTF-8, BOM, CRLF and final newlines are verified as original bytes, never reformatted', async () => {
  const files = [{ name: 'provider-sale-capture/index.ts', content: '\uFEFF// café\r\nexport const value = 1;\n\n' }]
  await verifyOriginalSource(multipart(files), RECOVERY_CAPTURE, files)
  for (const content of [files[0].content.trim(), files[0].content.replaceAll('\r\n', '\n'), files[0].content.replace('1', '2')]) {
    await assert.rejects(verifyOriginalSource(multipart([{ ...files[0], content }]), RECOVERY_CAPTURE, files), /original source differs/)
  }
})

test('API non-file fields coexist with all reviewed source files without changing verified hashes', async () => {
  for (const fn of release.functions) {
    const metadata = fn.slug === RECOVERY_CAPTURE.slug ? RECOVERY_CAPTURE : fn
    const fields = [['metadata', JSON.stringify({ entrypoint_path: fn.entrypoint, verify_jwt: true })], ['info', 'API envelope'], ['metadata', 'another envelope field']]
    const expected = await verifyOriginalSource(multipart(fn.files), metadata, fn.files)
    assert.deepEqual(await verifyOriginalSource(multipart(fn.files, { fields }), metadata, fn.files), expected)
  }
})

test('a non-file field cannot supply a missing source file or hide modified or additional files', async () => {
  const files = release.functions[0].files
  const fields = files.map(file => [file.name, file.content])
  for (const response of [
    multipart([], { fields }),
    multipart(files.slice(1), { fields }),
    multipart(files.map((file, i) => i ? file : { ...file, content: file.content + '\n' }), { fields }),
    multipart([...files, { name: '_shared/unreviewed.mjs', content: 'unexpected' }], { fields }),
  ]) await assert.rejects(verifyOriginalSource(response, RECOVERY_CAPTURE, files))
})

test('original bytes reject any missing, added, duplicated, traversing or wrong-deployment file', async () => {
  const files = release.functions[0].files
  const responses = [
    multipart(files.slice(1)),
    multipart([...files, { name: '_shared/unreviewed.mjs', content: 'unexpected' }]),
    multipart([...files, files[0]]),
    multipart([...files, { ...files[0], name: `functions/${files[0].name}` }]),
    ...['../', 'functions/../', '/tmp/user_fn_other_project_id_14/source/functions/', 'functions\\'].map(prefix => multipart(files, { transform: name => prefix + name })),
  ]
  for (const response of responses) await assert.rejects(verifyOriginalSource(response, RECOVERY_CAPTURE, files))
})

test('auth errors, eszip bodies, JSON responses and malformed multipart data fail closed', async () => {
  for (const response of [
    new Response('unauthorized', { status: 401 }), new Response('forbidden', { status: 403 }),
    new Response('bundled representation', { headers: { 'Content-Type': 'application/octet-stream' } }),
    Response.json({ files: [] }),
    new Response('invalid', { headers: { 'Content-Type': 'multipart/form-data; boundary=missing' } }),
  ]) await assert.rejects(verifyOriginalSource(response, RECOVERY_CAPTURE, release.functions[0].files))
})
