/* Spec Bridge: browser-only document pre-check UI. Document contents stay in the browser. */
(function () {
  'use strict';
  const D = window.SB_CHECKLISTS;
  const E = window.SB_ENGINE;
  const S = { step:1, type:'dqms', files:[], result:null, filter:'ALL' };
  const $ = (s, root=document) => root.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const allCriteria = () => S.type === 'dqms' ? [...D.dqms.base, ...D.dqms.extra] : D.iso.items;
  const stepNames = ['심사 기준 선택','자료 업로드','사전 점검','결과 리포트'];
  let toastTimer;
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }
  function banner() {
    $('#banner').innerHTML = `⚠ <b>공식 인증·심사가 아닌 사전 점검 보조 도구</b>입니다. 문서는 브라우저에서만 처리되며 서버로 업로드되지 않습니다. 기밀·개인정보 대신 가상 자료를 사용하세요.`;
  }
  function stepper() {
    $('#stepper').innerHTML = stepNames.map((name,i) => `<button type="button" class="${S.step===i+1?'on':''}" data-step="${i+1}" aria-current="${S.step===i+1?'step':'false'}">${i+1}. ${name}</button>`).join('');
    $('#stepper').querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => go(Number(b.dataset.step))));
  }
  function go(n) {
    if (n >= 2 && !S.type) return toast('먼저 심사 기준을 선택하세요.');
    if (n === 3 && !S.files.length) return toast('검사할 자료를 업로드하거나 샘플을 추가하세요.');
    if (n === 4 && !S.result) return toast('먼저 사전 점검을 실행하세요.');
    S.step=n; render(); window.scrollTo({top:0,behavior:'smooth'});
  }
  function criteriaSummary() {
    return S.type === 'dqms'
      ? `<p><b>ISO 9001 기반 조항: ${D.dqms.base.length}개 표시</b> · 국방 추가 실무영역: ${D.dqms.extra.length}개</p><p class="mut">제공된 ISO 조항 목록은 4~10항의 28개 조항입니다. DQMS 기본 요구사항 51개 전체를 구성하는 세부 요구문은 제공되지 않아 임의로 만들어 넣지 않았습니다.</p>`
      : `<p><b>일반 기업용 실무 요약: ${D.iso.items.length}개</b></p><p class="mut">제공하신 표를 기준으로 정리한 이해용 묶음이며 ISO 9001 공식 조항 전체를 그대로 옮긴 목록은 아닙니다.</p>`;
  }
  function view1() {
    return `<section class="card"><h2>어떤 기준으로 점검할까요?</h2><p class="mut">검사 대상에 맞는 목록을 선택하세요. 이 선택은 현재 브라우저 탭에서만 사용됩니다.</p>
      <div class="row"><label><input type="radio" name="checkType" value="dqms" ${S.type==='dqms'?'checked':''}> 국방용 DQMS 사전점검</label><label><input type="radio" name="checkType" value="iso" ${S.type==='iso'?'checked':''}> 일반 기업용 ISO 9001 실무 요약</label></div>
      ${criteriaSummary()}<div class="item"><b>목록 사용 시 주의</b><p>${esc(D.disclaimer)}</p></div><button class="btn" id="next1" type="button">자료 업로드로 →</button></section>`;
  }
  function view2() {
    const list = S.files.length ? `<ul>${S.files.map(f=>`<li>${esc(f.name)} <span class="mut">(${f.extractedText ? `${f.extractedText.length.toLocaleString()}자 추출` : '텍스트 없음'})</span></li>`).join('')}</ul>` : '<p class="mut">아직 파일이 없습니다.</p>';
    return `<section class="card"><h2>자료 업로드</h2><p>검사 대상 기준: <b>${esc(D[S.type].name)}</b></p>
      <p class="mut">TXT·MD·CSV·JSON 및 텍스트 PDF를 지원합니다. PDF는 최대 25쪽까지 읽습니다. 파일당 최대 30MB. 스캔 PDF는 OCR을 지원하지 않습니다. 파일 내용은 브라우저 안에서만 처리합니다.</p>
      <label class="drop" id="drop" for="fileInput"><strong>파일을 선택하거나 이곳에 끌어놓으세요</strong><br><span class="mut">PDF · TXT · MD · CSV · JSON</span><input id="fileInput" class="hide" type="file" multiple accept=".pdf,.txt,.md,.csv,.json"></label>
      <div class="row"><button class="btn sec" id="sample" type="button">가상 샘플 자료</button><button class="btn sec" id="clear" type="button">자료 비우기</button></div>${list}
      <div class="row"><button class="btn sec" id="back1" type="button">← 기준 선택</button><button class="btn" id="next2" type="button">점검으로 →</button></div></section>`;
  }
  function view3() {
    const c=allCriteria();
    return `<section class="card"><h2>문서 사전 점검</h2><p class="mut">항목의 핵심어가 문서에 나타나는지 확인합니다. 이는 문장 의미, 실제 이행, 증빙의 유효성 또는 적합성을 검증하지 않습니다. 원문과 담당자 확인이 필요합니다.</p>
      <p class="mut">기준: 3개 이상 키워드 확인=충족(키워드 기준), 1~2개=보완 필요, 0개=근거 미확인. 판정 상태는 적합성 인증 결과가 아닙니다.</p>
      <p>선택 기준 <b>${esc(D[S.type].name)}</b> · 점검 항목 <b>${c.length}</b>개 · 업로드 파일 <b>${S.files.length}</b>개</p>
      <div class="row"><button class="btn" id="run" type="button">검사 실행</button><button class="btn sec" id="back2" type="button">← 자료 업로드</button></div>
      ${S.result ? `<div class="stats"><div class="stat"><b>${S.result.summary.score}</b>키워드 지표*</div><div class="stat"><b>${S.result.summary.met}</b>키워드 다수 확인</div><div class="stat"><b>${S.result.summary.revision}</b>일부 확인</div><div class="stat"><b>${S.result.summary.missing}</b>미확인</div></div><p class="mut">*점수는 문서 키워드 일치 정도를 단순 집계한 참고값이며 인증 점수·합격률이 아닙니다.</p><div class="row"><button class="btn" id="next3" type="button">리포트 보기 →</button></div>` : '<p class="mut">검사 실행 후 항목별 키워드 결과가 여기에 표시됩니다.</p>'}</section>
      ${S.result ? `<section class="card"><h2>항목별 미리보기</h2>${S.result.results.slice(0,8).map((r,i)=>renderItem(c[i],r)).join('')}${c.length>8?`<p class="mut">나머지 항목은 결과 리포트에서 확인할 수 있습니다.</p>`:''}</section>`:''}`;
  }
  function renderItem(c,r) {
    const status={MET:'키워드 확인',REVISION:'일부 확인',MISSING:'미확인'}[r.status];
    return `<article class="item s-${r.status}"><span class="tag ${r.status}">${status}</span> <b>${esc(c.code)} · ${esc(c.title)}</b><div class="mut">${esc(c.domain)} · ${esc(c.rule)}</div><div>확인된 키워드: ${r.matchedKeywords.length?esc(r.matchedKeywords.join(', ')):'없음'}</div></article>`;
  }
  function reportText() {
    const c=allCriteria(), lines=[`스펙 브릿지 사전점검 리포트`,`기준: ${D[S.type].name}`,`생성: ${new Date().toLocaleString('ko-KR')}`,`파일: ${S.files.map(f=>f.name).join(', ')}`,`키워드 지표: ${S.result.summary.score} (인증 점수 아님)`,``,D.disclaimer,''];
    S.result.results.forEach((r,i)=>lines.push(`[${{MET:'키워드 확인',REVISION:'일부 확인',MISSING:'미확인'}[r.status]}] ${c[i].code} ${c[i].title}`,`영역: ${c[i].domain}`,`내용: ${c[i].rule}`,`확인 키워드: ${r.matchedKeywords.join(', ')||'없음'}`,`권고: ${r.status==='MET'?c[i].metBasis:r.status==='REVISION'?c[i].revisionGuide:c[i].missingGuide}`,'---'));
    lines.push('본 결과는 공식 심사·인증 판정이 아닙니다. 실제 기준 원문과 증빙을 담당자가 확인해야 합니다.');
    return lines.join('\n');
  }
  function view4() {
    const c=allCriteria(), flt=(r)=>S.filter==='ALL'||r.status===S.filter;
    return `<section class="card"><h2>사전점검 리포트</h2><p>${esc(D[S.type].name)} · ${new Date().toLocaleString('ko-KR')}</p>
      <div class="stats"><div class="stat"><b>${S.result.summary.score}</b>키워드 지표*</div><div class="stat"><b>${S.result.summary.met}</b>키워드 확인</div><div class="stat"><b>${S.result.summary.revision}</b>일부 확인</div><div class="stat"><b>${S.result.summary.missing}</b>미확인</div></div>
      <p class="mut">*참고용 키워드 집계이며 공식 인증 점수나 적합 판정이 아닙니다.</p><div class="item"><b>중요한 범위 안내</b><p>${esc(D.disclaimer)}</p></div>
      <div class="row"><button class="btn" id="downloadTxt" type="button">TXT 다운로드</button><button class="btn sec" id="downloadJson" type="button">JSON 다운로드</button><button class="btn sec" id="back3" type="button">← 점검으로</button><button class="btn" id="rerun" type="button">다시 검사</button></div>
      <div class="row" aria-label="결과 필터">${[['ALL','전체'],['MET','키워드 확인'],['REVISION','일부 확인'],['MISSING','미확인']].map(([v,n])=>`<button class="btn ${S.filter===v?'':'sec'}" type="button" data-filter="${v}">${n}</button>`).join('')}</div></section>
      <section class="card"><h2>항목별 결과 (${S.result.results.filter(flt).length}/${c.length})</h2>${S.result.results.map((r,i)=>flt(r)?renderItem(c[i],r):'').join('')}</section>`;
  }
  async function readFile(file) {
    if(file.size>30*1024*1024){toast(`${file.name}: 30MB 제한을 초과했습니다.`);return null;}
    const ext=file.name.split('.').pop().toLowerCase();
    if(['txt','md','csv','json'].includes(ext)) return {name:file.name,size:file.size,extractedText:await file.text()};
    if(ext==='pdf') {
      if(!window.pdfjsLib){toast('PDF.js를 불러오지 못했습니다. PDF.js 파일을 확인하세요.');return null;}
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js';
        const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise; let text='';
        for(let p=1;p<=Math.min(pdf.numPages,25);p++){const page=await pdf.getPage(p);const content=await page.getTextContent();text+=content.items.map(x=>x.str).join(' ')+'\n';}
        if(!text.trim()) toast(`${file.name}: 읽을 수 있는 텍스트가 없습니다. 스캔본은 OCR이 필요합니다.`);
        return {name:file.name,size:file.size,extractedText:text};
      } catch(e){toast(`${file.name}: PDF를 읽지 못했습니다.`);return null;}
    }
    toast(`${file.name}: 지원하지 않는 형식입니다.`);return null;
  }
  async function addFiles(files) {
    for(const f of files){const parsed=await readFile(f);if(parsed)S.files.push(parsed);}
    S.result=null;render();
  }
  function sampleDocs() {
    const terms=allCriteria().flatMap(c=>c.keywords).join(' · ');
    S.files=[{name:`${S.type==='dqms'?'DQMS':'ISO'}_가상_샘플.txt`,size:terms.length,extractedText:`[가상 데모 자료 — 실제 증빙이 아닙니다]\n${terms}`}];
    S.result=null;render();toast('가상 키워드 데모 자료를 추가했습니다. 실제 심사 증빙으로 사용하지 마세요.');
  }
  function bind() {
    if(S.step===1){document.querySelectorAll('[name="checkType"]').forEach(r=>r.addEventListener('change',()=>{S.type=r.value;S.files=[];S.result=null;render();}));$('#next1').onclick=()=>go(2);}
    if(S.step===2){const input=$('#fileInput'),drop=$('#drop');input.onchange=e=>addFiles([...e.target.files]);drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');addFiles([...e.dataTransfer.files]);};$('#sample').onclick=sampleDocs;$('#clear').onclick=()=>{S.files=[];S.result=null;render();};$('#back1').onclick=()=>go(1);$('#next2').onclick=()=>go(3);}
    if(S.step===3){$('#back2').onclick=()=>go(2);$('#run').onclick=()=>{S.result=E.evaluateDocuments(allCriteria(),S.files);render();toast('키워드 기반 사전점검을 완료했습니다. 각 근거와 원문을 확인하세요.');};if($('#next3'))$('#next3').onclick=()=>go(4);}
    if(S.step===4){$('#back3').onclick=()=>go(3);$('#rerun').onclick=()=>go(3);$('#downloadTxt').onclick=()=>download('spec-bridge-report.txt',reportText(),'text/plain;charset=utf-8');$('#downloadJson').onclick=()=>download('spec-bridge-report.json',JSON.stringify({checklist:S.type,checklistName:D[S.type].name,generatedAt:new Date().toISOString(),files:S.files.map(f=>f.name),summary:S.result.summary,results:S.result.results,disclaimer:D.disclaimer},null,2),'application/json;charset=utf-8');document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{S.filter=b.dataset.filter;render();});}
  }
  function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function render(){banner();stepper();$('#view').innerHTML=[null,view1,view2,view3,view4][S.step]();bind();}
  render();
})();
