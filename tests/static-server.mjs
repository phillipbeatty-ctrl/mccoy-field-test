import {createServer} from 'node:http'
import {createReadStream,statSync} from 'node:fs'
import {extname,join,normalize} from 'node:path'

const root=process.cwd()
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}
const server=createServer((request,response)=>{
  try{
    const url=new URL(request.url||'/', 'http://127.0.0.1')
    const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html'
    const file=normalize(join(root,relative))
    if(!file.startsWith(root)){response.writeHead(403).end('Forbidden');return}
    const stat=statSync(file)
    if(!stat.isFile())throw new Error('not_file')
    response.writeHead(200,{'Content-Type':types[extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'})
    createReadStream(file).pipe(response)
  }catch(_){response.writeHead(404,{'Content-Type':'text/plain'}).end('Not found')}
})
server.listen(4173,'127.0.0.1',()=>console.log('preview server ready on 4173'))
