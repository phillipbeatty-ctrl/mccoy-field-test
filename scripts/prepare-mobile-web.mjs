import {cp,mkdir,readdir,rm} from 'node:fs/promises';
import {extname,join} from 'node:path';

const root=process.cwd();
const out=join(root,'mobile','www');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
const allowed=new Set(['.html','.js','.css','.json','.svg','.png','.jpg','.jpeg','.webp','.ico']);
for(const entry of await readdir(root,{withFileTypes:true})){
  if(entry.isFile()&&allowed.has(extname(entry.name).toLowerCase())){
    await cp(join(root,entry.name),join(out,entry.name));
  }
}
for(const directory of ['assets','icons']){
  try{await cp(join(root,directory),join(out,directory),{recursive:true});}catch{}
}
console.log('Prepared mobile/www from production static assets.');
