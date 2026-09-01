#!/usr/bin/env node
import {createHash} from 'node:crypto'
import {cp,mkdir,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const distRoot=path.join(root,'dist')
const output=path.join(distRoot,'field-coach-web-app')
const packageJson=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'))
const version=packageJson.version
const productionOrigin='https://mccoyplatform.com'
const buildSha=process.env.FIELD_COACH_BUILD_SHA||process.env.GITHUB_SHA||'local'
const generatedAt=process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH)*1000).toISOString()
  : new Date().toISOString()

const allowedRootExtensions=new Set(['.css','.html','.js','.webmanifest'])
const allowedRootNames=new Set(['VERSION'])
const excludedNamePatterns=[/\.test\./i,/^node_modules$/i,/^dist$/i,/^api$/i,/^supabase$/i,/^scripts$/i,/^docs$/i,/^\.github$/i,/^\.env/i]

await rm(output,{recursive:true,force:true})
await mkdir(output,{recursive:true})

function excluded(name){
  return excludedNamePatterns.some(pattern=>pattern.test(name))
}

const rootEntries=await readdir(root,{withFileTypes:true})
const copied=[]
for(const entry of rootEntries){
  if(excluded(entry.name))continue
  if(entry.isFile()){
    const extension=path.extname(entry.name).toLowerCase()
    if(!allowedRootNames.has(entry.name)&&!allowedRootExtensions.has(extension))continue
    await cp(path.join(root,entry.name),path.join(output,entry.name))
    copied.push(entry.name)
  }
}

for(const directory of ['assets']){
  const source=path.join(root,directory)
  try{
    if((await stat(source)).isDirectory()){
      await cp(source,path.join(output,directory),{recursive:true})
      copied.push(`${directory}/`)
    }
  }catch(error){
    if(error?.code!=='ENOENT')throw error
  }
}

const files=[]
async function collect(directory,prefix=''){
  const entries=await readdir(directory,{withFileTypes:true})
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    const absolute=path.join(directory,entry.name)
    const relative=path.posix.join(prefix,entry.name)
    if(entry.isDirectory()){
      await collect(absolute,relative)
      continue
    }
    const content=await readFile(absolute)
    files.push({
      path:relative,
      bytes:content.byteLength,
      sha256:createHash('sha256').update(content).digest('hex')
    })
  }
}
await collect(output)

const release={
  schema_version:1,
  product:'Field Coach',
  legal_operator:'McCoy Platform LLC',
  version,
  build_sha:buildSha,
  generated_at:generatedAt,
  production_origin:productionOrigin,
  launch_url:`${productionOrigin}/`,
  installation_center_url:`${productionOrigin}/webapp-download.html`,
  ios_install_guide_url:`${productionOrigin}/ios-install.html`,
  distribution_model:'organization_managed_web_app',
  archive_role:'release_verification_and_controlled_hosting',
  ios_install_method:'Safari Add to Home Screen from the production origin',
  file_count:files.length,
  files
}

await writeFile(path.join(output,'field-coach-web-release.json'),`${JSON.stringify(release,null,2)}\n`)
await writeFile(path.join(output,'README.txt'),[
  `Field Coach Web App ${version}`,
  '',
  'McCoy Platform LLC',
  '',
  `Production: ${productionOrigin}/`,
  `Installation center: ${productionOrigin}/webapp-download.html`,
  `iPhone/iPad guide: ${productionOrigin}/ios-install.html`,
  '',
  'This archive is generated for release verification and controlled hosting.',
  'Do not unzip this archive on an iPhone or iPad to install the app.',
  'Install the iOS web app from Safari so it retains the secure production origin,',
  'service worker, organization access checks, and live Supabase connections.',
  ''
].join('\n'))

console.log(JSON.stringify({
  output,
  version,
  build_sha:buildSha,
  copied,
  file_count:files.length
},null,2))
