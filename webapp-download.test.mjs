import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,stat} from 'node:fs/promises'
import test from 'node:test'

const read=path=>readFile(new URL(path,import.meta.url),'utf8')
const [iosGuide,downloadCenter,manifest,workflow,builder]=await Promise.all([
  read('./ios-install.html'),
  read('./webapp-download.html'),
  read('./manifest.webmanifest'),
  read('./.github/workflows/field-coach-webapp-download.yml'),
  read('./scripts/build-webapp-download.mjs')
])

test('iPhone and iPad guide describes the real Safari installation flow',()=>{
  assert.match(iosGuide,/Open this page in Safari/i)
  assert.match(iosGuide,/Add to Home Screen/i)
  assert.match(iosGuide,/Field Coach/)
  assert.match(iosGuide,/window\.navigator\.standalone/)
  assert.match(iosGuide,/display-mode: standalone/)
  assert.match(iosGuide,/serviceWorker\.register\('\/service-worker\.js'/)
  assert.doesNotMatch(iosGuide,/stripe|checkout|subscribe now|buy now|in-app purchase/i)
})

test('installation center supports browser install prompts without pretending iOS uses a file download',()=>{
  assert.match(downloadCenter,/beforeinstallprompt/)
  assert.match(downloadCenter,/event\.preventDefault\(\)/)
  assert.match(downloadCenter,/\/ios-install\.html/)
  assert.match(downloadCenter,/iPhone and iPad users must install from Safari/i)
  assert.match(downloadCenter,/no pricing, purchase, subscription, or checkout action/i)
})

test('PWA identity remains Field Coach and starts at the production root',()=>{
  const parsed=JSON.parse(manifest)
  assert.equal(parsed.name,'Field Coach')
  assert.equal(parsed.short_name,'Field Coach')
  assert.equal(parsed.start_url,'/')
  assert.ok(['standalone','fullscreen','minimal-ui'].includes(parsed.display))
})

test('download builder has an allowlist and excludes server, database, test, and secret material',()=>{
  assert.match(builder,/allowedRootExtensions/)
  assert.match(builder,/^.*excludedNamePatterns.*$/m)
  for(const forbidden of ["/^api$/i","/^supabase$/i","/^scripts$/i","/^docs$/i","/^\\.github$/i","/^\\.env/i"]){
    assert.ok(builder.includes(forbidden),`builder exclusion missing: ${forbidden}`)
  }
  assert.match(builder,/archive_role:'release_verification_and_controlled_hosting'/)
  assert.match(builder,/ios_install_method:'Safari Add to Home Screen from the production origin'/)
})

test('builder produces an integrity manifest containing required install assets',async()=>{
  execFileSync(process.execPath,['scripts/build-webapp-download.mjs'],{
    cwd:new URL('.',import.meta.url),
    env:{...process.env,FIELD_COACH_BUILD_SHA:'test-build',SOURCE_DATE_EPOCH:'1788249600'},
    stdio:'pipe'
  })
  const release=JSON.parse(await read('./dist/field-coach-web-app/field-coach-web-release.json'))
  const paths=new Set(release.files.map(file=>file.path))
  for(const required of [
    'index.html',
    'ios-install.html',
    'webapp-download.html',
    'manifest.webmanifest',
    'service-worker.js',
    'assets/logo.svg'
  ])assert.ok(paths.has(required),`${required} missing from release archive`)
  assert.equal(release.product,'Field Coach')
  assert.equal(release.legal_operator,'McCoy Platform LLC')
  assert.equal(release.build_sha,'test-build')
  assert.equal(release.production_origin,'https://mccoyplatform.com')
  assert.ok(release.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)))
  assert.ok(release.files.every(file=>!/(^|\/)(api|supabase|scripts|docs|\.github)(\/|$)/.test(file.path)))
  assert.ok((await stat(new URL('./dist/field-coach-web-app/README.txt',import.meta.url))).size>0)
})

test('GitHub Actions publishes a versioned ZIP, checksum, manifest, and README',()=>{
  assert.match(workflow,/name: Field Coach Web App Download/)
  assert.match(workflow,/zip -X -q -r/)
  assert.match(workflow,/sha256sum/)
  assert.match(workflow,/Field-Coach-Web-App-1\.0\.0-beta\.2/)
  assert.match(workflow,/field-coach-web-release\.json/)
  assert.match(workflow,/README\.txt/)
  assert.match(workflow,/actions\/upload-artifact@v4/)
})
