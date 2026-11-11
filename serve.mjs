import http from 'node:http';
import {readFile} from 'node:fs/promises';
const routes=new Set(['/canvas-bilingual.meta.js','/canvas-bilingual.user.js']);
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1:8765').pathname;
  if(!['GET','HEAD'].includes(req.method) || !routes.has(path)){
    res.writeHead(404);res.end('Not found');return;
  }
  try {
    const data=await readFile(new URL('./dist'+path,import.meta.url));
    res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch {res.writeHead(503);res.end('Build the userscript first.');}
});
server.on('error',e=>{console.error(`Local update service: ${e.code}`);process.exitCode=1;});
server.listen(8765,'127.0.0.1',()=>console.log('Install/update: http://127.0.0.1:8765/canvas-bilingual.user.js\nKeep this terminal open for update checks. Ctrl+C stops the server.'));
