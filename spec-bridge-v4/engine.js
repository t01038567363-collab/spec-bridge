'use strict';
/* 판정 엔진 — DOM·네트워크 비의존 순수 함수.
   서버(server.js)에서 require 하여 실제 판정에 쓰고, 브라우저(tests.html)에서는 전역으로 로드해 단위 테스트에 쓴다. */
(function (root) {
  const MAX_REQS = 600;
  const MARK = /(해야|하여야|한다|할 것|하도록|이어야|되어야|이상|이하|이내|초과|미만|shall|must|required|minimum|maximum|at least|at most|±|\+\/-)/i;
  const MARK_STRIP = /(해야|하여야|한다|할 것|하도록|이어야|되어야|이상|이하|이내|초과|미만|shall|must|required|minimum|maximum|at least|at most)/gi;
  const STOP_EN = new Set(['the', 'and', 'for', 'with', 'per', 'that', 'this', 'are', 'all', 'any', 'not', 'shall', 'must', 'will', 'from', 'have', 'has', 'been', 'its', 'than', 'least', 'most']);
  const STOP_KO = new Set(['여야', '있는', '있다', '대한', '대해', '에서', '으로', '또는', '하는', '하며', '있음', '않는', '경우', '이며', '이다', '수행', '제출', '만족']);
  const UNIT = '(?:mm|μm|um|kg|khz|mhz|ghz|hz|vdc|vac|v|ma|a|℃|°c|%|시간|hours?|hrs?|h|db|mpa|kpa|ms|g)';
  const UNIT_NORM = { vdc: 'v', vac: 'v', '°c': 'c', '℃': 'c', 시간: 'h', hour: 'h', hours: 'h', hr: 'h', hrs: 'h', μm: 'um' };
  const VAL_RE = new RegExp(`(±|\\+\\/-|\\+-)?\\s*([+-]?\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT})(?![a-z])\\s*(이상|이하|이내|초과|미만|or more|or less|min(?:imum)?|max(?:imum)?)?`, 'gi');
  const ID_RE = /(MIL-STD-\d+[A-Z]?|MIL-HDBK-\d+[A-Z]?|KDS[-\s]?[A-Z0-9][A-Z0-9-]*|AS\s?9100[A-Z]?|ISO\s?\d{3,5}|ITAR|\bEAR\b|ECP|FMEA|FRACAS|DMSMS|RTM|ICD|CSCI|KQP|\bEMC\b|\bEMI\b|\bESS\b|MTBF|\bATP\b|\bQTR\b)/gi;
  const OP_TXT = { ge: '이상', gt: '초과', le: '이하', lt: '미만', tol: '(허용오차)', eq: '(동일)' };

  const normId = (s) => s.toUpperCase().replace(/\s+/g, '');

  function splitSentences(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const merged = [];
    for (const raw of lines) {
      const ln = raw.trim();
      if (!ln) { merged.push(''); continue; }
      const prev = merged[merged.length - 1];
      const bullet = /^(\d+(\.\d+)*[.)]?\s|[-•·○ㅇ□▶]|\(\d+\)|\[)/.test(ln);
      if (prev && !bullet && !/[.다:;。]$/.test(prev)) merged[merged.length - 1] = `${prev} ${ln}`;
      else merged.push(ln);
    }
    const out = [];
    for (const m of merged) {
      if (!m) continue;
      m.split(/(?<=[.!?。])\s+(?=[A-Z가-힣\d])/).forEach((s) => { const t = s.trim(); if (t.length >= 6) out.push(t); });
    }
    return out;
  }

  function termsOf(s) {
    const t = new Set();
    const low = s.toLowerCase().replace(MARK_STRIP, ' ');
    (low.match(/[a-z][a-z0-9-]{2,}/g) || []).forEach((w) => { if (!STOP_EN.has(w)) t.add(w); });
    (low.match(/[가-힣]{2,}/g) || []).forEach((run) => {
      for (let i = 0; i < run.length - 1; i++) { const bg = run.slice(i, i + 2); if (!STOP_KO.has(bg)) t.add(bg); }
    });
    return t;
  }

  function parseValues(s) {
    const vals = [];
    const re = new RegExp(VAL_RE.source, 'gi');
    let m;
    while ((m = re.exec(s))) {
      let unit = m[3].toLowerCase();
      unit = UNIT_NORM[unit] || unit;
      const num = parseFloat(m[2].replace(/,/g, ''));
      if (Number.isNaN(num)) continue;
      const before = s.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
      const after = (m[4] || '').toLowerCase();
      let op = 'eq';
      if (m[1]) op = 'tol';
      else if (/이상|or more|min/.test(after) || /(at least|minimum|min\.?|최소|≥|>=)\s*$/.test(before)) op = 'ge';
      else if (/이하|이내|or less|max/.test(after) || /(at most|maximum|max\.?|최대|≤|<=)\s*$/.test(before)) op = 'le';
      else if (/초과/.test(after)) op = 'gt';
      else if (/미만/.test(after)) op = 'lt';
      vals.push({ num, unit, op, raw: m[0].trim(), signed: /^[+-]/.test(m[2]) });
    }
    return vals;
  }

  function satisfied(spec, c) {
    const v = spec.op === 'tol' ? Math.abs(c.num) : c.num;
    switch (spec.op) {
      case 'ge': return v >= spec.num;
      case 'gt': return v > spec.num;
      case 'le': return v <= spec.num;
      case 'lt': return v < spec.num;
      case 'tol': return v <= Math.abs(spec.num);
      default: return v === spec.num;
    }
  }

  function extractRequirements(specFiles) {
    const seen = new Set();
    const reqs = [];
    for (const f of specFiles) {
      for (const s of splitSentences(f.text)) {
        if (!(MARK.test(s) || parseValues(s).length)) continue;
        const key = s.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) continue;
        seen.add(key);
        reqs.push({ text: s, file: f.name, terms: termsOf(s), values: parseValues(s), ids: [...new Set((s.match(ID_RE) || []).map(normId))] });
        if (reqs.length >= MAX_REQS) return reqs;
      }
    }
    return reqs;
  }

  function kwRegex(kw) {
    const e = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /^[a-z0-9 \-&/.]+$/i.test(kw) ? new RegExp(`(?<![a-z0-9])${e}(?![a-z])`, 'i') : new RegExp(e, 'i');
  }

  function classify(req, crits) {
    let best = null, bestN = 0;
    for (const c of crits) {
      const n = c.kw.filter((kw) => kwRegex(kw).test(req.text)).length;
      if (n > bestN) { best = c; bestN = n; }
    }
    return best ? best.id : null;
  }

  function judge(req, index, threshold) {
    const scored = [];
    for (const s of index) {
      let hit = 0;
      for (const t of req.terms) if (s.terms.has(t)) hit++;
      const rel = req.terms.size ? hit / req.terms.size : 0;
      if (rel > 0) scored.push({ s, rel });
    }
    scored.sort((a, b) => b.rel - a.rel);
    const top = scored.slice(0, 3);
    const best = top[0];
    const base = { text: req.text, file: req.file, values: req.values, ids: req.ids };
    if (!best || best.rel < threshold) {
      return { ...base, status: 'MISSING', relevance: best ? best.rel : 0, evidence: best ? [{ text: best.s.text, file: best.s.file }] : [], issues: ['연관된 기업 자료 문장을 찾지 못했습니다.'], quantitative: false };
    }
    const near = top.filter((t) => t.rel >= threshold).map((t) => t.s);
    const nearText = near.map((s) => s.text).join(' ');
    const issues = [];
    const nearIds = new Set((nearText.match(ID_RE) || []).map(normId));
    const idOk = (id) => nearIds.has(id) || [...nearIds].some((n) => /\d$/.test(id) && n.startsWith(id) && /^[A-Z]$/.test(n.slice(id.length)));
    for (const id of req.ids) if (!idOk(id)) issues.push(`규격이 요구한 표준/문서 "${id}"가 관련 문장에서 확인되지 않습니다.`);
    const compVals = near.flatMap((s) => s.values);
    for (const v of req.values) {
      const same = compVals.filter((c) => c.unit === v.unit);
      if (!same.length) { issues.push(`규격 수치 ${v.raw} ${OP_TXT[v.op]} 에 대응하는 ${v.unit} 단위 수치가 기업 자료에 없습니다.`); continue; }
      if (!same.some((c) => satisfied(v, c))) issues.push(`규격 ${v.raw} ${OP_TXT[v.op]} 미충족 — 기업 자료 값: ${[...new Set(same.map((c) => c.raw))].join(', ')}`);
    }
    return { ...base, status: issues.length ? 'REVISION' : 'MET', relevance: best.rel, evidence: near.map((s) => ({ text: s.text, file: s.file })), issues, quantitative: req.ids.length + req.values.length > 0 };
  }

  function rollup(list) {
    if (!list.length) return 'NA';
    if (list.every((r) => r.status === 'MET')) return 'MET';
    if (list.every((r) => r.status === 'MISSING')) return 'MISSING';
    return 'REVISION';
  }

  /* 전체 비교 실행: 입력은 {name,text} 배열, 출력은 직렬화 가능한 결과 객체 */
  function compare({ specFiles, compFiles, crits, threshold }) {
    const reqs = extractRequirements(specFiles);
    const index = compFiles.flatMap((f) => splitSentences(f.text).map((t) => ({ text: t, file: f.name, terms: termsOf(t), values: parseValues(t) })));
    const judged = reqs.map((r) => ({ ...judge(r, index, threshold), criterionId: classify(r, crits) }));
    const criteria = crits.map((c) => {
      const list = judged.filter((r) => r.criterionId === c.id);
      return { id: c.id, status: rollup(list), reqs: list };
    });
    return { criteria, other: judged.filter((r) => !r.criterionId), reqs: judged, threshold, specFiles: specFiles.map((f) => f.name), compFiles: compFiles.map((f) => f.name) };
  }

  const SENSITIVE = [
    [/\d{6}\s?-\s?[1-4]\d{6}/, '주민등록번호 형식'],
    [/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/, '휴대전화번호 형식'],
    [/[\w.+-]+@[\w-]+\.[\w.-]+/, '이메일 주소'],
    [/(군사\s?기밀|군사비밀|대외비|Ⅱ급\s?비밀|II급\s?비밀|Ⅲ급\s?비밀|III급\s?비밀|CONFIDENTIAL|SECRET|TOP SECRET)/i, '비밀·대외비 표시'],
    [/(비밀번호|패스워드|password|api[_-]?key|secret[_-]?key)\s*[:=]/i, '비밀번호·키 표기'],
    [/\b\d{3}-\d{2}-\d{5}\b/, '사업자등록번호 형식'],
  ];
  const detectSensitive = (text) => SENSITIVE.filter(([re]) => re.test(text)).map(([, label]) => label);

  const api = { MAX_REQS, splitSentences, termsOf, parseValues, satisfied, extractRequirements, classify, judge, rollup, compare, detectSensitive };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
}(typeof globalThis !== 'undefined' ? globalThis : this));
