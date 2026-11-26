/* TRD v3 §3 REST 계약(A1~A10)을 브라우저 안에서 그대로 구현한 API 계층.
 * 서버 없이 동작하며, 같은 경로·상태코드·오류 코드를 사용하므로 나중에 FastAPI로 교체할 때 UI·테스트를 그대로 쓸 수 있다.
 * 토큰은 해시(비암호학적 cyrb53)만 보관한다. 시연용이며 실제 서버에서는 SHA-256 이상을 사용해야 한다. */
(function () {
  const D = typeof SB_DATA !== 'undefined' ? SB_DATA : require('./data.js');
  const E = typeof SB_ENGINE !== 'undefined' ? SB_ENGINE : require('./engine.js');
  const TTL_MS = 24 * 3600 * 1000, RATE_MAX = 5, RATE_WIN = 10 * 60 * 1000, DRAFT_TIMEOUT = 25000;
  const STANDARD = { standard_id: 'KDS-0050-9000', name: 'KDS 0050-9000 (국방품질경영체제 인증기준, 조항·쪽수 원문 대조 전)', questions: 10 };
  const NOTICES = [
    { id: 'N1', text: '공식 인증·심사가 아닌 사전 점검 보조입니다.' },
    { id: 'N2', text: '가상 데이터만 입력하세요. 기밀·개인정보 입력 금지.' },
    { id: 'N3', text: '입력은 이 브라우저 메모리에만 있으며 세션 삭제·만료(24시간) 시 사라집니다.' },
    { id: 'N4', text: '로그에는 문항 ID·오류 코드만 남기고 입력 값·비고는 남기지 않습니다.' },
  ];

  function hash(s) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  const rnd = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 36).toString(36)).join('');

  function create(opts) {
    opts = opts || {};
    const now = opts.now || (() => Date.now());
    const sessions = new Map(), idem = new Map();
    const logs = [];
    const log = (code, qid) => logs.push({ code, qid: qid || null }); // 값·비고는 기록하지 않음
    let seq = 0;
    const iso = (t) => new Date(t).toISOString();
    const ok = (status, body, extra) => ({ status, body, ...extra });
    const err = (status, code, message, details) => {
      log(code);
      return { status, body: { request_id: 'r_' + (++seq), error: { code, message, ...(details ? { details } : {}) } } };
    };

    function auth(sid, token) {
      const s = sessions.get(sid);
      if (s && now() > s.expires) { sessions.delete(sid); }
      const cur = sessions.get(sid);
      if (!cur) return { e: err(404, 'E-NF-01', '세션이 없거나 만료·삭제되었습니다.') };
      if (!token || hash(token) !== cur.tokenHash) return { e: err(401, 'E-AUTH-01', '토큰이 없거나 일치하지 않습니다.') };
      return { s: cur };
    }
    const qOf = (qid) => D.QUESTIONS.find((q) => q.qid === qid);
    const publicQ = (q) => ({ qid: q.qid, area: q.area, rule_type: q.rule_type, criterion_label: q.criterion.label, allowed_units: q.allowed_units, required_evidence: q.required_evidence, source_status: q.source.source_status });

    async function handle(method, path, req) {
      req = req || {};
      const h = req.headers || {};
      const token = (h.Authorization || h.authorization || '').replace(/^Bearer\s+/i, '');
      const [pathOnly, qs] = path.split('?');
      const seg = pathOnly.split('/').filter(Boolean);
      const query = Object.fromEntries(new URLSearchParams(qs || ''));
      if (typeof req.body === 'string') { try { req = { ...req, body: JSON.parse(req.body) }; } catch (e) { return err(400, 'E-REQ-01', 'JSON 파싱에 실패했습니다.'); } }
      const body = req.body;

      if (method === 'GET' && seg[0] === 'notices' && seg.length === 1) return ok(200, { notices: NOTICES, environment: '비인증 시연 환경' });
      if (method === 'GET' && seg[0] === 'standards' && seg.length === 1) return ok(200, { standards: [STANDARD] });
      if (method === 'GET' && seg[0] === 'standards' && seg[2] === 'questions') {
        if (seg[1] !== STANDARD.standard_id) return err(404, 'E-NF-02', '존재하지 않는 standard_id입니다.');
        return ok(200, { standard_id: seg[1], questions: D.QUESTIONS.map(publicQ) });
      }

      if (method === 'POST' && seg[0] === 'sessions' && seg.length === 1) {
        if (!body || typeof body.standard_id !== 'string') return err(422, 'E-IN-01', 'standard_id가 필요합니다.', [{ field: 'standard_id', reason: 'required' }]);
        if (body.standard_id !== STANDARD.standard_id) return err(404, 'E-NF-02', '존재하지 않는 standard_id입니다.');
        if (body.scenario != null && !['company_a', 'blank'].includes(body.scenario)) return err(422, 'E-IN-01', 'scenario 값이 올바르지 않습니다.', [{ field: 'scenario', reason: 'allowed: company_a|blank' }]);
        const key = h['Idempotency-Key'] || h['idempotency-key'];
        if (key && String(key).length > 64) return err(422, 'E-IN-01', 'Idempotency-Key는 64자 이하입니다.');
        const mk = (s, status) => {
          const t = rnd(32); s.tokenHash = hash(t); // 새 토큰 발급, 이전 토큰 폐기
          return ok(status, { session_id: s.id, token: t, expires_at: iso(s.expires), notices: NOTICES, environment: '비인증 시연 환경' });
        };
        if (key) { const sid = idem.get(hash(String(key))); const ex = sid && sessions.get(sid); if (ex && now() <= ex.expires) return mk(ex, 200); }
        const s = { id: 's_' + rnd(12), expires: now() + TTL_MS, answers: {}, revision: {}, state: 'CREATED', results: null, stale: false, drafts: [], calls: [] };
        if ((body.scenario || 'company_a') === 'company_a') { s.answers = JSON.parse(JSON.stringify(D.SAMPLE_ANSWERS)); for (const q of Object.keys(s.answers)) s.revision[q] = 1; s.state = 'ANSWERING'; }
        sessions.set(s.id, s);
        if (key) idem.set(hash(String(key)), s.id);
        return mk(s, 201);
      }

      if (seg[0] !== 'sessions' || !seg[1]) return err(404, 'E-NF-01', '알 수 없는 경로입니다.');
      const a = auth(seg[1], token);
      if (a.e) {
        // 삭제는 멱등: 이미 없는 세션도 204
        if (method === 'DELETE' && seg.length === 2 && a.e.status === 404) return ok(204, null);
        return a.e;
      }
      const s = a.s;

      if (method === 'DELETE' && seg.length === 2) { sessions.delete(s.id); for (const [k, v] of idem) if (v === s.id) idem.delete(k); return ok(204, null); }

      if (method === 'PUT' && seg[2] === 'answers' && seg[3]) {
        const q = qOf(seg[3]);
        if (!q) return err(404, 'E-NF-02', '존재하지 않는 qid입니다.');
        if (!body || typeof body !== 'object' || Array.isArray(body)) return err(422, 'E-IN-01', '요청 본문이 올바르지 않습니다.');
        if (body.evidence != null && !Array.isArray(body.evidence)) return err(422, 'E-IN-01', 'evidence는 배열이어야 합니다.', [{ field: 'evidence', reason: 'array' }]);
        const v = E.validateAnswer(q, body);
        if (!v.ok) {
          const code = v.errors.includes('E-IN-05') ? 'E-IN-05' : v.errors[0] === 'E-IN-01' ? 'E-IN-01' : 'E-IN-02';
          const field = code === 'E-IN-05' ? 'note' : body.unit != null && q.allowed_units.length && !q.allowed_units.includes(body.unit) ? 'unit' : 'value';
          return err(422, code, code === 'E-IN-05' ? '가상 데이터만 입력하세요(민감 표현 감지).' : '허용 단위가 아니거나 값이 범위를 벗어났습니다.', [{ field, reason: 'allowed: ' + (q.allowed_units.join(',') || '-'), ...(code === 'E-IN-05' ? {} : { received: body[field] }) }]);
        }
        s.answers[q.qid] = body; s.revision[q.qid] = (s.revision[q.qid] || 0) + 1;
        s.stale = !!s.results; if (s.state === 'CREATED') s.state = 'ANSWERING';
        return ok(200, { qid: q.qid, revision: s.revision[q.qid], saved_at: iso(now()), stale_results: s.stale });
      }

      if (method === 'POST' && seg[2] === 'evaluate') {
        let r;
        try { r = E.evaluateAll(D.QUESTIONS, s.answers, { mode: opts.mode || 'demo' }); } catch (e) { return err(500, 'E-SYS-01', '기준표 처리 중 오류가 발생했습니다.'); }
        s.results = r; s.stale = false; s.state = 'EVALUATED'; s.drafts = [];
        return ok(200, { evaluated_at: iso(now()), summary: { '충족': r.summary.ok, '미흡': r.summary.bad, '확인 필요': r.summary.check }, results: r.results });
      }

      if (method === 'GET' && seg[2] === 'results' && seg[3]) {
        if (!qOf(seg[3])) return err(404, 'E-NF-02', '존재하지 않는 qid입니다.');
        if (!s.results) return err(409, 'E-STATE-01', '평가 전에는 결과를 조회할 수 없습니다.');
        return ok(200, s.results.results.find((x) => x.qid === seg[3]));
      }

      if (method === 'POST' && seg[2] === 'draft') {
        if (!s.results) return err(409, 'E-STATE-01', '평가 후에 초안을 생성할 수 있습니다.');
        if (s.stale) return err(409, 'E-STATE-02', '입력이 바뀌었습니다. 재평가 후 초안을 생성하세요.');
        const mode = (body && body.mode) || 'auto';
        if (!['auto', 'template'].includes(mode)) return err(422, 'E-IN-01', 'mode는 auto|template 입니다.', [{ field: 'mode', reason: 'allowed: auto|template' }]);
        const reuse = s.drafts.find((d) => d.mode === mode);
        if (reuse) return ok(200, reuse.body);
        s.calls = s.calls.filter((t) => now() - t < RATE_WIN);
        if (s.calls.length >= RATE_MAX) return err(429, 'E-RATE-01', 'draft 호출 한도(10분당 5회)를 초과했습니다.');
        s.calls.push(now());
        let d;
        try {
          d = await Promise.race([
            E.generateChecklistDraft(s.results.results, mode === 'template' ? {} : { llm: opts.llm }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('T')), opts.draftTimeoutMs || DRAFT_TIMEOUT)),
          ]);
        } catch (e) { return err(504, 'E-SYS-08', '초안 생성 시간이 초과되었습니다. mode=template을 사용하세요.'); }
        const out = { draft_id: 'd_' + rnd(8), generation_mode: d.generation_mode, fallback_reason: d.fallback_reason === 'NO_LLM' ? null : (d.fallback_reason === 'INVALID_OUTPUT' ? 'OUTPUT_INVALID' : d.fallback_reason || null), items: d.items, checklist: d.checklist, disclaimer: d.disclaimer, generated_at: iso(now()) };
        s.drafts.push({ mode, body: out }); s.state = 'DRAFTED';
        return ok(200, out);
      }

      if (method === 'GET' && seg[2] === 'export') {
        if (query.format !== 'md') return err(422, 'E-IN-01', 'format=md만 지원합니다.', [{ field: 'format', reason: 'allowed: md' }]);
        const d = s.drafts[s.drafts.length - 1];
        if (!d) return err(409, 'E-STATE-01', '초안이 없습니다.');
        const md = ['# Spec Bridge 검토용 초안', '', ...d.body.items.map((i) => `- **${i.qid}** ${i.summary}\n  - 조치: ${i.action}`), '', '## 보완 체크리스트', ...d.body.checklist.map((c) => `- [ ] ${c.label} (${c.qid})`), '', `> ${d.body.disclaimer}`].join('\n');
        return ok(200, md, { contentType: 'text/markdown' });
      }
      return err(404, 'E-NF-01', '알 수 없는 경로입니다.');
    }
    return { handle, _sessions: sessions, _logs: logs, STANDARD };
  }

  const api = { create };
  if (typeof window !== 'undefined') window.SB_API = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
