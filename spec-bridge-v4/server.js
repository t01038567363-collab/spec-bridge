'use strict';
/* Spec Bridge 서버 — 외부 의존성 없음(Node.js 18+).
   실행: node server.js   →  http://127.0.0.1:3000
   환경변수: PORT, HOST, DATA_DIR, ALLOW_REGISTER(false 이면 가입 차단), SECURE_COOKIE(true 이면 Secure 쿠키; HTTPS 뒤에서 사용) */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

global.window = globalThis; // criteria.js 가 window 에 등록하는 방식이라 서버에서도 로드 가능하게 함
require('./criteria.js');
const engine = require('./engine.js');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const ALLOW_REGISTER = process.env.ALLOW_REGISTER !== 'false';
const SECURE_COOKIE = process.env.SECURE_COOKIE === 'true';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 30 * 1024 * 1024;
const MAX_FILES_PER_KIND = 20;
const MAX_TEXT = 2000000;
const MAX_INSPECTIONS_PER_USER = 50;
const ROOT = __dirname;

const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/engine.js': 'engine.js', '/criteria.js': 'criteria.js',
  '/styles.css': 'styles.css', '/tests.html': 'tests.html',
  '/vendor/pdf.min.js': 'vendor/pdf.min.js', '/vendor/pdf.worker.min.js': 'vendor/pdf.worker.min.js',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/* ---------- JSON 파일 DB (원자적 저장) ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { users: [], sessions: [], inspections: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') { console.error('db.json 을 읽을 수 없습니다:', e.message); process.exit(1); } }
let writing = Promise.resolve();
function persist() {
  writing = writing.then(async () => {
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(db), { mode: 0o600 });
    await fs.promises.rename(tmp, DB_FILE);
  }).catch((e) => console.error('DB 저장 실패:', e.message));
  return writing;
}
const newId = () => crypto.randomBytes(12).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* ---------- 비밀번호 (scrypt + 개별 salt) ---------- */
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
async function hashPassword(pw) { const salt = crypto.randomBytes(16); return { salt: salt.toString('hex'), hash: (await scrypt(pw, salt)).toString('hex') }; }
async function verifyPassword(pw, user) {
  const calc = await scrypt(pw, Buffer.from(user.salt, 'hex'));
  const want = Buffer.from(user.hash, 'hex');
  return calc.length === want.length && crypto.timingSafeEqual(calc, want);
}
const DUMMY = { salt: crypto.randomBytes(16).toString('hex'), hash: crypto.randomBytes(64).toString('hex') };

/* ---------- 간단한 속도 제한 (IP별) ---------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 600000)) hits.delete(k); }, 60000).unref();

/* ---------- 공통 유틸 ---------- */
const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
};
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { ...SEC_HEADERS, 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
const fail = (res, code, message) => send(res, code, { error: message });
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('요청이 너무 큽니다.'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (_) { reject(Object.assign(new Error('JSON 형식이 올바르지 않습니다.'), { code: 400 })); } });
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const cookieAttrs = (maxAge) => `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;
function currentUser(req) {
  const tok = parseCookies(req).sb_session;
  if (!tok) return null;
  const h = sha(tok);
  const s = db.sessions.find((x) => x.h === h);
  if (!s || s.exp < Date.now()) return null;
  return db.users.find((u) => u.id === s.userId) || null;
}
async function startSession(res, user) {
  const tok = crypto.randomBytes(32).toString('hex');
  db.sessions = db.sessions.filter((s) => s.exp > Date.now());
  db.sessions.push({ h: sha(tok), userId: user.id, exp: Date.now() + SESSION_TTL_MS });
  await persist();
  return { 'Set-Cookie': `sb_session=${tok}; ${cookieAttrs(SESSION_TTL_MS / 1000)}` };
}
const clientIp = (req) => req.socket.remoteAddress || 'unknown';
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ---------- API ---------- */
function cleanFiles(list, label) {
  if (!Array.isArray(list) || !list.length) throw Object.assign(new Error(`${label}가 없습니다.`), { code: 400 });
  if (list.length > MAX_FILES_PER_KIND) throw Object.assign(new Error(`${label}는 최대 ${MAX_FILES_PER_KIND}개까지 가능합니다.`), { code: 400 });
  const out = list.map((f) => ({ name: str(f && f.name, 200) || '이름없음', text: typeof (f && f.text) === 'string' ? f.text.slice(0, MAX_TEXT) : '' })).filter((f) => f.text.trim());
  if (!out.length) throw Object.assign(new Error(`${label}에 읽을 수 있는 텍스트가 없습니다.`), { code: 400 });
  return out;
}

async function handleApi(req, res, url) {
  const m = req.method;
  const p = url.pathname;
  if (m !== 'GET' && m !== 'HEAD') {
    if (req.headers['x-requested-with'] !== 'spec-bridge') return fail(res, 403, '허용되지 않은 요청입니다.');
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return fail(res, 403, '출처가 일치하지 않습니다.');
  }

  if (p === '/api/health' && m === 'GET') return send(res, 200, { ok: true });

  if (p === '/api/register' && m === 'POST') {
    if (!ALLOW_REGISTER) return fail(res, 403, '가입이 비활성화되어 있습니다.');
    if (limited(`reg:${clientIp(req)}`, 5, 600000)) return fail(res, 429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    const b = await readBody(req);
    const username = str(b.username, 30).toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';
    if (!/^[a-z0-9_]{3,30}$/.test(username)) return fail(res, 400, '아이디는 영문 소문자·숫자·_ 3~30자여야 합니다.');
    if (password.length < 8 || password.length > 128) return fail(res, 400, '비밀번호는 8~128자여야 합니다.');
    if (db.users.some((u) => u.username === username)) return fail(res, 409, '이미 사용 중인 아이디입니다.');
    const user = { id: newId(), username, ...(await hashPassword(password)), createdAt: new Date().toISOString() };
    db.users.push(user);
    return send(res, 201, { username }, await startSession(res, user));
  }

  if (p === '/api/login' && m === 'POST') {
    if (limited(`login:${clientIp(req)}`, 10, 600000)) return fail(res, 429, '로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요.');
    const b = await readBody(req);
    const username = str(b.username, 30).toLowerCase();
    const user = db.users.find((u) => u.username === username);
    const ok = await verifyPassword(typeof b.password === 'string' ? b.password.slice(0, 128) : '', user || DUMMY);
    if (!user || !ok) return fail(res, 401, '아이디 또는 비밀번호가 올바르지 않습니다.');
    return send(res, 200, { username }, await startSession(res, user));
  }

  if (p === '/api/logout' && m === 'POST') {
    const tok = parseCookies(req).sb_session;
    if (tok) { const h = sha(tok); db.sessions = db.sessions.filter((s) => s.h !== h); await persist(); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sb_session=; ${cookieAttrs(0)}` });
  }

  const user = currentUser(req);
  if (p === '/api/me' && m === 'GET') return user ? send(res, 200, { username: user.username }) : fail(res, 401, '로그인이 필요합니다.');
  if (!user) return fail(res, 401, '로그인이 필요합니다.');

  if (p === '/api/inspect' && m === 'POST') {
    const b = await readBody(req);
    const role = b.role;
    if (!Object.prototype.hasOwnProperty.call(CRITERIA_SETS, role)) return fail(res, 400, '구분(role) 값이 올바르지 않습니다.');
    const threshold = Number(b.threshold);
    if (!(threshold >= 0.2 && threshold <= 0.8)) return fail(res, 400, '연관도 기준은 0.20~0.80 이어야 합니다.');
    const specFiles = cleanFiles(b.specFiles, '국방 규격서');
    const compFiles = cleanFiles(b.compFiles, '기업 자료');
    const crits = CRITERIA_SETS[role];
    const t0 = Date.now();
    const result = { ...engine.compare({ specFiles, compFiles, crits, threshold }), role, crits };
    if (!result.reqs.length) return fail(res, 422, '규격서에서 요구사항 문장(~해야 한다 / shall / 수치 기준)을 찾지 못했습니다.');
    const sensitive = [...specFiles, ...compFiles].map((f) => ({ file: f.name, hits: engine.detectSensitive(f.text) })).filter((x) => x.hits.length);
    const rec = {
      id: newId(), userId: user.id, createdAt: new Date().toISOString(), role, org: str(b.org, 40), project: str(b.project, 100), notes: str(b.notes, 5000),
      summary: { reqs: result.reqs.length, met: result.reqs.filter((r) => r.status === 'MET').length, rev: result.reqs.filter((r) => r.status === 'REVISION').length, miss: result.reqs.filter((r) => r.status === 'MISSING').length },
      result,
    };
    db.inspections.push(rec);
    const mine = db.inspections.filter((i) => i.userId === user.id);
    if (mine.length > MAX_INSPECTIONS_PER_USER) { const drop = new Set(mine.slice(0, mine.length - MAX_INSPECTIONS_PER_USER).map((i) => i.id)); db.inspections = db.inspections.filter((i) => !drop.has(i.id)); }
    await persist();
    return send(res, 200, { id: rec.id, createdAt: rec.createdAt, result, sensitive, elapsedMs: Date.now() - t0 });
  }

  if (p === '/api/inspections' && m === 'GET') {
    return send(res, 200, db.inspections.filter((i) => i.userId === user.id).reverse().map(({ id, createdAt, role, org, project, summary }) => ({ id, createdAt, role, org, project, summary })));
  }
  const mm = p.match(/^\/api\/inspections\/([0-9a-f]{24})$/);
  if (mm) {
    const rec = db.inspections.find((i) => i.id === mm[1] && i.userId === user.id);
    if (!rec) return fail(res, 404, '검사 기록을 찾을 수 없습니다.');
    if (m === 'GET') return send(res, 200, { id: rec.id, createdAt: rec.createdAt, org: rec.org, project: rec.project, notes: rec.notes, result: rec.result });
    if (m === 'DELETE') { db.inspections = db.inspections.filter((i) => i !== rec); await persist(); return send(res, 200, { ok: true }); }
  }
  return fail(res, 404, '존재하지 않는 API 입니다.');
}

/* ---------- 서버 ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '허용되지 않는 메서드입니다.');
    const rel = Object.prototype.hasOwnProperty.call(STATIC, url.pathname) ? STATIC[url.pathname] : null;
    if (!rel) return send(res, 404, 'Not found');
    const buf = await fs.promises.readFile(path.join(ROOT, rel));
    const ext = path.extname(rel);
    res.writeHead(200, { ...SEC_HEADERS, ...(rel === 'tests.html' ? { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" } : {}), 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  } catch (e) {
    if (e.code && e.code >= 400 && e.code < 600 && Number.isInteger(e.code)) return fail(res, e.code, e.message);
    console.error(e);
    if (!res.headersSent) fail(res, 500, '서버 오류가 발생했습니다.');
  }
});
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Spec Bridge 서버: http://${HOST}:${PORT}  (데이터: ${DATA_DIR})`));
}
module.exports = { server, engine };
