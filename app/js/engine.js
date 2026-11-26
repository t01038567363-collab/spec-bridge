/* 규칙 엔진 · 초안 생성기 (순수 함수, DOM 비의존).
 * 판정은 결정적(deterministic)이며 LLM은 설명·초안 문장에만 관여한다. */
(function (root) {
  const D = root.SB_DATA || (typeof require !== 'undefined' ? require('./data.js') : null);
  const EPS = 1e-9;
  const STATUS = { OK: '충족', BAD: '미흡', CHECK: '확인 필요' };
  const DISCLAIMER =
    '본 문서는 공식 심사를 대체하지 않는 검토용 초안이며, 최종 제출본은 실무 담당자가 사실관계와 원문 근거를 확인해 확정합니다.';

  // ---------- 공통 유틸 ----------
  const isPlaceholder = (v) => v == null || String(v).trim() === '' || /^\s*\[.*\]\s*$/.test(String(v));
  const round6 = (n) => Math.round(n * 1e6) / 1e6;

  const FORBIDDEN = [/100\s*%\s*합격(\s*보장)?/g, /합격\s*(보장|확정)/g, /법적\s*승인(\s*(확정|보장))?/g, /인증\s*통과\s*(보장|확정)/g, /반드시\s*합격/g, /승인\s*확정/g];
  const containsForbidden = (t) => FORBIDDEN.some((re) => { re.lastIndex = 0; return re.test(String(t)); });
  const sanitize = (t) => FORBIDDEN.reduce((s, re) => s.replace(re, '[단정 표현 제거]'), String(t));

  // 보조 방어선일 뿐이며 완전한 민감정보 탐지가 아니다.
  const SENSITIVE = ['군사비밀', '2급비밀', '3급비밀', '대외비', '부대명', '무기체계명'];
  const hasSensitive = (t) => SENSITIVE.some((w) => String(t || '').includes(w));

  // ---------- 1) 수치 체크리스트 ----------
  function validateAnswer(q, a) {
    const errors = [];
    const numeric = ['range', 'min', 'max'].includes(q.rule_type);
    if (a == null || typeof a !== 'object') return { ok: false, errors: ['E-IN-01'] };
    if (numeric && a.value != null) {
      if (typeof a.value !== 'number' || !Number.isFinite(a.value) || a.value < 0 || a.value > 1e6 || Math.round(a.value * 1e4) / 1e4 !== a.value) errors.push('E-IN-02');
    }
    if (a.unit != null && q.allowed_units.length && !q.allowed_units.includes(a.unit)) errors.push('E-IN-02');
    if (a.condition != null && !['합치', '불일치', '미확인'].includes(a.condition)) errors.push('E-IN-02');
    if (a.note && String(a.note).length > 200) errors.push('E-IN-03');
    if (hasSensitive(a.note)) errors.push('E-IN-05');
    return { ok: errors.length === 0, errors };
  }

  const fmtVal = (a) => (a.value != null ? `${a.value} ${a.unit || ''}`.trim() : '—');

  function evaluateQuestion(q, a, opts) {
    const mode = (opts && opts.mode) || 'demo';
    a = a || {};
    const base = {
      qid: q.qid, area: q.area, source: q.source, source_status: q.source.source_status,
      policy_mode: mode, criterion: q.criterion.label, missing: [], facts: {}, evaluated_at: new Date().toISOString(),
    };
    const done = (status, code, reason, missing) => ({
      ...base, status, reason_code: code, reason, missing: missing || [],
      guide: status === STATUS.OK ? '' : q.guide[status] || '',
      interpretation: `규격 기준: ${q.criterion.label}${mode === 'demo' ? ' (원문 대조 전 시연 판정)' : ''}`,
      facts: factsOf(q, a),
    });
    const evs = Array.isArray(a.evidence) ? a.evidence : [];

    // 규칙 1: 근거 부족
    const s = q.source || {};
    if (isPlaceholder(s.doc_name) || isPlaceholder(s.clause) || isPlaceholder(s.page))
      return done(STATUS.CHECK, 'SRC_MISSING', '근거(문서명·조항·쪽수)가 비어 있어 판정하지 않습니다.');
    if (mode === 'strict' && s.source_status !== 'verified')
      return done(STATUS.CHECK, 'SRC_UNVERIFIED', '규격 원문 대조 전(unverified)이라 판정하지 않습니다.');

    // 규칙 2: 필수 입력·단위
    const numeric = ['range', 'min', 'max'].includes(q.rule_type);
    let converted = null;
    if (numeric) {
      if (typeof a.value !== 'number' || !Number.isFinite(a.value) || !a.unit)
        return done(STATUS.CHECK, 'INPUT_MISSING', '측정값 또는 단위가 입력되지 않았습니다.');
      if (!q.allowed_units.includes(a.unit))
        return done(STATUS.CHECK, 'UNIT_INVALID', `허용되지 않는 단위입니다(허용: ${q.allowed_units.join(', ')}).`);
      converted = round6((a.value * q.unit_conversions[a.unit]) / q.unit_conversions[q.criterion.unit]);
    } else if (q.rule_type === 'match') {
      if (!['합치', '불일치'].includes(a.condition))
        return done(STATUS.CHECK, 'INPUT_MISSING', '일치 여부(합치/불일치)가 확인되지 않았습니다.');
    }
    const byId = Object.fromEntries(evs.map((e) => [e.id, e]));
    if (q.required_evidence.some((r) => !byId[r.id]))
      return done(STATUS.CHECK, 'INPUT_MISSING', '필수 증빙의 보유 여부가 입력되지 않았습니다.');

    // 규칙 3: 증빙 메타
    const metaMissing = [];
    for (const r of q.required_evidence) {
      const e = byId[r.id];
      if (e.state === '보유') for (const m of r.required_meta) if (isPlaceholder(e.meta && e.meta[m])) metaMissing.push(`${r.name}: ${m}`);
    }
    if (metaMissing.length) return done(STATUS.CHECK, 'META_MISSING', '증빙은 있으나 필수 정보가 비어 있습니다.', metaMissing);

    // 규칙 4: 입력 모순 / 규칙 5: 수치 미달
    let outOfRange = false;
    if (numeric) {
      const lo = q.criterion.min, hi = q.criterion.max;
      outOfRange = (lo != null && converted < lo - EPS) || (hi != null && converted > hi + EPS);
      if ((a.condition === '합치' && outOfRange) || (a.condition === '불일치' && !outOfRange))
        return done(STATUS.CHECK, 'INPUT_CONFLICT', '입력한 일치 여부와 측정값이 서로 모순됩니다.');
    }
    const lacking = q.required_evidence.filter((r) => byId[r.id].state !== '보유').map((r) => r.name);
    if (outOfRange)
      return done(STATUS.BAD, 'VALUE_OUT_OF_RANGE', `측정값 ${converted} ${q.criterion.unit}가 기준(${q.criterion.label})을 벗어납니다.`, lacking);
    if (q.rule_type === 'match' && a.condition === '불일치')
      return done(STATUS.BAD, 'CONDITION_MISMATCH', '기준과 불일치한다고 입력되었습니다.', lacking);
    // 규칙 6: 증빙 미보유
    if (lacking.length) return done(STATUS.BAD, 'EVIDENCE_MISSING', '필수 증빙이 없습니다.', lacking);
    return done(STATUS.OK, 'OK', '기준을 충족하고 필수 증빙이 확인되었습니다.');
  }

  function factsOf(q, a) {
    const f = {};
    if (['range', 'min', 'max'].includes(q.rule_type)) f['입력값'] = fmtVal(a);
    if (q.rule_type === 'match') f['일치 여부'] = a.condition || '—';
    for (const r of q.required_evidence) {
      const e = (a.evidence || []).find((x) => x.id === r.id);
      f[r.name] = e ? e.state : '미입력';
    }
    return f;
  }

  const EXPECTED_DEMO = { Q01: '충족', Q02: '충족', Q03: '충족', Q04: '미흡', Q05: '미흡', Q06: '확인 필요', Q07: '확인 필요', Q08: '충족', Q09: '충족', Q10: '충족' };

  function evaluateAll(questions, answers, opts) {
    const results = questions.map((q) => evaluateQuestion(q, answers[q.qid], opts));
    const count = (st) => results.filter((r) => r.status === st).length;
    return { results, summary: { total: results.length, ok: count(STATUS.OK), bad: count(STATUS.BAD), check: count(STATUS.CHECK) } };
  }

  // ---------- 2) 문서 기반 12항목 ----------
  function kwMatch(text, kw) {
    kw = kw.toLowerCase();
    if (/^[a-z0-9 \-]+$/.test(kw)) {
      const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(text);
    }
    return text.includes(kw);
  }

  function evaluateCriterion(c, corpus) {
    const matched = c.keywords.filter((k) => kwMatch(corpus, k));
    const status = matched.length >= 3 ? 'MET' : matched.length >= 1 ? 'REVISION' : 'MISSING';
    const scoreContribution = status === 'MET' ? c.weight : status === 'REVISION' ? Math.round(c.weight * 0.5) : 0;
    return { criterionId: c.id, status, matchedKeywords: matched, scoreContribution };
  }

  // docs: [{name, extractedText}]. 파일이 없거나 텍스트가 비면 파일명만으로 판정(폴백)하며 근거 없는 항목은 누락으로 둔다.
  function evaluateDocuments(criteria, docs) {
    const corpus = (docs || []).map((d) => `${d.name}\n${d.extractedText || ''}`).join('\n').toLowerCase();
    const textLen = (docs || []).reduce((n, d) => n + (d.extractedText || '').trim().length, 0);
    const results = criteria.map((c) => evaluateCriterion(c, corpus));
    const total = criteria.reduce((n, c) => n + c.weight, 0);
    const earned = results.reduce((n, r) => n + r.scoreContribution, 0);
    const score = total ? Math.round((100 * earned) / total) : 0;
    const cnt = (s) => results.filter((r) => r.status === s).length;
    const verdict = score >= 80 ? '대부분 충족 — 세부 근거 확인 후 제출 검토' : score >= 50 ? '일부 보완·누락 조치 후 제출 권장' : '다수 보완·누락 — 제출 전 대폭 보완 필요';
    return {
      summary: { score, verdict, total: criteria.length, met: cnt('MET'), revision: cnt('REVISION'), missing: cnt('MISSING') },
      results,
      fallback: !(docs && docs.length) ? 'NO_FILES' : textLen === 0 ? 'NO_TEXT' : null,
    };
  }

  // ---------- 3) 초안 ----------
  function buildDocDraft({ companyName, projectName, criteria, evalResult }) {
    const items = evalResult.results.map((r) => {
      const c = criteria.find((x) => x.id === r.criterionId);
      const cur = r.status === 'MET' ? c.metBasis : r.status === 'REVISION' ? c.revisionCurrent : c.missingDoc;
      const act = r.status === 'MET' ? '현 상태를 유지하고 개정 시 근거 문서를 함께 갱신하세요.' : r.status === 'REVISION' ? c.revisionGuide : `${c.missingGuide} (권고: ${c.missingDeadline})`;
      return { id: c.id, title: c.title, status: r.status, currentState: sanitize(cur), actionGuide: sanitize(act) };
    });
    return {
      generation_mode: 'template',
      reportTitle: `[사전검사 리포트] ${companyName} - ${projectName}`,
      disclaimer: '본 사전 검사 결과는 제출 전 내부 검토 보조 자료이며, 공식 적합성·승인 여부는 관할 기관 및 규격 절차에 따릅니다.',
      items,
    };
  }

  const templateItem = (r) => ({
    qid: r.qid,
    summary: `${r.qid} ${r.area}: ${r.status}. 사유: ${r.reason}`,
    action: `필요한 조치: ${r.guide || '현 상태 유지'}. 근거: ${r.source.doc_name} ${r.source.clause} ${r.source.page}쪽(${r.source.source_status}).`,
  });

  function buildChecklistDraft(results) {
    const flagged = results.filter((r) => r.status !== STATUS.OK);
    const items = results.map(templateItem);
    const checklist = flagged.flatMap((r) => (r.missing.length ? r.missing : [r.guide]).map((label) => ({ label, qid: r.qid })));
    return { generation_mode: 'template', items, checklist, disclaimer: DISCLAIMER };
  }

  function numbersIn(t) { return (String(t).match(/\d+(?:\.\d+)?/g) || []).map(Number); }

  // LLM 출력 검증(TRD §2.6). 실패한 항목은 템플릿으로 대체한다.
  function validateLlmDraft(raw, results) {
    let obj;
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
    if (!obj || !Array.isArray(obj.items)) return null;
    const ids = results.map((r) => r.qid);
    const got = obj.items.map((i) => i && i.qid);
    if (got.length !== ids.length || new Set(got).size !== ids.length || ids.some((i) => !got.includes(i))) return null;
    const allowed = new Set(results.flatMap((r) => numbersIn(JSON.stringify({ ...r, evaluated_at: '' }))));
    let total = 0;
    const items = obj.items.map((it) => {
      const r = results.find((x) => x.qid === it.qid);
      const text = `${it.summary || ''} ${it.action || ''}`;
      total += text.length;
      const bad = containsForbidden(text) || numbersIn(text.replace(/Q\d+/g, '')).some((n) => !allowed.has(n)) || text.length > 400;
      return bad ? templateItem(r) : { qid: it.qid, summary: String(it.summary), action: String(it.action) };
    });
    if (total > 1500 * 2) return null;
    return items;
  }

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('LLM_TIMEOUT')), ms))]);

  // llm: async (promptJson) => string|object. 미설정·실패·검증 실패 시 템플릿으로 폴백한다.
  async function generateChecklistDraft(results, { llm, timeoutMs = 15000, retries = 1 } = {}) {
    const fallback = buildChecklistDraft(results);
    if (!llm) return { ...fallback, fallback_reason: 'NO_LLM' };
    const prompt = { results: results.map((r) => ({ qid: r.qid, status: r.status, reason_code: r.reason_code, facts: r.facts, criterion: r.criterion, missing: r.missing, source: r.source, guide: r.guide })) };
    for (let i = 0; i <= retries; i++) {
      try {
        const items = validateLlmDraft(await withTimeout(Promise.resolve(llm(prompt)), timeoutMs), results);
        if (items) return { ...fallback, generation_mode: 'llm', items };
        return { ...fallback, fallback_reason: 'INVALID_OUTPUT' };
      } catch (e) {
        if (i === retries) return { ...fallback, fallback_reason: e.message === 'LLM_TIMEOUT' ? 'LLM_TIMEOUT' : 'LLM_ERROR' };
      }
    }
  }

  // ---------- 4) 리포트 출력 ----------
  const DOC_LABEL = { MET: '충족', REVISION: '보완 필요', MISSING: '누락' };
  function buildTextReport({ companyName, projectName, userId, docEval, docDraft, qEval, mode, files }) {
    const L = [];
    L.push('=== 스펙 브릿지 방산 규격 사전검사 리포트 ===', `기업: ${companyName}`, `사업: ${projectName}`, `담당: ${userId || '-'}`, `정책 모드: ${mode}${mode === 'demo' ? ' (원문 대조 전 시연 판정)' : ''}`, '');
    if (docEval) {
      const s = docEval.summary;
      L.push(`[문서 기반 12항목] 적합도 ${s.score}점 — ${s.verdict}`, `충족 ${s.met} / 보완 필요 ${s.revision} / 누락 ${s.missing} (업로드 ${(files || []).length}건)`);
      if (docEval.fallback) L.push('※ 업로드 문서 또는 추출 텍스트가 없어 기본 기준(누락)으로 판정했습니다.');
      for (const i of docDraft.items) L.push(`- ${i.id} [${DOC_LABEL[i.status]}] ${i.title}`, `    현황: ${i.currentState}`, `    조치: ${i.actionGuide}`);
      L.push('');
    }
    if (qEval) {
      const s = qEval.summary;
      L.push(`[수치 체크리스트 10문항] 충족 ${s.ok} / 미흡 ${s.bad} / 확인 필요 ${s.check}`);
      for (const r of qEval.results) L.push(`- ${r.qid} ${r.area} [${r.status}] ${r.reason_code}: ${r.reason}`, `    근거: ${r.source.doc_name} ${r.source.clause} ${r.source.page}쪽 (${r.source.source_status})`, ...(r.guide ? [`    조치: ${r.guide}`] : []));
      L.push('');
    }
    L.push(docDraft ? docDraft.disclaimer : DISCLAIMER);
    return L.join('\n');
  }

  const api = {
    STATUS, DISCLAIMER, EXPECTED_DEMO, isPlaceholder, containsForbidden, sanitize, hasSensitive,
    validateAnswer, evaluateQuestion, evaluateAll, kwMatch, evaluateCriterion, evaluateDocuments,
    buildDocDraft, buildChecklistDraft, validateLlmDraft, generateChecklistDraft, buildTextReport,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SB_ENGINE = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
