/* 서버 통합 테스트: node test-server.js (임의 포트로 서버를 띄우고 실제 HTTP로 호출) */
'use strict';
const { server } = require('./server.js');
const D = require('./js/data.js');

const res = [];
const t = (n, ok, extra) => { res.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' ' + (extra || ''))); };

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const H = { 'X-Requested-With': 'spec-bridge', 'Content-Type': 'application/json' };
  const call = async (method, p, body, headers) => {
    const r = await fetch(base + p, { method, headers: { ...H, ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = text; }
    return { status: r.status, body: j, headers: r.headers };
  };
  try {
    const h = await call('GET', '/api/health'); t('health 200', h.status === 200 && h.body.ok);
    const idx = await fetch(base + '/'); const csp = idx.headers.get('content-security-policy') || '';
    t('index 제공 + CSP script-src self', idx.status === 200 && csp.includes("script-src 'self'") && !csp.includes('unsafe-inline\'; style') );
    t('server.js·.git 노출 차단', (await fetch(base + '/server.js')).status === 404 && (await fetch(base + '/.git/config')).status === 404 && (await fetch(base + '/../server.js')).status === 404);
    t('CSRF 헤더 없으면 403', (await fetch(base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
    t('다른 Origin이면 403', (await call('POST', '/api/sessions', { standard_id: 'KDS-0050-9000' }, { Origin: 'http://evil.example' })).status === 403);

    const std = await call('GET', '/api/standards'); t('A2 standards', std.status === 200 && std.body.standards.length === 1);
    const bad = await call('POST', '/api/sessions', { standard_id: 'X' }); t('없는 standard → 404', bad.status === 404);
    const badMode = await call('POST', '/api/sessions', { standard_id: 'KDS-0050-9000', mode: 'x' }); t('mode 검증 422', badMode.status === 422);

    const c = await call('POST', '/api/sessions', { standard_id: 'KDS-0050-9000', scenario: 'blank', mode: 'demo' });
    t('세션 생성 201 + 토큰', c.status === 201 && c.body.token && c.body.session_id);
    const sid = c.body.session_id, A = { Authorization: 'Bearer ' + c.body.token };
    t('토큰 없음 401', (await call('POST', `/api/sessions/${sid}/evaluate`)).status === 401);
    t('틀린 토큰 401', (await call('POST', `/api/sessions/${sid}/evaluate`, undefined, { Authorization: 'Bearer zzz' })).status === 401);

    for (const q of D.QUESTIONS) {
      const r = await call('PUT', `/api/sessions/${sid}/answers/${q.qid}`, D.SAMPLE_ANSWERS[q.qid], A);
      if (r.status !== 200) { t('샘플 답변 저장 ' + q.qid, false, JSON.stringify(r.body)); }
    }
    const badUnit = await call('PUT', `/api/sessions/${sid}/answers/Q05`, { value: 5, unit: 'inch', evidence: [] }, A);
    t('허용되지 않은 단위 → 422 E-IN-02', badUnit.status === 422 && badUnit.body.error.code === 'E-IN-02');
    const pii = await call('PUT', `/api/sessions/${sid}/answers/Q01`, { ...D.SAMPLE_ANSWERS.Q01, note: '주민번호 900101-1234567' }, A);
    t('민감 표현 → 422 E-IN-05', pii.status === 422 && pii.body.error.code === 'E-IN-05');
    t('평가 전 결과 조회 409', (await call('GET', `/api/sessions/${sid}/results/Q01`, undefined, A)).status === 409);

    const ev = await call('POST', `/api/sessions/${sid}/evaluate`, undefined, A);
    const sm = ev.body && ev.body.summary || {};
    t('기업 A 샘플 demo → 충족 6 / 미흡 2 / 확인 필요 2', ev.status === 200 && sm['충족'] === 6 && sm['미흡'] === 2 && sm['확인 필요'] === 2, JSON.stringify(sm));
    const dr = await call('POST', `/api/sessions/${sid}/draft`, { mode: 'template' }, A);
    t('draft(template) 200 + 면책', dr.status === 200 && dr.body.generation_mode && /공식/.test(dr.body.disclaimer));
    const ex = await fetch(base + `/api/sessions/${sid}/export?format=md`, { headers: A });
    t('export md', ex.status === 200 && (ex.headers.get('content-type') || '').startsWith('text/markdown'));
    t('DELETE 204', (await call('DELETE', `/api/sessions/${sid}`, undefined, A)).status === 204);
    t('삭제 후 재삭제 멱등 204', (await call('DELETE', `/api/sessions/${sid}`, undefined, A)).status === 204);
    t('삭제 후 조회 404', (await call('POST', `/api/sessions/${sid}/evaluate`, undefined, A)).status === 404);

    const c2 = await call('POST', '/api/sessions', { standard_id: 'KDS-0050-9000', scenario: 'company_a', mode: 'strict' });
    const ev2 = await call('POST', `/api/sessions/${c2.body.session_id}/evaluate`, undefined, { Authorization: 'Bearer ' + c2.body.token });
    t('strict: 원문 대조 전 문항은 전부 확인 필요(10)', ev2.status === 200 && ev2.body.summary['확인 필요'] === 10, JSON.stringify(ev2.body.summary));

    const big = await call('POST', '/api/sessions', { standard_id: 'KDS-0050-9000', pad: 'x'.repeat(300 * 1024) });
    t('본문 한도 초과 413', big.status === 413);
    const bj = await fetch(base + '/api/sessions', { method: 'POST', headers: H, body: '{bad' });
    t('잘못된 JSON 400', bj.status === 400);
  } catch (e) { t('예외 ' + e.message, false); }
  const pass = res.filter(Boolean).length;
  console.log(`\n결과: ${pass} 통과 / ${res.length - pass} 실패`);
  server.close(); process.exit(pass === res.length ? 0 : 1);
});
