/* 브라우저/헤드리스 Edge에서 실행되는 단위 테스트. app/tests.html 참고. */
(function () {
  const { CRITERIA, QUESTIONS, SAMPLE_ANSWERS, SAMPLE_DOCS } = SB_DATA;
  const E = SB_ENGINE;
  const Q = (id) => QUESTIONS.find((q) => q.qid === id);
  const own = (...ids) => ids.map((id) => ({ id, state: '보유', meta: {} }));
  const run = (id, a, opts) => E.evaluateQuestion(Q(id), a, opts);
  const cases = [];
  const t = (name, fn) => cases.push({ name, fn });
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };

  t('기업 A 기본 입력: 충족 6 · 미흡 2 · 확인 필요 2 (demo)', () => {
    const r = E.evaluateAll(QUESTIONS, SAMPLE_ANSWERS, { mode: 'demo' });
    eq(r.summary, { total: 10, ok: 6, bad: 2, check: 2 });
    for (const x of r.results) eq(x.status, E.EXPECTED_DEMO[x.qid], x.qid);
  });
  t('demo 판정 규칙 적용 사유 (Q04·Q05 범위 밖, Q06·Q07 메타 누락)', () => {
    const r = E.evaluateAll(QUESTIONS, SAMPLE_ANSWERS, { mode: 'demo' }).results;
    eq(['Q04', 'Q05', 'Q06', 'Q07'].map((q) => r.find((x) => x.qid === q).reason_code), ['VALUE_OUT_OF_RANGE', 'VALUE_OUT_OF_RANGE', 'META_MISSING', 'META_MISSING']);
  });
  t('strict: 원문 대조 전 10문항 모두 확인 필요 SRC_UNVERIFIED', () => {
    const r = E.evaluateAll(QUESTIONS, SAMPLE_ANSWERS, { mode: 'strict' });
    eq(r.summary, { total: 10, ok: 0, bad: 0, check: 10 });
    eq(new Set(r.results.map((x) => x.reason_code)).size, 1);
    eq(r.results[0].reason_code, 'SRC_UNVERIFIED');
  });
  t('strict: verified로 바꾸면 demo와 같은 결과', () => {
    const qs = QUESTIONS.map((q) => ({ ...q, source: { ...q.source, source_status: 'verified' } }));
    eq(E.evaluateAll(qs, SAMPLE_ANSWERS, { mode: 'strict' }).summary, { total: 10, ok: 6, bad: 2, check: 2 });
  });
  t('조항·쪽수 자리표시자는 모드와 무관하게 확인 필요 SRC_MISSING', () => {
    for (const mode of ['demo', 'strict']) {
      const q = { ...Q('Q04'), source: { ...Q('Q04').source, page: '[쪽수]' } };
      eq(E.evaluateQuestion(q, SAMPLE_ANSWERS.Q04, { mode }).reason_code, 'SRC_MISSING');
    }
    const q2 = { ...Q('Q04'), source: { ...Q('Q04').source, clause: '' } };
    eq(E.evaluateQuestion(q2, SAMPLE_ANSWERS.Q04, { mode: 'demo' }).status, '확인 필요');
  });
  t('경계값 B-01~B-04 (Q05)', () => {
    const f = (v) => run('Q05', { value: v, unit: 'HRC', evidence: own('E05') }).status;
    eq([f(38), f(42), f(37.9), f(42.1)], ['충족', '충족', '미흡', '미흡']);
  });
  t('경계값·환산 B-05~B-09', () => {
    const q1 = (v, u) => run('Q01', { value: v, unit: u, evidence: own('E01') }).status;
    eq([q1(24.95, 'mm'), q1(25.05, 'mm'), q1(25.051, 'mm'), q1(2.502, 'cm')], ['충족', '충족', '미흡', '충족']);
    const q4 = (v, u) => run('Q04', { value: v, unit: u, evidence: own('E04') }).status;
    eq([q4(4, 'day'), q4(96, 'min')], ['충족', '미흡']);
  });
  t('단위 오류·누락 U-01, U-03', () => {
    eq(run('Q01', { value: 25.02, unit: 'inch', evidence: own('E01') }).reason_code, 'UNIT_INVALID');
    eq(run('Q02', { value: 842, evidence: own('E02') }).reason_code, 'INPUT_MISSING');
  });
  t('입력 검증 U-02·N-01 (E-IN-02), 민감어 (E-IN-05)', () => {
    eq(E.validateAnswer(Q('Q05'), { value: 35, unit: 'MPa' }).errors, ['E-IN-02']);
    for (const v of [-5, NaN, 1e9]) eq(E.validateAnswer(Q('Q05'), { value: v, unit: 'HRC' }).errors, ['E-IN-02'], String(v));
    eq(E.validateAnswer(Q('Q05'), { value: 40, unit: 'HRC', note: '대외비 부대명' }).errors, ['E-IN-05']);
    eq(E.validateAnswer(Q('Q05'), { value: 40, unit: 'HRC' }).ok, true);
  });
  t('입력 모순은 미흡이 아니라 확인 필요 (규칙 4가 5보다 우선)', () => {
    eq(run('Q05', { value: 35, unit: 'HRC', condition: '합치', evidence: own('E05') }).reason_code, 'INPUT_CONFLICT');
  });
  t('증빙 미보유 → 미흡 EVIDENCE_MISSING / 증빙 id 누락 → 확인 필요', () => {
    eq(run('Q02', { value: 842, unit: 'MPa', evidence: [{ id: 'E02', state: '미보유', meta: {} }] }).reason_code, 'EVIDENCE_MISSING');
    eq(run('Q02', { value: 842, unit: 'MPa', evidence: [] }).status, '확인 필요');
  });
  t('증빙 메타를 채우면 Q06·Q07 충족', () => {
    eq(run('Q06', { evidence: [{ id: 'E06', state: '보유', meta: { lot_no: 'L-1' } }] }).status, '충족');
    eq(run('Q07', { evidence: [{ id: 'E07', state: '보유', meta: { valid_until: '2027-01-01' } }] }).status, '충족');
  });
  t('match 유형: 불일치 → 미흡 / 미확인 → 확인 필요', () => {
    eq(run('Q09', { condition: '불일치', evidence: own('E09', 'E09b') }).status, '미흡');
    eq(run('Q09', { condition: '미확인', evidence: own('E09', 'E09b') }).status, '확인 필요');
  });
  t('동일 입력 재실행 시 판정 동일(결정성)', () => {
    const a = E.evaluateAll(QUESTIONS, SAMPLE_ANSWERS).results.map((r) => [r.qid, r.status, r.reason_code]);
    const b = E.evaluateAll(QUESTIONS, SAMPLE_ANSWERS).results.map((r) => [r.qid, r.status, r.reason_code]);
    eq(a, b);
  });

  t('문서 검사: 파일 없음 → 12항목 모두 누락, 점수 0', () => {
    const r = E.evaluateDocuments(CRITERIA, []);
    eq([r.summary.score, r.summary.missing, r.fallback], [0, 12, 'NO_FILES']);
  });
  t('문서 검사: 샘플 문서 → 12/12 판정, 점수 0~100, 재현성', () => {
    const r1 = E.evaluateDocuments(CRITERIA, SAMPLE_DOCS.map((d) => ({ name: d.name, extractedText: d.text })));
    const r2 = E.evaluateDocuments(CRITERIA, SAMPLE_DOCS.map((d) => ({ name: d.name, extractedText: d.text })));
    eq(r1, r2);
    eq(r1.results.length, 12);
    eq(r1.summary.met + r1.summary.revision + r1.summary.missing, 12);
    if (r1.summary.score < 0 || r1.summary.score > 100) throw new Error('score range');
  });
  t('문서 검사: 모든 항목 충족이면 가중치 합과 무관하게 100점', () => {
    const all = CRITERIA.flatMap((c) => c.keywords).join(' ');
    eq(E.evaluateDocuments(CRITERIA, [{ name: 'x.txt', extractedText: all }]).summary.score, 100);
  });
  t('키워드 경계: year/clear 는 ear 로, review 는 rev 로 매칭되지 않음', () => {
    eq(E.kwMatch('this year is clear', 'ear'), false);
    eq(E.kwMatch('code review', 'rev'), false);
    eq(E.kwMatch('itar and ear rules', 'ear'), true);
    eq(E.kwMatch('치수 공차', '공차'), true);
  });

  t('금지 표현 필터: 검출 및 치환', () => {
    eq(E.containsForbidden('100% 합격 보장'), true);
    eq(E.containsForbidden('법적 승인 확정'), true);
    eq(E.containsForbidden('보완이 필요합니다'), false);
    eq(E.containsForbidden(E.sanitize('인증 통과 보장 및 법적 승인 확정')), false);
  });
  t('문서 초안: 12개 항목, 면책 문구 포함, 금지 표현 없음', () => {
    const ev = E.evaluateDocuments(CRITERIA, []);
    const d = E.buildDocDraft({ companyName: 'A', projectName: 'P', criteria: CRITERIA, evalResult: ev });
    eq(d.items.length, 12);
    eq(E.containsForbidden(JSON.stringify(d)), false);
    eq(d.disclaimer.includes('공식'), true);
  });

  const results = () => E.evaluateAll(QUESTIONS, SAMPLE_ANSWERS).results;
  const goodLlm = () => ({ items: results().map((r) => ({ qid: r.qid, summary: `${r.area} ${r.status}`, action: r.guide || '유지' })) });
  t('체크리스트 초안: LLM 미설정 → 템플릿, 체크리스트에 누락 증빙 포함', async () => {
    const d = await E.generateChecklistDraft(results());
    eq([d.generation_mode, d.fallback_reason], ['template', 'NO_LLM']);
    eq(d.checklist.some((c) => c.label.includes('96h 염수분무 성적서')), true);
    eq(d.disclaimer, E.DISCLAIMER);
  });
  t('LLM 정상 출력 → llm 모드', async () => {
    eq((await E.generateChecklistDraft(results(), { llm: async () => goodLlm() })).generation_mode, 'llm');
  });
  t('LLM 타임아웃 → 템플릿 폴백', async () => {
    const d = await E.generateChecklistDraft(results(), { llm: () => new Promise(() => {}), timeoutMs: 20, retries: 1 });
    eq([d.generation_mode, d.fallback_reason], ['template', 'LLM_TIMEOUT']);
  });
  t('LLM 오류 1회 후 재시도 성공', async () => {
    let n = 0;
    const d = await E.generateChecklistDraft(results(), { llm: async () => { if (n++ === 0) throw new Error('x'); return goodLlm(); }, retries: 1 });
    eq(d.generation_mode, 'llm');
  });
  t('LLM 출력에 금지 표현·입력에 없는 숫자 → 해당 항목만 템플릿 대체', async () => {
    const g = goodLlm();
    g.items[0].summary = '100% 합격 보장';
    g.items[1].action = '시험시간 777 h 로 맞추세요';
    const d = await E.generateChecklistDraft(results(), { llm: async () => g });
    eq(d.generation_mode, 'llm');
    eq(E.containsForbidden(JSON.stringify(d.items)), false);
    eq(JSON.stringify(d.items).includes('777'), false);
  });
  t('LLM qid 누락·JSON 깨짐 → 전체 템플릿', async () => {
    const g = goodLlm(); g.items.pop();
    eq((await E.generateChecklistDraft(results(), { llm: async () => g })).fallback_reason, 'INVALID_OUTPUT');
    eq((await E.generateChecklistDraft(results(), { llm: async () => '{not json' })).fallback_reason, 'INVALID_OUTPUT');
  });
  t('TXT 리포트에 면책 문구와 정책 모드 표기', () => {
    const q = E.evaluateAll(QUESTIONS, SAMPLE_ANSWERS);
    const txt = E.buildTextReport({ companyName: 'A', projectName: 'P', qEval: q, mode: 'demo', files: [] });
    eq([txt.includes('원문 대조 전 시연 판정'), txt.includes('공식 심사를 대체하지 않는'), txt.includes('Q04')], [true, true, true]);
  });

  window.__SB_TESTS = async function () {
    const out = [];
    for (const c of cases) {
      try { await c.fn(); out.push({ name: c.name, ok: true }); } catch (e) { out.push({ name: c.name, ok: false, err: e.message }); }
    }
    return out;
  };
})();
