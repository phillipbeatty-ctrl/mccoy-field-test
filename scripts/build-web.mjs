#!/usr/bin/env node
import {copyFile,mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {backendEnvironment,replaceDeploymentReferences,PRODUCTION_PROJECT_REF,PRODUCTION_PUBLIC_KEY} from './backend-environment.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicDirectories=new Set(['assets','downloads','config']);
const textExtensions=new Set(['.html','.js','.css','.svg','.webmanifest','.json','.txt']);
const binaryExtensions=new Set(['.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.apk','.zip']);
const clientEntries=['app-part1.js','confirm-email.js','pending-access.js','spotio-import.js'];

export async function buildWeb({sourceRoot=root,env=process.env}={}){
  const output=path.join(sourceRoot,'dist','web');
  const staging=path.join(sourceRoot,'dist','.web-building');
  // Remove a previously successful build first: a failed configuration must
  // never leave an older production bundle available for deployment.
  await rm(output,{recursive:true,force:true});
  await rm(staging,{recursive:true,force:true});
  const backend=backendEnvironment(env);
  const fingerprint=createHash('sha256').update(JSON.stringify(backend)).digest('hex').slice(0,12);
  const files=[];
  const copyTree=async(directory,relative='')=>{
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const source=path.join(directory,entry.name),relativePath=path.join(relative,entry.name);
      if(entry.isDirectory()){
        if(!relative&&!publicDirectories.has(entry.name))continue;
        await copyTree(source,relativePath);continue;
      }
      if(!entry.isFile())continue;
      const ext=path.extname(entry.name).toLowerCase();
      if(!textExtensions.has(ext)&&!binaryExtensions.has(ext))continue;
      if(/(^test-|\.test\.|\.config\.)/i.test(entry.name))continue;
      if(!relative&&['package.json','package-lock.json','mobile-release-doctor.json'].includes(entry.name))continue;
      // Published native binaries and downloadable production web bundles are
      // separate releases and cannot be offered as isolated Preview builds.
      if(backend.environment!=='production'&&['.apk','.zip'].includes(ext))continue;
      const target=path.join(staging,relativePath);
      await mkdir(path.dirname(target),{recursive:true});
      if(textExtensions.has(ext)){
        let contents=replaceDeploymentReferences(await readFile(source,'utf8'),backend);
        if(relativePath==='service-worker.js'&&backend.environment!=='production'){
          const pattern=/const VERSION=(['"])([^'"\r\n]+)\1;/;
          if(!pattern.test(contents))throw new Error('service_worker_version_contract_changed');
          contents=contents.replace(pattern,(_match,quote,version)=>`const VERSION=${quote}${version}-preview-${fingerprint}${quote};`);
        }
        if(backend.environment!=='production'&&(contents.includes(PRODUCTION_PROJECT_REF)||contents.includes(PRODUCTION_PUBLIC_KEY))){
          throw new Error(`production_reference_in_preview:${relativePath}`);
        }
        await writeFile(target,contents);
      }else await copyFile(source,target);
      files.push(relativePath.replaceAll(path.sep,'/'));
    }
  };
  try{
    await copyTree(sourceRoot);
    for(const entry of clientEntries){
      const contents=await readFile(path.join(staging,entry),'utf8');
      if(!contents.includes(backend.url)||!contents.includes(backend.publicKey))throw new Error(`backend_entry_not_configured:${entry}`);
    }
    for(const required of ['index.html','service-worker.js','confirm-email.html','pending-access.html','spotio-import.html']){
      if(!files.includes(required))throw new Error(`missing_runtime_file:${required}`);
    }
    const metadata={environment:backend.environment,project_ref:backend.projectRef,
      backend_url:backend.url,app_origin:backend.appOrigin,config_fingerprint:fingerprint,
      source_commit:env.VERCEL_GIT_COMMIT_SHA||env.GITHUB_SHA||null,files:files.length};
    await writeFile(path.join(staging,'deployment-environment.json'),JSON.stringify(metadata,null,2)+'\n');
    await rename(staging,output);
    return {output,...metadata};
  }catch(error){
    await rm(staging,{recursive:true,force:true});throw error;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await buildWeb(),null,2));}
  catch(error){console.error(`Web build refused: ${error.message}`);process.exitCode=1;}
}
