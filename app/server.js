/* Spec Bridge 서버 — 외부 패키지 없는 Node 18+ 서버. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = nodeCrypto.webcrypto;
const SB_API = require('./js/api.js');
const LLM = require('./js/llm.js');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const BODY_LIMIT = 256 * 1024;
const SESSION_RATE = { max: 30, windowMs: 10 * 60 * 1000 };
let llm;
if (process.env.LLM_ENDPOINT && process.env.LLM_MODEL) llm = LLM.create({ endpoint: process.env.LLM_ENDPOINT, model: process.env.LLM_MODEL, apiKey: process.env.LLM_API_KEY });
const api = SB_API.create({ mode: 'demo', llm, strictHash: true });
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/tests.html': 'tests.html', '/e2e.html': 'e2e.html', '/openapi.yaml': 'openapi.yaml',
  '/js/data.js': 'js/data.js', '/js/checklists.js': 'js/checklists.js', '/js/engine.js': 'js/engine.js', '/js/app.js': 'js/app.js', '/js/tests.js': 'js/tests.js',
  '/js/api.js': 'js/api.js', '/js/llm.js': 'js/llm.js', '/vendor/pdf.min.js': 'vendor/pdf.min.js', '/vendor/pdf.worker.min.js': 'vendor/pdf.worker.min.js',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const CSP_TEST = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
function secHeaders(extra) { return { 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'no-referrer', 'Cache-Control':'no-store', ...extra }; }
const hits = new Map();
function limited(ip) { const now=Date.now(), arr=(hits.get(ip)||[]).filter(t=>now-t<SESSION_RATE.windowMs); arr.push(now); hits.set(ip,arr); return arr.length>SESSION_RATE.max; }
setInterval(()=>{const now=Date.now();for(const [ip,arr] of hits)if(!arr.some(t=>now-t<SESSION_RATE.windowMs))hits.delete(ip);for(const [id,s] of api._sessions)if(now>s.expires)api._sessions.delete(id);},60000).unref();
function readBody(req) { return new Promise((resolve,reject)=>{let size=0;const chunks=[];req.on('data',c=>{size+=c.length;if(size<=BODY_LIMIT)chunks.push(c);});req.on('end',()=>size>BODY_LIMIT?reject(Object.assign(new Error('too large'),{code:413})):resolve(Buffer.concat(chunks).toString('utf8')));req.on('error',reject);}); }
function sendJson(res,status,body,extra){res.writeHead(status,secHeaders({'Content-Type':'application/json; charset=utf-8',...extra}));res.end(body==null?'':JSON.stringify(body));}
async function handleApi(req,res,url){
  const apiPath=url.pathname.slice('/api'.length)||'/';
  if(apiPath==='/health')return sendJson(res,200,{ok:true,llm:!!llm});
  if(req.method!=='GET'&&req.headers['x-requested-with']!=='spec-bridge')return sendJson(res,403,{error:{code:'E-CSRF-01',message:'X-Requested-With 헤더가 필요합니다.'}});
  const origin=req.headers.origin;
  if(origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)return sendJson(res,403,{error:{code:'E-CSRF-01',message:'허용되지 않은 Origin입니다.'}});
  if(req.method==='POST'&&apiPath==='/sessions'&&limited(req.socket.remoteAddress||'?'))return sendJson(res,429,{error:{code:'E-RATE-01',message:'세션 생성 한도를 초과했습니다.'}});
  let raw='';if(req.method==='POST'||req.method==='PUT'){try{raw=await readBody(req);}catch(e){return sendJson(res,e.code===413?413:400,{error:{code:'E-REQ-01',message:'요청 본문이 너무 크거나 잘못되었습니다.'}});}}
  const headers={};for(const k of ['authorization','idempotency-key'])if(req.headers[k])headers[k]=req.headers[k];
  const r=await api.handle(req.method,apiPath+url.search,{headers,body:raw===''?undefined:raw});
  if(r.contentType){res.writeHead(r.status,secHeaders({'Content-Type':r.contentType+'; charset=utf-8'}));return res.end(String(r.body));}
  console.log(`${new Date().toISOString()} ${req.method} ${url.pathname.replace(/\/s_[a-z0-9]+/,'/s_*')} ${r.status}${r.body&&r.body.error?' '+r.body.error.code:''}`);
  return sendJson(res,r.status,r.body);
}
function serveStatic(req,res,url){const rel=STATIC[url.pathname];if(!rel||(req.method!=='GET'&&req.method!=='HEAD')){res.writeHead(404,secHeaders({'Content-Type':'text/plain; charset=utf-8'}));return res.end('Not found');}fs.readFile(path.join(__dirname,rel),(err,buf)=>{if(err){res.writeHead(404,secHeaders());return res.end('Not found');}const csp=rel==='tests.html'||rel==='e2e.html'?CSP_TEST:CSP;res.writeHead(200,secHeaders({'Content-Type':MIME[path.extname(rel)]||'application/octet-stream','Content-Security-Policy':csp}));res.end(req.method==='HEAD'?undefined:buf);});}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/api'||url.pathname.startsWith('/api/'))return await handleApi(req,res,url);return serveStatic(req,res,url);}catch(e){console.error('E-SYS-01',e&&e.message);if(!res.headersSent)sendJson(res,500,{error:{code:'E-SYS-01',message:'서버 오류가 발생했습니다.'}});}});
if(require.main===module)server.listen(PORT,HOST,()=>console.log(`Spec Bridge 서버: http://${HOST}:${PORT} (LLM: ${llm?'연결됨':'미설정'})`));
module.exports={server,api};
