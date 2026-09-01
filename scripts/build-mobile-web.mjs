#!/usr/bin/env node
import {copyFile, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'mobile-web');
const nativeBridgeSource=path.join(root,'mobile','mobile-native-bridge.js');
const nativeBridgeName='mobile-native-bridge.js';
const nativeBridgeTag='<script src="mobile-native-bridge.js?v=1.0.0-beta.4"></script>';

const allowedExtensions=new Set(['.html','.js','.css','.svg','.png','.jpg','.jpeg','.webp','.ico','.webmanifest']);
const excludedFiles=new Set([
  'capacitor.config.ts',
  'package.json',
  'package-lock.json',
  'vercel.json'
]);
const excludedDirectories=new Set([
  '.git','.github','.vercel','android','api','docs','downloads','ios','mobile','mobile-web','node_modules','scripts','supabase'
]);
const excludedNamePatterns=[/\.test\.[^.]+$/i,/^test-/i,/\.config\.[^.]+$/i];

function shouldCopyFile(relativePath){
  const basename=path.basename(relativePath);
  if(excludedFiles.has(basename))return false;
  if(excludedNamePatterns.some(pattern=>pattern.test(basename)))return false;
  return allowedExtensions.has(path.extname(basename).toLowerCase());
}

async function copyRuntimeTree(sourceDirectory,relativeDirectory=''){
  const entries=await readdir(sourceDirectory,{withFileTypes:true});
  for(const entry of entries){
    const relativePath=path.join(relativeDirectory,entry.name);
    const sourcePath=path.join(sourceDirectory,entry.name);
    if(entry.isDirectory()){
      if(relativeDirectory===''&&excludedDirectories.has(entry.name))continue;
      await copyRuntimeTree(sourcePath,relativePath);
      continue;
    }
    if(!entry.isFile()||!shouldCopyFile(relativePath))continue;
    const destinationPath=path.join(output,relativePath);
    await mkdir(path.dirname(destinationPath),{recursive:true});
    await copyFile(sourcePath,destinationPath);
  }
}

async function injectNativeBridge(){
  const stack=[output];
  while(stack.length){
    const current=stack.pop();
    const entries=await readdir(current,{withFileTypes:true});
    for(const entry of entries){
      const filePath=path.join(current,entry.name);
      if(entry.isDirectory()){
        stack.push(filePath);
        continue;
      }
      if(!entry.isFile()||path.extname(entry.name).toLowerCase()!=='.html')continue;
      let html=await readFile(filePath,'utf8');
      if(html.includes(nativeBridgeTag))continue;
      if(/<\/body>/i.test(html))html=html.replace(/<\/body>/i,`  ${nativeBridgeTag}\n</body>`);
      else html+=`\n${nativeBridgeTag}\n`;
      await writeFile(filePath,html);
    }
  }
}

await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await copyRuntimeTree(root);
await copyFile(nativeBridgeSource,path.join(output,nativeBridgeName));
await injectNativeBridge();

const indexPath=path.join(output,'index.html');
const index=await readFile(indexPath,'utf8').catch(()=>null);
if(!index)throw new Error('Native build failed: mobile-web/index.html was not produced.');

const offlinePath=path.join(output,'offline.html');
const offline=await readFile(offlinePath,'utf8').catch(()=>null);
if(!offline){
  await writeFile(offlinePath,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Field Coach Offline</title></head><body><main><h1>Field Coach is offline</h1><p>Reconnect to load live leads, assignments, sessions, and sales.</p></main></body></html>');
}

const produced=[];
const collect=async(directory,relativeDirectory='')=>{
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const relativePath=path.join(relativeDirectory,entry.name);
    if(entry.isDirectory())await collect(path.join(directory,entry.name),relativePath);
    else if(entry.isFile())produced.push(relativePath.replaceAll(path.sep,'/'));
  }
};
await collect(output);
produced.sort();

await writeFile(path.join(output,'mobile-build.json'),JSON.stringify({
  app_id:'com.mccoyplatform.app',
  app_name:'Field Coach',
  version:'1.0.0-beta.4',
  source_commit:process.env.GITHUB_SHA||null,
  bundled_web_assets:true,
  production_origin:'https://www.mccoyplatform.com',
  files:produced.length
},null,2));

console.log(`Prepared ${produced.length} bundled Field Coach runtime files in ${path.relative(root,output)}.`);
