import {cp,mkdir,readdir,rm,readFile,writeFile} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {build} from 'esbuild';

const root=process.cwd();
const out=join(root,'mobile','www');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
const allowed=new Set(['.html','.js','.css','.json','.svg','.png','.jpg','.jpeg','.webp','.ico']);
for(const entry of await readdir(root,{withFileTypes:true})){
  if(entry.isFile()&&allowed.has(extname(entry.name).toLowerCase()))await cp(join(root,entry.name),join(out,entry.name));
}
for(const directory of ['assets','icons']){try{await cp(join(root,directory),join(out,directory),{recursive:true});}catch{}}
await cp(join(root,'mobile','native-auth-unfreeze.js'),join(out,'app-native-auth-unfreeze.js'));
await build({entryPoints:[join(root,'mobile','native-entry.mjs')],outfile:join(out,'app-native-location.js'),bundle:true,format:'iife',platform:'browser',target:['es2020']});
const indexPath=join(out,'index.html');
let html=await readFile(indexPath,'utf8');
html=html.replace('</body>','  <script src="app-ipad-layout.js"></script>\n  <script src="app-native-location.js"></script>\n  <script src="app-native-auth-unfreeze.js?v=2026082701"></script>\n</body>');
await writeFile(indexPath,html);
console.log('Prepared Field Coach mobile/www with iPad layout, native location, and native auth recovery.');
