import assert from 'node:assert/strict'
import { PROJECT, sha256 } from './ziply-release-package.mjs'

// The default function-body response is an eszip bundle. Its CLI-unbundled
// representation is not the original source. Request original multipart files,
// as the official Supabase MCP does, and compare bytes without reformatting.
export async function verifyOriginalSource(response, metadata, expectedFiles) {
  assert.equal(response.ok, true, `Function source: HTTP ${response.status}`)
  assert.match(response.headers.get('content-type') || '', /^multipart\/form-data\s*;/i,
    'Function source API did not return original multipart files')
  const form = await response.formData()
  const expected = new Map(expectedFiles.map(file => [file.name, file.content]))
  assert.equal(expected.size, expectedFiles.length, 'Duplicate expected source paths')
  const seen = new Set(), hashes = []
  const prefix = `/tmp/user_fn_${PROJECT}_${metadata.id}_${metadata.version}/`
  for (const [, file] of form) {
    assert.ok(typeof file !== 'string' && typeof file.name === 'string' && typeof file.arrayBuffer === 'function',
      'Function source contains a non-file part')
    let name = file.name
    assert.equal(name.includes('\\'), false, 'Unexpected source path separator')
    if (name.startsWith('/')) {
      assert.ok(name.startsWith(prefix), 'Source path belongs to a different deployment')
      name = name.slice(prefix.length)
    }
    // Supabase supports relative and deployment-absolute paths across runtimes.
    if (name.startsWith('source/')) name = name.slice('source/'.length)
    if (name.startsWith('functions/')) name = name.slice('functions/'.length)
    assert.ok(expected.has(name), `Unexpected source file: ${name}`)
    assert.equal(seen.has(name), false, `Duplicate source file: ${name}`)
    seen.add(name)
    const hash = sha256(Buffer.from(await file.arrayBuffer()))
    assert.equal(hash, sha256(expected.get(name)), `${metadata.slug}/${name}: original source differs from reviewed package`)
    hashes.push({ name, sha256: hash })
  }
  assert.equal(seen.size, expected.size, 'Function source is missing reviewed files')
  return hashes.sort((a, b) => a.name.localeCompare(b.name))
}
