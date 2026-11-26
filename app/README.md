# Spec Bridge 앱 (MVP 시연용)

TRD v3(`TRD.md`) + 프로토타입(`spec_bridge.html`) + TRD v2.0 PDF를 합친 **클라이언트 전용 웹앱**입니다. 빌드·서버 없이 `index.html`을 브라우저로 열면 됩니다.

## 범위: 시연(MVP) vs 향후
| 구분 | MVP(이 앱) | 향후 서버 단계 |
|---|---|---|
| API | TRD §3의 A1~A10을 **브라우저 안**(`js/api.js`)에서 동일한 경로·상태코드·오류 코드로 구현, UI도 이 API를 거쳐 판정. 명세는 `openapi.yaml` | FastAPI로 같은 계약 구현(UI·테스트 재사용) |
| 저장 | 세션을 메모리에만 보관(TTL 24시간), 판정 직후 UI가 세션 삭제 | SQLite, 보존·삭제 정책 |
| 토큰 | SHA-256 해시만 보관(crypto.subtle 불가 시 비암호학적 폴백) | 서버 측 저장, 전송 구간 TLS |
| LLM | `js/llm.js` OpenAI 호환 어댑터(모델·엔드포인트는 사용자가 지정, 기본값 없음). 미설정 시 템플릿 | 모델 확정, 키는 서버 프록시에 보관 |
| 규격 근거 | 후보값(원문 대조 0/10) | 원문 대조 후 `verified` |

## 구성
- `index.html` / `js/app.js` — 4단계 UI, TXT·JSON·복사 내보내기
- `js/data.js` — 기준 데이터: 문서 12항목, 수치 체크리스트 Q01~Q10, 샘플 답변·문서
- `js/engine.js` — 결정적 규칙 엔진, 초안 생성기, 금지 표현 필터
- `js/api.js` — REST 계약 구현(세션·토큰, Idempotency-Key, 상태 전이, 429 한도 5회/10분, 초안 25 s 타임아웃, 삭제 멱등)
- `js/llm.js` — LLM 어댑터(타임아웃·재시도·출력 검증은 engine이 담당, 실패 시 템플릿 폴백)
- `openapi.yaml` — API 명세(타입·필수·제약·오류 응답)
- `vendor/` — PDF.js 로컬 사본(오프라인 PDF 읽기)
- `tests.html` / `js/tests.js` — 단위·API·어댑터 테스트 41건, `e2e.html` — 화면 흐름 10건

## 두 가지 검사
1. **A. 문서 12항목**: 키워드 3개 이상 충족 / 1~2개 보완 / 0개 누락. 가중치 합(105)을 100점으로 정규화. 근거가 없으면 판정을 만들지 않고 누락 처리.
2. **B. 수치 10문항**: 값·단위·증빙을 규칙으로 대조해 충족 / 미흡 / 확인 필요 판정. AI는 판정에 관여하지 않고 초안 문장만 만듭니다.

## 정책 모드
- `demo`: 후보 기준값으로 시연 판정(“원문 대조 전” 표기). 기업 A → 충족 6 · 미흡 2 · 확인 필요 2
- `strict`: `source_status: 'unverified'` 문항은 전부 확인 필요
- 원문 대조 후 `js/data.js`의 `source`에 실제 조항·쪽수를 넣고 `source_status`를 `'verified'`로 바꾸면 strict에서도 판정됩니다.

## LLM 연결(선택)
```html
<script>window.SB_LLM = SB_LLM_ADAPTER.create({ endpoint: '…/v1/chat/completions', apiKey: '…', model: '…' });</script>
```
`app.js` 로드 전에 넣습니다. 키가 브라우저에 노출되므로 시연 전용입니다.

## 테스트 실행 기록
`tests.html`, `e2e.html`을 열거나 헤드리스 Edge로 실행: `msedge --headless=new --dump-dom file:///…/app/tests.html`(제목의 RESULT 확인)

| 일자 | 환경 | 결과 |
|---|---|---|
| 2026-11-27 | Edge(헤드리스), Windows | `tests.html` **41/41**, `e2e.html` **10/10** |

TRD TC-01~30 중 실제 SQLite 저장·서버 로그 파일 등 서버가 필요한 항목은 **미실행**입니다.

## 한계
- 규격 조항·쪽수와 Q01~Q03 값은 **미확정(가정)** 입니다. 공식 인증·심사가 아닙니다. 원문 대조 0/10.
- 실제 FastAPI·DB 서버는 포함하지 않습니다. 실제 LLM 호출 결과는 검증하지 않았습니다(어댑터는 모의 fetch로만 테스트).
- 민감어 검사는 작은 고정 사전이라 보조 방어선일 뿐입니다. 가상 데이터만 입력하세요.
- 스캔 PDF는 텍스트를 읽지 못합니다(OCR 없음).
