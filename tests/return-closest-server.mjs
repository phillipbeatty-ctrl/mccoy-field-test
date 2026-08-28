import http from 'node:http'
import {readFile} from 'node:fs/promises'
import {extname,join,normalize} from 'node:path'

const port=Number(process.argv[2]||4183)
const root=process.cwd()
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png'}

const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url||'/',`http://${req.headers.host||'127.0.0.1'}`).pathname)
    const relative=normalize(pathname.replace(/^\/+/,''))
    if(relative.startsWith('..'))throw new Error('invalid_path')
    const file=join(root,relative||'index.html')
    const body=await readFile(file)
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'})
    res.end(body)
  }catch(_){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found')}
})
server.listen(port,'127.0.0.1',()=>console.log(`preview server ${port}`))
