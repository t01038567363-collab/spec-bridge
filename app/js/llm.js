/* OpenAI 호환 Chat Completions 어댑터. 모델·엔드포인트는 사용자가 직접 지정한다(기본값 없음).
 * 사용: window.SB_LLM = SB_LLM_ADAPTER.create({ endpoint, apiKey, model, fetchImpl? })
 * 판정에는 관여하지 않고, 판정 결과를 문장(summary/action)으로만 바꾼다. 출력은 engine.validateLlmDraft가 다시 검증한다.
 * 주의: 브라우저에 API 키를 두면 노출된다. 시연 전용이며 실제 운영에서는 서버 프록시를 거쳐야 한다. */
(function () {
  const SYSTEM = [
    '당신은 방산 규격 사전점검 결과를 설명하는 보조자입니다.',
    '입력 JSON의 results만 사용하고, 입력에 없는 수치·규격·조항을 만들지 마세요.',
    '"합격 보장", "승인 확정" 같은 단정 표현은 금지입니다.',
    '출력은 JSON만: {"items":[{"qid":"Q01","summary":"…","action":"…"}]} (입력의 모든 qid 포함).',
  ].join('\n');

  function create(cfg) {
    if (!cfg || !cfg.endpoint || !cfg.model) throw new Error('endpoint와 model을 지정하세요.');
    const f = cfg.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!f) throw new Error('fetch를 사용할 수 없습니다.');
    return async function llm(prompt) {
      const res = await f(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}) },
        body: JSON.stringify({
          model: cfg.model, temperature: 0, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(prompt) }],
        }),
      });
      if (!res.ok) throw new Error('LLM HTTP ' + res.status);
      const j = await res.json();
      const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (typeof content !== 'string') throw new Error('LLM 응답 형식 오류');
      return content;
    };
  }
  const api = { create, SYSTEM };
  if (typeof window !== 'undefined') window.SB_LLM_ADAPTER = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
