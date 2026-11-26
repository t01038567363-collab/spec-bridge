(function () {
  const { CRITERIA, QUESTIONS, SAMPLE_ANSWERS, COMPANIES, SAMPLE_DOCS } = SB_DATA;
  const E = SB_ENGINE;
  const S = {
    step: 1, mode: 'demo', company: COMPANIES[0], custom: { name: '', project: '' },
    files: [], answers: {}, docEval: null, qEval: null, docDraft: null, ckDraft: null,
    qErrors: {}, tab: 'A', filter: 'ALL',
  };
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cls = (s) => String(s).split(' ')[0];
  const names = ['기업 로그인', '파일 업로드', '규격 사전검사', '리포트'];
  const companyName = () => (S.company.id === 'custom' ? S.custom.name || '미입력 기업' : S.company.name);
  const projectName = () => (S.company.id === 'custom' ? S.custom.project || '사전 점검' : S.company.project);
  const SERVER = location.protocol !== 'file:';

  // 서버 모드: 같은 handle(method, path, {headers, body}) 계약을 fetch로 호출한다. file://로 열면 브라우저 내장 API(시연용)를 쓴다.
  function makeApi() {
    if (!SERVER) return SB_API.create({ mode: S.mode, llm: window.SB_LLM });
    return {
      STANDARD: { standard_id: 'KDS-0050-9000' },
      async handle(method, p, req) {
        req = req || {};
        try {
          const res = await fetch('/api' + p, {
            method, credentials: 'same-origin',
            headers: { 'X-Requested-With': 'spec-bridge', ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(req.headers || {}) },
            body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          });
          const text = await res.text();
          let body = null;
          try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
          if (res.status >= 400 && !(body && body.error)) body = { error: { code: 'E-SYS-01', message: '서버 응답 오류 (' + res.status + ')' } };
          return { status: res.status, body };
        } catch (e) {
          return { status: 0, body: { error: { code: 'E-NET-01', message: '서버에 연결할 수 없습니다. node server.js 실행 여부를 확인하세요.' } } };
        }
      },
    };
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), 4000);
  }
  function banner() {
    $('#banner').innerHTML = `⚠ 본 서비스는 <b>공식 인증·심사가 아닌 사전 점검 보조</b>입니다. 가상 데이터만 입력하세요(기밀·개인정보 금지). 데이터는 ${SERVER ? '문서 12항목 검사는 이 브라우저 안에서만, 수치 10문항 입력은 검사 시 서버로 전송되어 판정 직후 삭제됩니다(서버 메모리·24시간 만료).' : '이 브라우저 메모리에만 있으며 서버로 전송·저장되지 않습니다(file:// 시연 모드).'} · 정책 모드: <b>${S.mode === 'demo' ? 'demo (원문 대조 전 시연 판정)' : 'strict (원문 대조 전 문항은 모두 확인 필요)'}</b>`;
  }
  function stepper() {
    $('#stepper').innerHTML = names.map((n, i) => `<button class="${S.step === i + 1 ? 'on' : ''}" data-s="${i + 1}">${i + 1}. ${n}</button>`).join('');
    $('#stepper').querySelectorAll('button').forEach((b) => (b.onclick = () => go(+b.dataset.s)));
  }
  function go(n) {
    if (n >= 2 && S.company.id === 'custom' && !S.custom.name.trim()) return toast('기업명을 입력하세요.');
    if (n === 4 && !S.docEval && !S.qEval) return toast('먼저 사전검사를 실행하세요.');
    S.step = n; render();
  }

  /* ---------- Step 1 ---------- */
  function v1() {
    return `<div class="card"><h2>기업 선택</h2>
      <div class="row"><select id="co">${COMPANIES.map((c) => `<option value="${c.id}" ${S.company.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="custom" ${S.company.id === 'custom' ? 'selected' : ''}>직접 입력</option></select></div>
      <div class="row ${S.company.id === 'custom' ? '' : 'hide'}"><input id="cn" placeholder="기업명(가상)" value="${esc(S.custom.name)}"><input id="cp" placeholder="프로젝트명" value="${esc(S.custom.project)}"></div>
      <p class="mut">프로젝트: ${esc(projectName())}</p>
      <h3>판정 정책 모드</h3>
      <div class="row"><label><input type="radio" name="m" value="demo" ${S.mode === 'demo' ? 'checked' : ''}> demo — 후보 기준값으로 시연 판정(“원문 대조 전” 표기)</label>
      <label><input type="radio" name="m" value="strict" ${S.mode === 'strict' ? 'checked' : ''}> strict — 원문 대조 전 문항은 전부 확인 필요</label></div>
      <button class="btn" id="n1">다음: 파일 업로드</button></div>`;
  }
  function b1() {
    $('#co').onchange = (e) => { S.company = e.target.value === 'custom' ? { id: 'custom' } : COMPANIES.find((c) => c.id === e.target.value); render(); };
    if ($('#cn')) { $('#cn').oninput = (e) => (S.custom.name = e.target.value); $('#cp').oninput = (e) => (S.custom.project = e.target.value); }
    document.querySelectorAll('input[name=m]').forEach((r) => (r.onchange = () => { S.mode = r.value; S.qEval = null; banner(); }));
    $('#n1').onclick = () => go(2);
  }

  /* ---------- Step 2 ---------- */
  async function readFile(f) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (['txt', 'json', 'csv', 'md'].includes(ext)) return { name: f.name, size: f.size, extractedText: await f.text() };
    if (ext === 'pdf') {
      if (!window.pdfjsLib) { toast('PDF.js를 불러오지 못해 파일명만 사용합니다.'); return { name: f.name, size: f.size, extractedText: '' }; }
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
        let text = '';
        for (let p = 1; p <= Math.min(pdf.numPages, 25); p++) text += (await (await pdf.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ') + '\n';
        if (!text.trim()) toast(`${f.name}: 스캔본으로 보여 텍스트를 읽지 못했습니다(텍스트 PDF 권장).`);
        return { name: f.name, size: f.size, extractedText: text };
      } catch (e) { toast(`${f.name}: PDF를 읽지 못했습니다.`); return { name: f.name, size: f.size, extractedText: '' }; }
    }
    toast(`${f.name}: 지원하지 않는 형식(PDF/TXT/JSON/CSV)입니다.`);
    return null;
  }
  async function addFiles(list) {
    for (const f of list) { const r = await readFile(f); if (r) S.files.push(r); }
    S.docEval = null; render();
  }
  function v2() {
    return `<div class="card"><h2>규격·증빙 문서 업로드</h2>
      <div class="drop" id="drop">파일을 끌어놓거나 클릭 (PDF·TXT·JSON·CSV, PDF는 25쪽까지)<input type="file" id="fi" multiple class="hide"></div>
      <div class="row"><button class="btn sec" id="smp">샘플 문서 불러오기</button><button class="btn sec" id="clr">비우기</button></div>
      ${S.files.length ? `<ul>${S.files.map((f) => `<li>${esc(f.name)} <span class="mut">(${f.extractedText ? f.extractedText.length + '자 추출' : '텍스트 없음'})</span></li>`).join('')}</ul>` : '<p class="mut">업로드된 파일이 없습니다. 파일 없이 실행하면 문서 검사는 전 항목 누락으로 처리되며 임의 판정을 만들지 않습니다.</p>'}
      <button class="btn sec" id="p1">이전</button> <button class="btn" id="n2">다음: 사전검사</button></div>`;
  }
  function b2() {
    const d = $('#drop');
    d.onclick = () => $('#fi').click();
    $('#fi').onchange = (e) => addFiles([...e.target.files]);
    d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
    $('#smp').onclick = () => { S.files = SAMPLE_DOCS.map((x) => ({ name: x.name, size: x.text.length, extractedText: x.text })); S.docEval = null; render(); };
    $('#clr').onclick = () => { S.files = []; S.docEval = null; render(); };
    $('#p1').onclick = () => go(1); $('#n2').onclick = () => go(3);
  }

  /* ---------- Step 3 ---------- */
  function ansOf(q) {
    return (S.answers[q.qid] = S.answers[q.qid] || { evidence: q.required_evidence.map((e) => ({ id: e.id, state: '미보유', meta: {} })), note: '' });
  }
  function qForm(q) {
    const a = ansOf(q), errs = S.qErrors[q.qid] || [];
    const hasVal = q.allowed_units && q.allowed_units.length && q.criterion && q.criterion.label && !['match'].includes(q.rule_type);
    return `<div class="q ${errs.length ? 'err' : ''}" data-q="${q.qid}"><b>${q.qid} ${esc(q.area)}</b> <span class="mut">기준: ${esc(q.criterion.label || '')}${q.assumed ? ' (가정값)' : ''}</span>
      <div class="row">${hasVal ? `<input type="number" step="any" class="v" placeholder="값" value="${esc(a.value)}" style="width:110px"><select class="u">${q.allowed_units.map((u) => `<option ${a.unit === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}<option value="">(단위 없음)</option><option ${a.unit === 'inch' ? 'selected' : ''}>inch</option></select>` : ''}
      <select class="cd"><option value="">조건 판단 안 함</option>${['합치', '불일치', '미확인'].map((c) => `<option ${a.condition === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      ${q.required_evidence.map((ev, i) => `<div class="row"><label>증빙 ${esc(ev.name)}: <select class="es" data-i="${i}"><option ${a.evidence[i].state === '보유' ? 'selected' : ''}>보유</option><option ${a.evidence[i].state === '미보유' ? 'selected' : ''}>미보유</option></select></label>
        ${(ev.required_meta || []).map((m) => `<input class="em" data-i="${i}" data-k="${esc(m)}" placeholder="${esc(m)}" value="${esc(a.evidence[i].meta[m] || '')}">`).join('')}</div>`).join('')}
      <input class="nt" placeholder="비고(민감정보 입력 금지)" value="${esc(a.note)}" style="width:100%">
      ${errs.map((c) => `<div class="err-t">입력 오류 ${esc(c)}: ${c === 'E-IN-02' ? '값 또는 단위가 올바르지 않습니다.' : c === 'E-IN-05' ? '비고에 민감정보로 보이는 표현이 있습니다. 제거하세요.' : ''}</div>`).join('')}</div>`;
  }
  function itemDoc(c, r) {
    return `<div class="item s-${r.status}"><span class="tag ${r.status}">${{ MET: '충족', REVISION: '보완', MISSING: '누락' }[r.status]}</span> <b>${esc(c.code)} ${esc(c.title)}</b> <span class="mut">${esc(c.domain)} · 가중치 ${c.weight}</span>
      <div class="mut">매칭 키워드: ${r.matchedKeywords.length ? esc(r.matchedKeywords.join(', ')) : '없음'}</div></div>`;
  }
  function v3() {
    const doc = S.docEval;
    return `<div class="card"><h2>규격 사전검사</h2>
      <div class="row"><button class="btn ${S.tab === 'A' ? '' : 'sec'}" data-t="A">A. 문서 12항목 검사</button><button class="btn ${S.tab === 'B' ? '' : 'sec'}" data-t="B">B. 수치 체크리스트 10문항</button></div>
      ${S.tab === 'A' ? `<p class="mut">업로드 문서에서 항목별 키워드 3개 이상=충족, 1~2개=보완, 0개=누락. 근거가 없으면 판정을 만들지 않고 누락으로 둡니다.</p>
        <button class="btn" id="runA">문서 검사 실행</button>
        ${doc ? `<div class="stats"><div class="stat"><b>${doc.summary.score}</b>점</div><div class="stat"><b>${doc.summary.met}</b>충족</div><div class="stat"><b>${doc.summary.revision}</b>보완</div><div class="stat"><b>${doc.summary.missing}</b>누락</div></div><p>${esc(doc.summary.verdict)}</p>${doc.fallback ? `<p class="err-t">${doc.fallback === 'NO_FILES' ? '업로드된 파일이 없어 전 항목이 누락으로 처리되었습니다.' : '문서에서 텍스트를 추출하지 못했습니다(스캔본일 수 있음). 파일명만으로 판정했습니다.'}</p>` : ''}${doc.results.map((r) => itemDoc(CRITERIA.find((c) => c.id === r.criterionId), r)).join('')}` : ''}`
      : `<p class="mut">답변은 가상 데이터로 입력하세요. 값·단위·증빙으로 규칙 엔진이 충족/미흡/확인 필요를 판정합니다(AI는 판정에 관여하지 않음).</p>
        <div class="row"><button class="btn sec" id="loadS">기업 A 샘플 답변 불러오기</button><button class="btn sec" id="rstQ">초기화</button></div>
        ${QUESTIONS.map(qForm).join('')}<button class="btn" id="runB">체크리스트 판정 실행</button>`}
      <div class="row"><button class="btn sec" id="p2">이전</button><button class="btn" id="n3">리포트 보기</button></div></div>`;
  }
  function readB() {
    document.querySelectorAll('.q').forEach((el) => {
      const q = QUESTIONS.find((x) => x.qid === el.dataset.q), a = ansOf(q);
      const v = el.querySelector('.v');
      if (v) {
        if (v.value === '') { delete a.value; delete a.unit; } else { a.value = Number(v.value); a.unit = el.querySelector('.u').value; }
      }
      const cd = el.querySelector('.cd').value;
      if (cd) a.condition = cd; else delete a.condition;
      a.note = el.querySelector('.nt').value;
      el.querySelectorAll('.es').forEach((s) => (a.evidence[+s.dataset.i].state = s.value));
      el.querySelectorAll('.em').forEach((m) => (a.evidence[+m.dataset.i].meta[m.dataset.k] = m.value));
    });
  }
  function b3() {
    document.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { if (S.tab === 'B') readB(); S.tab = b.dataset.t; render(); }));
    if (S.tab === 'A') {
      $('#runA').onclick = () => {
        S.docEval = E.evaluateDocuments(CRITERIA, S.files);
        if (S.docEval.fallback) toast(S.docEval.fallback === 'NO_FILES' ? '업로드 파일이 없어 전 항목 누락으로 처리했습니다.' : '텍스트 추출 실패: 파일명 기준으로 판정했습니다.');
        S.docDraft = E.buildDocDraft({ companyName: companyName(), projectName: projectName(), criteria: CRITERIA, evalResult: S.docEval });
        render();
      };
    } else {
      $('#loadS').onclick = () => { S.answers = JSON.parse(JSON.stringify(SAMPLE_ANSWERS)); S.qErrors = {}; render(); };
      $('#rstQ').onclick = () => { S.answers = {}; S.qErrors = {}; S.qEval = null; render(); };
      $('#runB').onclick = async () => {
        readB(); S.qErrors = {};
        const api = makeApi();
        const c = await api.handle('POST', '/sessions', { body: { standard_id: api.STANDARD.standard_id, scenario: 'blank', mode: S.mode } });
        if (c.status !== 201 && c.status !== 200) return toast('세션 생성 실패: ' + c.body.error.code + ' ' + c.body.error.message);
        const h = { Authorization: 'Bearer ' + c.body.token }, sid = c.body.session_id;
        for (const q of QUESTIONS) {
          const r = await api.handle('PUT', `/sessions/${sid}/answers/${q.qid}`, { headers: h, body: ansOf(q) });
          if (r.status !== 200) S.qErrors[q.qid] = [r.body.error.code];
        }
        if (Object.keys(S.qErrors).length) { toast('입력 오류가 있는 문항을 수정하세요.'); await api.handle('DELETE', `/sessions/${sid}`, { headers: h }); return render(); }
        const ev = await api.handle('POST', `/sessions/${sid}/evaluate`, { headers: h });
        if (ev.status !== 200) { await api.handle('DELETE', `/sessions/${sid}`, { headers: h }); return toast('평가 실패: ' + ev.body.error.code); }
        S.qEval = { summary: { total: 10, ok: ev.body.summary['충족'], bad: ev.body.summary['미흡'], check: ev.body.summary['확인 필요'] }, results: ev.body.results };
        const d = await api.handle('POST', `/sessions/${sid}/draft`, { headers: h, body: { mode: 'auto' } });
        S.ckDraft = d.status === 200 ? d.body : null;
        if (!S.ckDraft) toast('초안 생성 실패: ' + d.body.error.code);
        await api.handle('DELETE', `/sessions/${sid}`, { headers: h }); // 처리 후 세션 즉시 삭제
        toast(`판정 완료: 충족 ${S.qEval.summary.ok} · 미흡 ${S.qEval.summary.bad} · 확인 필요 ${S.qEval.summary.check}`);
        render();
      };
    }
    $('#p2').onclick = () => { if (S.tab === 'B') readB(); go(2); };
    $('#n3').onclick = () => { if (S.tab === 'B') readB(); go(4); };
  }

  /* ---------- Step 4 ---------- */
  function v4() {
    const q = S.qEval, d = S.docEval;
    const flt = (s) => S.filter === 'ALL' || s === S.filter;
    return `<div class="card"><h2>리포트 — ${esc(companyName())}</h2><p class="mut">${esc(projectName())}</p>
      ${d ? `<h3>문서 12항목: ${d.summary.score}점 (충족 ${d.summary.met} · 보완 ${d.summary.revision} · 누락 ${d.summary.missing})</h3>${S.docDraft.items.map((i) => `<div class="item s-${i.status}"><b>${esc(i.id)} ${esc(i.title)}</b> <span class="tag ${i.status}">${i.status}</span><div>현황: ${esc(i.currentState)}</div><div>조치: ${esc(i.actionGuide)}</div></div>`).join('')}` : '<p class="mut">문서 검사가 실행되지 않았습니다.</p>'}
      ${q ? `<h3>수치 체크리스트 ${S.mode === 'demo' ? '(원문 대조 전 시연 판정)' : '(strict)'}</h3>
        <div class="stats"><div class="stat"><b>${q.summary.ok}</b>충족</div><div class="stat"><b>${q.summary.bad}</b>미흡</div><div class="stat"><b>${q.summary.check}</b>확인 필요</div></div>
        <div class="row">${['ALL', '충족', '미흡', '확인 필요'].map((f) => `<button class="btn ${S.filter === f ? '' : 'sec'}" data-f="${f}">${f === 'ALL' ? '전체' : f}</button>`).join('')}</div>
        ${q.results.filter((r) => flt(r.status)).map((r) => `<div class="item s-${cls(r.status)}"><b>${r.qid} ${esc(r.area)}</b> <span class="tag ${cls(r.status)}">${r.status}</span> <span class="mut">${esc(r.reason_code)}</span>
          <div>${esc(r.reason)}</div><div class="mut">출처: ${esc(r.source.doc_name)} ${esc(r.source.clause)} ${esc(r.source.page)}쪽 (${esc(r.source.source_status)})</div>${r.guide ? `<div>보완 가이드: ${esc(r.guide)}</div>` : ''}</div>`).join('')}
        ${S.ckDraft ? `<h3>검토용 초안 (${S.ckDraft.generation_mode === 'llm' ? 'LLM' : '템플릿'})</h3><pre>${esc(S.ckDraft.items.map((i) => `${i.summary}\n  → ${i.action}`).join('\n'))}</pre>${S.ckDraft.checklist.length ? `<b>보완 체크리스트</b><ul>${S.ckDraft.checklist.map((c) => `<li>${esc(c.label)} <span class="mut">(${c.qid})</span></li>`).join('')}</ul>` : ''}` : ''}`
      : '<p class="mut">수치 체크리스트가 실행되지 않았습니다.</p>'}
      <p class="mut">${esc(E.DISCLAIMER)}</p>
      <div class="row"><button class="btn" id="dl">TXT 다운로드</button><button class="btn sec" id="js">JSON 다운로드</button><button class="btn sec" id="cp">복사</button><button class="btn sec" id="p3">이전</button></div></div>`;
  }
  function txt() {
    return E.buildTextReport({ companyName: companyName(), projectName: projectName(), userId: S.company.userId, docEval: S.docEval, docDraft: S.docDraft, qEval: S.qEval, mode: S.mode, files: S.files });
  }
  function save(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  function b4() {
    document.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; render(); }));
    $('#dl').onclick = () => save('spec-bridge-report.txt', txt(), 'text/plain;charset=utf-8');
    $('#js').onclick = () => save('spec-bridge-report.json', JSON.stringify({ company: companyName(), project: projectName(), mode: S.mode, docEval: S.docEval, qEval: S.qEval, ckDraft: S.ckDraft, disclaimer: E.DISCLAIMER }, null, 2), 'application/json');
    $('#cp').onclick = () => navigator.clipboard.writeText(txt()).then(() => toast('복사했습니다.'), () => toast('복사에 실패했습니다.'));
    $('#p3').onclick = () => go(3);
  }

  const views = [null, [v1, b1], [v2, b2], [v3, b3], [v4, b4]];
  function render() { banner(); stepper(); $('#view').innerHTML = views[S.step][0](); views[S.step][1](); }
  render();
})();
