# Spec Bridge 앱 — 최종 실행 대상 (서버형 v2)

TRD v3(`TRD.md`) + 프로토타입 + TRD v2.0 PDF를 합친 앱입니다. **이 `app/` 폴더가 최종 버전**이며(`spec-bridge-v4/`는 별도 실험 구현으로 더 이상 사용하지 않음), 이제 **Node.js 서버가 TRD §3의 REST API(A1~A10)를 실제로 실행**합니다.

## 실행 방법
필요: Node.js 18 이상(설치할 패키지 없음).
```
cd app
node server.js          # http://127.0.0.1:3000
node test-server.js     # 서버 통합 테스트 23건
```
브라우저에서 http://127.0.0.1:3000 접속 → 기업 선택 → 파일 업로드(또는 샘플) → 사전검사 → 리포트. 환경변수: `PORT`, `HOST`, 선택적 LLM(`LLM_ENDPOINT`, `LLM_MODEL`, `LLM_API_KEY` — 키는 서버에만 보관, 미설정 시 템플릿 초안). `index.html`을 `file://`로 직접 열면 예전처럼 브라우저 내장 API로 시연 동작합니다(서버 없음).

테스트 페이지: 서버 실행 후 `/tests.html`(단위·API 41건), `/e2e.html`(화면 흐름 10건, 서버 API 경유).

## 범위: 구현된 것 vs 향후
| 구분 | 현재 | 향후 |
|---|---|---|
| API | `js/api.js`의 계약(경로·상태코드·오류 코드)을 `server.js`가 HTTP로 제공. 명세는 `openapi.yaml` | 필요 시 FastAPI 등으로 교체(UI·테스트 재사용) |
| 저장 | 세션은 **서버 메모리**(TTL 24시간, 1분마다 만료 정리), 판정 직후 UI가 삭제. 재시작하면 사라짐 | SQLite 등 영속 저장·보존 정책 |
| 토큰 | 세션별 무작위 토큰, 서버엔 SHA-256 해시만 보관(서버에서는 약한 해시 폴백 금지) | 사용자 계정·SSO |
| 보호 | CSRF 헤더+Origin 검사, 세션 생성 IP별 한도(10분 30회), 본문 256KB 제한, CSP·보안 헤더, 정적 파일 허용 목록, 값 없는 요청 로그 | TLS(리버스 프록시), 외부 보안 점검 |
| LLM | 서버가 호출(`js/llm.js`), 실패·검증 실패 시 템플릿 폴백 | 모델 확정·실호출 검증 |
| 문서 12항목 | 브라우저 안에서만 처리(문서 원문은 서버로 가지 않음) | 필요 시 서버 처리 |
| 규격 근거 | 후보값(원문 대조 0/10) | 원문 대조 후 `verified` |

## 구성
- `server.js` — HTTP 서버(정적 UI + `/api/*`), `test-server.js` — 서버 통합 테스트
- `index.html` / `js/app.js` — 4단계 UI(서버 모드는 fetch, file://는 내장 API)
- `js/data.js` — 기준 데이터: 문서 12항목, 수치 체크리스트 Q01~Q10, 샘플
- `js/engine.js` — 결정적 규칙 엔진, 초안 생성기, 금지 표현 필터, 민감정보 검사(고정 단어+주민번호·전화·이메일·사업자번호·비밀번호 패턴)
- `js/api.js` — REST 계약 구현(세션·토큰, Idempotency-Key, 상태 전이, 429, 25 s 타임아웃, 삭제 멱등, `mode` 세션별)
- `js/llm.js` — OpenAI 호환 어댑터
- `openapi.yaml`, `vendor/`(PDF.js 로컬), `tests.html`/`js/tests.js`, `e2e.html`


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
| 2026-11-27 | Node v22 + Edge, 서버 경유 | `node test-server.js` **23/23**, `/tests.html` **41/41**, `/e2e.html` **10/10** |
| 2026-11-27 | Edge(헤드리스), file:// | 이전 기록: `tests.html` 41/41, `e2e.html` 10/10 |

TRD TC-01~30 중 실제 SQLite 저장·서버 로그 파일 등 서버가 필요한 항목은 **미실행**입니다.

## 한계
- 규격 조항·쪽수와 Q01~Q03 값은 **미확정(가정)** 입니다. 공식 인증·심사가 아닙니다. 원문 대조 0/10.
- 실제 LLM 호출 결과는 검증하지 않았습니다(어댑터는 모의 fetch로만 테스트). 세션이 메모리라 서버 재시작 시 사라지고, 다중 인스턴스는 지원하지 않습니다. HTTPS·사용자 인증은 없으므로 외부 공개 시 리버스 프록시(TLS)와 보안 점검이 필요합니다.
- 민감어 검사는 작은 고정 사전이라 보조 방어선일 뿐입니다. 가상 데이터만 입력하세요.
- 스캔 PDF는 텍스트를 읽지 못합니다(OCR 없음).
