'use strict';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_TEXT_CHARS = 2000000;
const TEXT_EXTS = ['txt', 'json', 'csv', 'md', 'log'];
const STORE_KEY = 'specBridge.v4';
const ROLES = {
  defense: { name: '국방', desc: '규격 제시 측 — 규격서·요구기준을 등록하고 기업 자료 충족 여부를 검토' },
  company: { name: '기업', desc: '규격 대응 측 — 시험성적서·설계/품질 자료를 등록하고 규격 충족 여부를 사전 점검' },
};
const KIND_LABEL = { spec: '국방 규격서', company: '기업 자료' };
const STATUS_CLS = { MET: 'ok', REVISION: 'warn', MISSING: 'bad', NA: 'na' };
const critsOf = (role) => CRITERIA_SETS[role];
const curCrits = () => (state.results ? state.results.crits : critsOf(state.role));

const state = {
  screen: 1, role: 'company', mode: 'defense', org: '', project: '', notes: '',
  files: [], results: null, inspectedAt: null, inspecting: false, user: null,
  domainFilter: 'ALL', statusFilter: 'ALL', relevance: 0.4,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ---------- persistence (파일 본문은 저장하지 않음) ---------- */
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ role: state.role, org: state.org, project: state.project, notes: state.notes, relevance: state.relevance })); } catch (_) { /* ignore */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (ROLES[d.role]) state.role = d.role;
    state.org = String(d.org || '').slice(0, 40);
    state.project = String(d.project || '').slice(0, 100);
    state.notes = String(d.notes || '').slice(0, 5000);
    const r = Number(d.relevance);
    if (r >= 0.2 && r <= 0.8) state.relevance = r;
  } catch (_) { /* ignore */ }
}

/* ---------- navigation ---------- */
function goTo(n) {
  state.screen = n;
  for (let i = 1; i <= 4; i++) $(`screen${i}`).hidden = i !== n;
  document.querySelectorAll('.steps button, .drw-menu button, .bottom-nav button[data-step]').forEach((b) => {
    const i = Number(b.dataset.step);
    b.classList.toggle('active', i === n);
    b.classList.toggle('done', i < n);
  });
  $('appProgress').style.width = `${n * 25}%`;
  document.querySelectorAll('main > .screen:not([hidden])').forEach((s) => { s.classList.remove('screen-enter'); void s.offsetWidth; s.classList.add('screen-enter'); });
  syncDrawer();
  if (n === 2) renderFiles();
  if (n === 3) renderStep3();
  if (n === 4) renderReport();
  window.scrollTo({ top: 0 });
}
function tryGo(n) {
  if (n >= 3 && !(hasKind('spec') && hasKind('company'))) { toast('국방 규격서와 기업 자료를 모두 업로드해 주세요.', 'warn'); return goTo(2); }
  if (n === 4 && !state.results) { toast('먼저 대조 검사를 실행해 주세요.', 'warn'); return goTo(3); }
  goTo(n);
}
const hasKind = (k) => state.files.some((f) => f.kind === k && f.text.trim());
function syncDrawer() {
  $('drwRole').textContent = ROLES[state.role].name;
  $('drwProject').textContent = state.project || state.org || '-';
  $('drwSpec').textContent = `${state.files.filter((f) => f.kind === 'spec').length}개`;
  $('drwComp').textContent = `${state.files.filter((f) => f.kind === 'company').length}개`;
  $('drwCrit').textContent = `${critsOf(state.role).length}개 기준`;
}
function syncRole() {
  syncDrawer();
  $('roleBadge').textContent = `${ROLES[state.role].name} 구분${state.org ? ` · ${state.org}` : ''}`;
  $('setInfo').textContent = `적용 항목: ${SET_INFO[state.role]}${state.role === 'defense' ? ' · 국방 추가 19개는 실무 영역 정리이며 기품원 공식 조항이 아닙니다(공식 대조는 KDS STD-0005-1 원문 필요).' : ''}`;
}

/* ---------- step 1 ---------- */
function renderRoles() {
  $('roleGrid').innerHTML = Object.entries(ROLES).map(([k, r]) =>
    `<button type="button" class="company role ${k === state.role ? 'sel' : ''}" data-role="${k}"><span class="ptag">${k === state.role ? '선택됨' : '프로파일'}</span><em class="pkind">${k === 'defense' ? '방산 · 국방규격' : '기업 · 공공조달'}</em><strong class="big">${r.name}용 (${k === 'defense' ? '국방 47항목' : '기업 21항목'})</strong><small>${esc(r.desc)}</small></button>`).join('');
}

/* ---------- step 2: files ---------- */
async function addFiles(list, kind) {
  const files = Array.from(list);
  let ok = 0;
  for (const file of files) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const rec = { id: `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`, kind, name: file.name, size: file.size, ext, text: '', status: 'run', note: '파싱 중...' };
    state.files.push(rec);
    renderFiles();
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error(`파일이 너무 큽니다(최대 ${fmtBytes(MAX_FILE_BYTES)}).`);
      if (ext === 'pdf' || file.type === 'application/pdf') {
        const r = await extractPdf(file);
        rec.text = r.text;
        if (r.text.replace(/\s+/g, '').length < 30) { rec.status = 'warn'; rec.note = `${r.pages}페이지 · 추출된 텍스트가 거의 없습니다(스캔/이미지 PDF 가능성). OCR 후 업로드하세요.`; }
        else { rec.status = 'ok'; rec.note = `${r.pages}페이지 · ${r.text.length.toLocaleString()}자 추출${r.truncated ? ` (앞 ${MAX_PDF_PAGES}페이지만)` : ''}`; }
      } else if (TEXT_EXTS.includes(ext)) {
        rec.text = (await readText(file)).slice(0, MAX_TEXT_CHARS);
        rec.status = 'ok'; rec.note = `${rec.text.length.toLocaleString()}자 읽음`;
      } else {
        rec.status = 'warn'; rec.note = '이 형식은 텍스트를 추출할 수 없어 검사에서 제외됩니다. PDF(텍스트) 또는 TXT로 변환해 주세요.';
      }
      if (rec.status === 'ok') {
        const hits = detectSensitive(rec.text);
        if (hits.length) { rec.status = 'warn'; rec.note += ` · ⚠ 민감정보 의심: ${hits.join(', ')} — 해당 자료를 올리지 않는 것을 권장합니다(업로드한 원문은 서버에 저장하지 않으며 비교 후 폐기, 결과 문장만 기록에 저장).`; toast(`민감정보 의심 항목 발견: ${hits.join(', ')}`, 'warn'); }
        ok++;
      }
    } catch (err) {
      console.error(err);
      rec.status = 'bad'; rec.note = `읽기 실패: ${err.message || err}`;
    }
    renderFiles();
  }
  state.results = null; state.inspectedAt = null;
  toast(`${KIND_LABEL[kind]} ${files.length}개 처리 완료 (사용 가능 ${ok}개)`, ok ? 'success' : 'warn');
}

async function extractPdf(file) {
  if (!window.pdfjsLib) throw new Error('PDF 엔진(vendor/pdf.min.js)을 불러오지 못했습니다.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const last = Math.min(doc.numPages, MAX_PDF_PAGES);
  let text = '';
  for (let p = 1; p <= last; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let line = '';
    for (const it of content.items) { line += it.str; line += it.hasEOL ? '\n' : ' '; }
    text += `\n${line}`;
    if (text.length > MAX_TEXT_CHARS) break;
  }
  return { text: text.trim().slice(0, MAX_TEXT_CHARS), pages: doc.numPages, truncated: doc.numPages > last };
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''));
    r.onerror = () => reject(r.error || new Error('FileReader 오류'));
    r.readAsText(file, 'utf-8');
  });
}

function renderFiles() {
  syncDrawer();
  const label = { ok: '추출 완료', warn: '제한적', bad: '실패', run: '처리 중' };
  for (const kind of ['spec', 'company']) {
    const list = state.files.filter((f) => f.kind === kind);
    $(`${kind}Count`).textContent = list.length;
    $(`${kind}List`).innerHTML = list.length ? list.map((f) => `
      <div class="file">
        <div class="row between"><span class="name">${esc(f.name)}</span>
          <button class="btn small" type="button" data-remove="${f.id}">삭제</button></div>
        <div><span class="tag ${f.status}">${label[f.status]}</span> <span class="muted">${fmtBytes(f.size)}</span></div>
        <div class="muted">${esc(f.note)}</div>
      </div>`).join('') : '<p class="muted">업로드된 파일이 없습니다.</p>';
  }
  document.querySelectorAll('.zone').forEach((z) => z.classList.toggle('mine', (z.dataset.kind === 'spec') === (state.role === 'defense')));
}

const SAMPLE_SPEC = `1. 신뢰성
1.1 제어기의 평균고장간격(MTBF)은 10,000시간 이상이어야 한다.
1.2 고장모드영향분석(FMEA)을 수행하고 결과를 제출하여야 한다.
2. 환경시험
2.1 진동 및 온도 시험은 MIL-STD-810에 따라 수행하여야 한다.
2.2 동작 온도 범위는 -40℃ 이하부터 +70℃ 이상까지 만족하여야 한다.
3. 인터페이스
3.1 공급 전원은 28V DC 이어야 한다.
4. 형상 및 치수
4.1 주요 치수 공차는 ±0.05mm 이내이어야 한다.
5. 형상관리
5.1 모든 설계변경은 ECP 번호와 개정 이력을 관리하여야 한다.
6. 수출통제
6.1 전략물자 수출통제 해당 여부를 판정한 문서를 제출하여야 한다.
7. 품질
7.1 품질경영시스템은 AS9100 또는 ISO 9001 요구사항을 만족하여야 한다.
8. 품질경영
8.1 내부심사는 연 1회 이상 실시하여야 한다.
8.2 협력업체 평가 결과를 기록하고 보존하여야 한다.
8.3 부적합품은 식별하고 격리하여야 한다.`;

const SAMPLE_COMPANY = `[신뢰성 분석서]
제어기 평균고장간격(MTBF) 예측값은 14,500시간이며 고장모드영향분석(FMEA) 결과를 첨부하였다.
[환경시험 성적서]
진동 및 온도 시험은 MIL-STD-810 절차에 따라 수행하였고 결과는 합격이다.
동작 온도 범위는 -40℃ 부터 +65℃ 까지 시험하였다.
[인터페이스]
공급 전원은 28V DC 이며 커넥터 핀 할당을 정의하였다.
[치수 검사]
주요 치수 공차는 ±0.10mm 로 측정되었다.
[형상관리]
설계변경은 ECP-001, ECP-002 로 관리하며 개정 이력을 기록하였다.
[품질]
당사는 ISO 9001 인증 품질경영시스템을 운영한다.
내부심사는 연 2회 실시하였다.
협력업체 평가 결과를 기록하고 5년간 보존한다.`;

/* ---------- 텍스트 분석 ---------- */
/* ---------- 서버 API & 검사 (판정은 서버의 engine.js 가 수행) ---------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'spec-bridge', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty */ }
  if (res.status === 401 && state.user) { state.user = null; showAuth(); }
  if (!res.ok) throw new Error(data.error || `서버 오류(${res.status})`);
  return data;
}

async function runInspection() {
  if (state.inspecting) return;
  const specFiles = state.files.filter((f) => f.kind === 'spec' && f.text.trim());
  const compFiles = state.files.filter((f) => f.kind === 'company' && f.text.trim());
  if (!specFiles.length || !compFiles.length) { toast('국방 규격서와 기업 자료(텍스트 추출 가능)가 모두 필요합니다.', 'warn'); return; }
  state.inspecting = true; $('runBtn').disabled = true;
  $('progressBar').style.width = '40%';
  $('progressText').textContent = '서버에서 대조 중...';
  try {
    const data = await api('POST', '/api/inspect', {
      role: state.role, threshold: state.relevance, org: state.org, project: state.project, notes: state.notes,
      specFiles: specFiles.map(({ name, text }) => ({ name, text })), compFiles: compFiles.map(({ name, text }) => ({ name, text })),
    });
    state.results = data.result;
    state.inspectedAt = new Date(data.createdAt);
    $('progressBar').style.width = '100%';
    $('progressText').textContent = `대조 완료 · 요구사항 ${data.result.reqs.length}건 · ${state.inspectedAt.toLocaleString('ko-KR')} · 서버 처리 ${data.elapsedMs}ms · 기록 저장됨`;
    renderStep3();
    toast('대조 검사가 완료되었습니다.', 'success');
    loadHistory();
  } catch (err) {
    $('progressBar').style.width = '0';
    $('progressText').textContent = `검사 실패: ${err.message}`;
    toast(err.message, 'error');
  } finally {
    state.inspecting = false; $('runBtn').disabled = false;
  }
}

/* ---------- 구두 안내 (브라우저 음성합성) ---------- */
const TTS = 'speechSynthesis' in window;
const voiceText = (c) => `${c.code}. ${c.title}`;
function voiceStop() { if (TTS) speechSynthesis.cancel(); $('voiceStatus').textContent = '정지됨'; document.querySelectorAll('.voice-list li').forEach((l) => l.classList.remove('on')); }
function voiceSpeak(list, i) {
  if (i >= list.length) { $('voiceStatus').textContent = '재생 완료'; return; }
  const lis = document.querySelectorAll('.voice-list li');
  lis.forEach((l, k) => l.classList.toggle('on', k === i));
  $('voiceStatus').textContent = `${i + 1} / ${list.length} 재생 중`;
  const u = new SpeechSynthesisUtterance(voiceText(list[i]));
  u.lang = 'ko-KR';
  u.onend = () => { if (voiceSpeak.run === list) voiceSpeak(list, i + 1); };
  u.onerror = () => { $('voiceStatus').textContent = '음성 재생 오류'; };
  speechSynthesis.speak(u);
}
function openVoice() {
  const list = critsOf(state.role);
  $('voiceList').innerHTML = list.map((c, i) => `<li><button type="button" class="link" data-vi="${i}">${esc(voiceText(c))}</button></li>`).join('');
  $('voiceStatus').textContent = TTS ? '재생 대기' : '이 브라우저는 음성 안내를 지원하지 않습니다.';
  $('voicePanel').hidden = false;
}
function bindVoice() {
  $('voiceBtn').addEventListener('click', openVoice);
  $('voiceBtn2').addEventListener('click', openVoice);
  $('voiceBtn3').addEventListener('click', openVoice);
  $('voiceClose').addEventListener('click', () => { voiceStop(); $('voicePanel').hidden = true; });
  $('voiceStop').addEventListener('click', () => { voiceSpeak.run = null; voiceStop(); });
  $('voicePlayAll').addEventListener('click', () => { if (!TTS) return; speechSynthesis.cancel(); const l = critsOf(state.role); voiceSpeak.run = l; voiceSpeak(l, 0); });
  $('voiceList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vi]'); if (!b || !TTS) return;
    speechSynthesis.cancel(); const l = critsOf(state.role); voiceSpeak.run = null; voiceSpeak.run = [l[Number(b.dataset.vi)]]; voiceSpeak(voiceSpeak.run, 0);
  });
}

/* ---------- 로그인 / 기록 ---------- */
function showAuth() { $('authView').hidden = false; $('appView').hidden = true; }
function showApp() {
  $('authView').hidden = true; $('appView').hidden = false;
  $('userName').textContent = state.user;
  loadHistory();
}
async function loadHistory() {
  try {
    const list = await api('GET', '/api/inspections');
    $('historyList').innerHTML = list.length ? list.map((h) => `<li><button type="button" class="link" data-open="${esc(h.id)}">${esc(new Date(h.createdAt).toLocaleString('ko-KR'))} · ${esc(ROLES[h.role] ? ROLES[h.role].name : h.role)}${h.project ? ` · ${esc(h.project)}` : ''}</button> <small>요구 ${h.summary.reqs} · 충족 ${h.summary.met} · 보완 ${h.summary.rev} · 누락 ${h.summary.miss}</small> <button type="button" class="link danger" data-del="${esc(h.id)}">삭제</button></li>`).join('') : '<li class="muted">저장된 검사 기록이 없습니다.</li>';
  } catch (_) { /* 로그인 전 */ }
}
async function submitAuth(kind) {
  const username = $('authUser').value.trim(), password = $('authPass').value;
  $('authErr').textContent = '';
  try {
    const r = await api('POST', `/api/${kind}`, { username, password });
    state.user = r.username; $('authPass').value = ''; showApp();
  } catch (err) { $('authErr').textContent = err.message; }
}

function counts() {
  const r = state.results;
  const c = (arr, s) => arr.filter((x) => x.status === s).length;
  return {
    reqMet: c(r.reqs, 'MET'), reqRev: c(r.reqs, 'REVISION'), reqMiss: c(r.reqs, 'MISSING'), reqTotal: r.reqs.length,
    crMet: c(r.criteria, 'MET'), crRev: c(r.criteria, 'REVISION'), crMiss: c(r.criteria, 'MISSING'), crNa: c(r.criteria, 'NA'), crTotal: r.criteria.length,
  };
}

/* ---------- rendering ---------- */
function chips(id, items, current, onPick) {
  $(id).innerHTML = items.map(([v, l]) => `<button type="button" class="chip ${v === current ? 'active' : ''}" data-chip="${esc(v)}">${esc(l)}</button>`).join('');
  $(id).onclick = (e) => { const b = e.target.closest('[data-chip]'); if (b) onPick(b.dataset.chip); };
}
const domainItems = () => [['ALL', '전체'], ...[...new Set(curCrits().map((c) => c.domain))].map((d) => [d, d])];

function reqHtml(r) {
  const cls = STATUS_CLS[r.status];
  return `<div class="req">
    <div class="row between wrap"><span class="muted">${esc(r.file)} · 연관도 ${r.relevance.toFixed(2)}${r.quantitative ? '' : ' · 정량 비교 없음'}</span><span class="tag ${cls}">${STATUS_LABEL[r.status]}</span></div>
    <div class="q">규격: ${esc(r.text)}</div>
    ${r.evidence.length ? r.evidence.map((e) => `<div class="ev">기업 자료(${esc(e.file)}): ${esc(e.text)}</div>`).join('') : ''}
    ${r.issues.map((i) => `<div class="iss">• ${esc(i)}</div>`).join('')}
  </div>`;
}

function critCard(c, entry, detail, statusFilter) {
  const st = entry ? entry.status : null;
  const cls = st ? STATUS_CLS[st] : '';
  let reqs = entry ? entry.reqs : [];
  if (statusFilter && statusFilter !== 'ALL') reqs = reqs.filter((r) => r.status === statusFilter);
  const n = (s) => (entry ? entry.reqs.filter((r) => r.status === s).length : 0);
  const summary = !entry ? '' : st === 'NA'
    ? '<p class="muted">규격서에서 이 기준에 해당하는 요구가 추출되지 않아 판정에서 제외되었습니다.</p>'
    : `<p>규격 요구 ${entry.reqs.length}건 — <span class="ok">충족 ${n('MET')}</span> · <span class="warn">보완 ${n('REVISION')}</span> · <span class="bad">누락 ${n('MISSING')}</span></p>
       ${st === 'REVISION' ? `<p class="guide warn">${esc(c.revision)}</p>` : st === 'MISSING' ? `<p class="guide bad">${esc(c.missing)}</p>` : ''}`;
  const body = detail && entry && reqs.length ? `<details ${statusFilter !== 'ALL' ? 'open' : ''}><summary>요구사항별 대조 ${reqs.length}건</summary>${reqs.map(reqHtml).join('')}</details>` : '';
  return `<article class="crit ${st || ''}">
    <div class="row between wrap"><h3>${esc(c.id)} · ${esc(c.title)}</h3>${st ? `<span class="tag ${cls}">${STATUS_LABEL[st]}</span>` : ''}</div>
    <div class="meta">${esc(c.domain)} · ${esc(c.code)}</div>${summary}${body}</article>`;
}

function renderStep3() {
  syncRole();
  $('relRange').value = state.relevance; $('relVal').textContent = state.relevance.toFixed(2);
  const sc = state.files.filter((f) => f.kind === 'spec' && f.text.trim()).length;
  const cc = state.files.filter((f) => f.kind === 'company' && f.text.trim()).length;
  $('s3Info').textContent = `국방 규격서 ${sc}개 · 기업 자료 ${cc}개 (텍스트 추출 가능 파일)`;
  $('runBtn').disabled = state.inspecting || !sc || !cc;
  $('toScreen4').disabled = !state.results;
  chips('domainFilters', domainItems(), state.domainFilter, (d) => { state.domainFilter = d; renderStep3(); });
  const list = curCrits().filter((c) => state.domainFilter === 'ALL' || c.domain === state.domainFilter);
  $('criteriaList').innerHTML = list.map((c) => critCard(c, state.results && state.results.criteria.find((x) => x.id === c.id), false))  .join('');
}

function renderReport() {
  syncRole();
  const s = counts();
  $('s4Time').textContent = `검사 시각 ${state.inspectedAt.toLocaleString('ko-KR')} · 구분 ${ROLES[state.results.role].name} · 항목 ${state.results.crits.length}개 · 연관도 기준 ${state.results.threshold.toFixed(2)} · 규격 ${state.results.specFiles.length}개 / 기업자료 ${state.results.compFiles.length}개`;
  $('stats').innerHTML = [
    ['요구사항 총계', s.reqTotal, ''], ['충족', s.reqMet, 'ok'], ['보완 필요', s.reqRev, 'warn'], ['누락', s.reqMiss, 'bad'],
    ['기준 충족', `${s.crMet}/${s.crTotal - s.crNa}`, 'ok'], ['기준 판정 제외', s.crNa, ''],
  ].map(([l, v, c]) => `<div class="stat"><b class="${c}">${v}</b>${l}</div>`).join('');
  chips('statusFilters', [['ALL', '전체 상태'], ['MET', '충족'], ['REVISION', '보완 필요'], ['MISSING', '누락']], state.statusFilter, (v) => { state.statusFilter = v; renderReport(); });
  chips('reportFilters', domainItems(), state.domainFilter, (d) => { state.domainFilter = d; renderReport(); });
  const list = state.results.crits.filter((c) => state.domainFilter === 'ALL' || c.domain === state.domainFilter);
  let html = list.map((c) => {
    const e = state.results.criteria.find((x) => x.id === c.id);
    return state.statusFilter !== 'ALL' && e.status !== state.statusFilter && e.status !== 'REVISION' && e.status !== 'MISSING' && e.status !== 'MET' ? '' : critCard(c, e, true, state.statusFilter);
  }).join('');
  const other = state.results.other.filter((r) => state.statusFilter === 'ALL' || r.status === state.statusFilter);
  if (state.domainFilter === 'ALL' && other.length) html += `<article class="crit"><h3>기타 · 심사 항목에 분류되지 않은 규격 요구</h3><details><summary>${other.length}건</summary>${other.map(reqHtml).join('')}</details></article>`;
  $('reportList').innerHTML = html;
  $('notes').value = state.notes;
}

/* ---------- export ---------- */
function download(name, mime, content) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeName = () => (state.org || state.project || '리포트').replace(/[^\w가-힣.-]+/g, '_');

function exportTxt() {
  const s = counts();
  const L = ['[스펙 브릿지] 규격 대 기업자료 대조 검사 리포트', `구분: ${ROLES[state.role].name}`, `기관/기업: ${state.org || '-'}`, `사업명: ${state.project || '-'}`,
    `검사 시각: ${state.inspectedAt.toLocaleString('ko-KR')}`, `규격서: ${state.results.specFiles.join(', ')}`, `기업 자료: ${state.results.compFiles.join(', ')}`,
    `적용 항목 세트: ${SET_INFO[state.results.role]}`, `연관도 기준값: ${state.results.threshold.toFixed(2)}`,
    `요구사항 ${s.reqTotal}건: 충족 ${s.reqMet} / 보완 ${s.reqRev} / 누락 ${s.reqMiss}`, '※ 사전 점검 보조 결과이며 공식 적합 판정이 아닙니다.', ''];
  const dump = (r) => {
    L.push(`  - [${STATUS_LABEL[r.status]}] ${r.text} (${r.file})`);
    r.evidence.forEach((e) => L.push(`      기업자료(${e.file}): ${e.text}`));
    r.issues.forEach((i) => L.push(`      · ${i}`));
  };
  for (const c of state.results.crits) {
    const e = state.results.criteria.find((x) => x.id === c.id);
    L.push(`${c.id} [${STATUS_LABEL[e.status]}] ${c.title} (${c.domain})`);
    e.reqs.forEach(dump);
  }
  if (state.results.other.length) { L.push('기타(분류 외)'); state.results.other.forEach(dump); }
  if (state.notes.trim()) L.push('', '[보완 메모]', state.notes.trim());
  download(`스펙브릿지_리포트_${safeName()}.txt`, 'text/plain;charset=utf-8', L.join('\n'));
}

function exportJson() {
  const strip = (r) => ({ status: r.status, specText: r.text, specFile: r.file, relevance: Number(r.relevance.toFixed(3)), evidence: r.evidence, issues: r.issues });
  download(`스펙브릿지_리포트_${safeName()}.json`, 'application/json', JSON.stringify({
    role: state.role, org: state.org, project: state.project, inspectedAt: state.inspectedAt.toISOString(), relevanceThreshold: state.results.threshold,
    specFiles: state.results.specFiles, companyFiles: state.results.compFiles, summary: counts(), notes: state.notes,
    criteria: state.results.crits.map((c) => { const e = state.results.criteria.find((x) => x.id === c.id); return { id: c.id, title: c.title, domain: c.domain, code: c.code, status: e.status, requirements: e.reqs.map(strip) }; }),
    other: state.results.other.map(strip),
  }, null, 2));
}

/* ---------- events ---------- */
function bind() {
  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => tryGo(Number(b.dataset.step))));
  document.querySelector('[data-go]').addEventListener('click', () => goTo(1));
  $('roleGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-role]'); if (b) { state.role = b.dataset.role; state.results = null; state.domainFilter = 'ALL'; save(); renderRoles(); syncRole(); renderFiles(); } });
  $('profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.results = null;
    state.org = $('orgName').value.trim(); state.project = $('projectName').value.trim();
    save(); syncRole(); goTo(2);
  });
  for (const kind of ['spec', 'company']) {
    const input = $(`${kind}Input`), dz = document.querySelector(`[data-drop="${kind}"]`);
    input.addEventListener('change', async () => { const f = Array.from(input.files); input.value = ''; if (f.length) await addFiles(f, kind); });
    ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, kind); });
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    $(`${kind}List`).addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      state.files = state.files.filter((f) => f.id !== b.dataset.remove); state.results = null; renderFiles();
    });
  }
  $('sampleSpec').addEventListener('click', () => addFiles([new File([SAMPLE_SPEC], '샘플_국방규격.txt', { type: 'text/plain' })], 'spec'));
  $('sampleCompany').addEventListener('click', () => addFiles([new File([SAMPLE_COMPANY], '샘플_기업자료.txt', { type: 'text/plain' })], 'company'));
  $('clearFiles').addEventListener('click', () => { state.files = []; state.results = null; renderFiles(); });
  $('toScreen3').addEventListener('click', () => tryGo(3));
  $('runBtn').addEventListener('click', runInspection);
  $('toScreen4').addEventListener('click', () => tryGo(4));
  $('relRange').addEventListener('input', (e) => { state.relevance = Number(e.target.value); $('relVal').textContent = state.relevance.toFixed(2); save(); });
  $('rerun').addEventListener('click', () => { goTo(3); runInspection().then(() => state.results && goTo(4)); });
  $('dlTxt').addEventListener('click', exportTxt);
  $('dlJson').addEventListener('click', exportJson);
  $('notes').addEventListener('input', (e) => { state.notes = e.target.value; save(); });
  $('loginBtn').addEventListener('click', () => submitAuth('login'));
  $('registerBtn').addEventListener('click', () => submitAuth('register'));
  $('authForm').addEventListener('submit', (e) => { e.preventDefault(); submitAuth('login'); });
  $('logoutBtn').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch (_) { /* ignore */ } state.user = null; state.results = null; state.files = []; showAuth(); });
  $('historyList').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]'), del = e.target.closest('[data-del]');
    try {
      if (open) {
        const d = await api('GET', `/api/inspections/${open.dataset.open}`);
        state.results = d.result; state.role = d.result.role; state.inspectedAt = new Date(d.createdAt);
        state.org = d.org || ''; state.project = d.project || ''; renderRoles(); syncRole(); goTo(4);
      } else if (del && confirm('이 검사 기록을 삭제할까요?')) { await api('DELETE', `/api/inspections/${del.dataset.del}`); loadHistory(); }
    } catch (err) { toast(err.message, 'error'); }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!$('roleGrid')) return;
  load();
  $('orgName').value = state.org; $('projectName').value = state.project;
  renderRoles(); renderFiles(); syncRole(); bind(); bindVoice(); goTo(1);
  try { state.user = (await api('GET', '/api/me')).username; showApp(); } catch (_) { showAuth(); }
});
