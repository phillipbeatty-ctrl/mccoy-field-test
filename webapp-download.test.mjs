import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,stat} from 'node:fs/promises'
import test from 'node:test'

const read=path=>readFile(new URL(path,import.meta.url),'utf8')
const [iosGuide,downloadCenter,manifestText,workflow,builder,installer]=await Promise.all([
  read('./install-ios.html'),
  read('./download.html'),
  read('./manifest.webmanifest'),
  read('./.github/workflows/field-coach-webapp-download.yml'),
  read('./scripts/build-webapp-download.mjs'),
  read('./webapp-installer.js')
])

test('iPhone and iPad guide describes the real Safari installation flow',()=>{
  assert.match(iosGuide,/Open this page in Safari/i)
  assert.match(iosGuide,/Add to Home Screen/i)
  assert.match(iosGuide,/Field Coach/)
  assert.match(iosGuide,/apple-touch-icon-180\.png/)
  assert.doesNotMatch(iosGuide,/stripe|checkout|subscribe now|buy now|in-app purchase/i)
})

test('installation center separates native Android download from browser web-app installation',()=>{
  assert.match(downloadCenter,/\/install-ios\.html/)
  assert.match(downloadCenter,/Field-Coach-Android-1\.0\.0-beta\.3-debug\.apk/)
  assert.match(downloadCenter,/DOWNLOAD ANDROID BETA \(\.APK\)/)
  assert.match(downloadCenter,/INSTALL FIELD COACH WEB APP/)
  assert.match(installer,/beforeinstallprompt/)
  assert.match(installer,/event\.preventDefault\(\)/)
  assert.match(downloadCenter,/no pricing, purchase, subscription, or checkout action/i)
})

test('PWA identity uses separate any and maskable PNG icons',()=>{
  const manifest=JSON.parse(manifestText)
  const icons=new Map(manifest.icons.map(icon=>[icon.src,icon]))
  assert.equal(manifest.name,'Field Coach')
  assert.equal(manifest.short_name,'Field Coach')
  assert.equal(manifest.start_url,'/?source=installed-app')
  assert.ok(['standalone','fullscreen','minimal-ui'].includes(manifest.display))
  assert.equal(icons.get('/assets/icon-192.png')?.purpose,'any')
  assert.equal(icons.get('/assets/icon-512.png')?.purpose,'any')
  assert.equal(icons.get('/assets/icon-maskable-512.png')?.purpose,'maskable')
  assert.doesNotMatch(manifestText,/purpose"\s*:\s*"any maskable"/)
})

test('download builder has an allowlist and excludes server, database, test, APK, and secret material',()=>{
  assert.match(builder,/allowedRootExtensions/)
  assert.match(builder,/^.*excludedNamePatterns.*$/m)
  for(const forbidden of ["/^api$/i","/^supabase$/i","/^scripts$/i","/^docs$/i","/^downloads$/i","/^\\.github$/i","/^\\.env/i"]){
    assert.ok(builder.includes(forbidden),`builder exclusion missing: ${forbidden}`)
  }
  assert.match(builder,/archive_role:'release_verification_and_controlled_hosting'/)
  assert.match(builder,/ios_install_method:'Safari Add to Home Screen from the production origin'/)
  assert.match(builder,/android_install_method:/)
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
    'install-ios.html',
    'download.html',
    'manifest.webmanifest',
    'service-worker.js',
    'assets/logo.svg',
    'assets/icon-192.png',
    'assets/icon-512.png',
    'assets/icon-maskable-512.png',
    'assets/apple-touch-icon-180.png'
  ])assert.ok(paths.has(required),`${required} missing from release archive`)
  assert.equal(release.product,'Field Coach')
  assert.equal(release.legal_operator,'McCoy Platform LLC')
  assert.equal(release.version,'1.0.0-beta.3')
  assert.equal(release.build_sha,'test-build')
  assert.equal(release.production_origin,'https://mccoyplatform.com')
  assert.match(release.android_beta_url,/Field-Coach-Android-1\.0\.0-beta\.3-debug\.apk$/)
  assert.ok(release.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)))
  assert.ok(release.files.every(file=>!/(^|\/)(api|supabase|scripts|docs|downloads|\.github)(\/|$)/.test(file.path)))
  assert.ok((await stat(new URL('./dist/field-coach-web-app/README.txt',import.meta.url))).size>0)
})

test('GitHub Actions publishes a versioned ZIP, checksum, manifest, and README',()=>{
  assert.match(workflow,/name: Field Coach Web App Download/)
  assert.match(workflow,/generate-field-coach-icons\.py/)
  assert.match(workflow,/zip -X -q -r/)
  assert.match(workflow,/sha256sum/)
  assert.match(workflow,/Field-Coach-Web-App-1\.0\.0-beta\.3/)
  assert.match(workflow,/field-coach-web-release\.json/)
  assert.match(workflow,/README\.txt/)
  assert.match(workflow,/actions\/upload-artifact@v4/)
})
