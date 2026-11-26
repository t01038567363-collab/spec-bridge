'use strict';
/* 서버 통합 테스트: node test.js  (임시 DATA_DIR·임의 포트 사용, 외부 의존성 없음) */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
const { server } = require('./server.js');

let pass = 0, failN = 0, base, cookie = '';
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log(`PASS ${name}`); } else { failN++; console.log(`FAIL ${name} ${extra}`); } };

async function call(method, url, body, opts = {}) {
  const headers = { ...(opts.noCsrf ? {} : { 'X-Requested-With': 'spec-bridge' }), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(opts.cookie === undefined ? (cookie ? { Cookie: cookie } : {}) : (opts.cookie ? { Cookie: opts.cookie } : {})) };
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc && opts.keep !== false) cookie = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch (_) { /* non-json */ }
  return { status: res.status, data, headers: res.headers };
}

const SPEC = 'MTBF는 10,000시간 이상이어야 한다.\n진동 시험은 MIL-STD-810에 따라 수행하여야 한다.\n전략물자 수출통제 해당 여부를 판정하여야 한다.';
const COMP = 'MTBF 예측값은 9,000시간이다.\n진동 시험은 MIL-STD-810G 기준으로 수행하였다.\n커넥터 핀 할당을 정의하였다.';

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  let r = await call('GET', '/api/me');
  check('미로그인 /api/me → 401', r.status === 401);
  r = await call('POST', '/api/inspect', { role: 'defense' });
  check('미로그인 /api/inspect → 401', r.status === 401);
  r = await call('POST', '/api/register', { username: 'tester', password: 'x' }, { noCsrf: true });
  check('CSRF 헤더 없는 POST → 403', r.status === 403);
  r = await call('POST', '/api/register', { username: 'tester', password: 'short' });
  check('짧은 비밀번호 가입 거부 → 400', r.status === 400);
  r = await call('POST', '/api/register', { username: 'tester', password: 'correct-horse-9' });
  check('가입 성공 + 세션 쿠키(HttpOnly)', r.status === 201 && /HttpOnly/.test(r.headers.get('set-cookie')) && /SameSite=Strict/.test(r.headers.get('set-cookie')));
  const db = fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf8');
  check('DB에 평문 비밀번호 없음', !db.includes('correct-horse-9') && db.includes('"salt"'));
  r = await call('POST', '/api/register', { username: 'tester', password: 'correct-horse-9' }, { cookie: '' });
  check('중복 아이디 → 409', r.status === 409);
  r = await call('GET', '/api/me');
  check('/api/me → 로그인 사용자', r.status === 200 && r.data.username === 'tester');

  const body = { role: 'defense', threshold: 0.4, org: '시험기관', project: 'T-1', notes: '', specFiles: [{ name: 's.txt', text: SPEC }], compFiles: [{ name: 'c.txt', text: COMP }] };
  r = await call('POST', '/api/inspect', { ...body, role: 'hacker' });
  check('잘못된 role → 400', r.status === 400);
  r = await call('POST', '/api/inspect', { ...body, threshold: 5 });
  check('범위 밖 threshold → 400', r.status === 400);
  r = await call('POST', '/api/inspect', { ...body, specFiles: [{ name: 's', text: '   ' }] });
  check('빈 규격 → 400', r.status === 400);
  r = await call('POST', '/api/inspect', body);
  const st = r.data && r.data.result ? r.data.result.reqs.map((x) => x.status) : [];
  check('검사 성공: MTBF 미달=REVISION, 표준 일치=MET, 연관 없음=MISSING', r.status === 200 && st.join() === 'REVISION,MET,MISSING', st.join());
  const id = r.data && r.data.id;

  r = await call('GET', '/api/inspections');
  check('기록 목록 1건', r.status === 200 && r.data.length === 1 && r.data[0].summary.reqs === 3);
  r = await call('GET', `/api/inspections/${id}`);
  check('기록 상세 조회', r.status === 200 && r.data.result.reqs.length === 3);

  const keep = cookie; cookie = '';
  r = await call('POST', '/api/register', { username: 'other', password: 'another-pass-1' });
  r = await call('GET', `/api/inspections/${id}`);
  check('다른 사용자의 기록 접근 → 404', r.status === 404);
  r = await call('GET', '/api/inspections');
  check('다른 사용자 목록은 비어 있음', r.data.length === 0);
  cookie = keep;

  r = await call('POST', '/api/login', { username: 'tester', password: 'wrong-password' }, { cookie: '', keep: false });
  check('잘못된 비밀번호 → 401', r.status === 401);
  r = await call('GET', '/server.js', null, { cookie: '' });
  check('server.js 정적 노출 차단 → 404', r.status === 404);
  r = await call('GET', '/data/db.json', null, { cookie: '' });
  check('db.json 정적 노출 차단 → 404', r.status === 404);
  const page = await fetch(`${base}/`);
  check('CSP·nosniff 헤더', /default-src 'self'/.test(page.headers.get('content-security-policy')) && page.headers.get('x-content-type-options') === 'nosniff');

  r = await call('DELETE', `/api/inspections/${id}`);
  check('기록 삭제', r.status === 200);
  r = await call('POST', '/api/logout');
  r = await call('GET', '/api/me');
  check('로그아웃 후 /api/me → 401', r.status === 401);

  let bad = 0;
  for (let i = 0; i < 12; i++) { const x = await call('POST', '/api/login', { username: 'nobody', password: 'x' }, { cookie: '', keep: false }); if (x.status === 429) bad++; }
  check('로그인 시도 제한 → 429', bad > 0);

  console.log(`\n결과: ${pass} 통과 / ${failN} 실패`);
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
