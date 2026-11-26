/* 기준 데이터(Ground Truth).
 * - CRITERIA: 문서 기반 사전검사 12항목 (spec_bridge.html 기준, TRD v2.0 §3.1)
 * - QUESTIONS: 수치 체크리스트 10문항 (TRD.md §2.3, 가상 기업 A)
 * Q01~Q03 값은 PRD에 없는 [가정값]이며, 모든 source는 원문 대조 전(unverified)이다.
 * 원문을 확인하면 source의 clause/page를 실제 값으로 바꾸고 source_status를 'verified'로 바꾼다. */
(function (root) {
  const C = (id, domain, code, title, severity, weight, rule, keywords, g) => ({
    id, domain, code, title, severity, weight, rule, keywords, ...g,
  });

  const CRITERIA = [
    C('CRIT-01', '국방규격서 및 도면 일치성', 'KDS / MIL-STD-100', '국방규격서(KDS) 기술사양 및 치수·공차 일치성', 'CRITICAL', 10,
      '규격서 본문 사양과 도면/BOM의 치수, 공차(GD&T), 재질 등급 및 단위계가 상호 모순 없이 일치해야 합니다.',
      ['kds', '국방규격', '치수', '공차', '도면', 'mil-std', '사양', '재질', 'bom'], {
        metBasis: '국방규격서 기술사양과 도면·BOM의 치수/공차 및 재질 등급이 일관되게 명시되어 있습니다.',
        revisionCurrent: '규격서 주요 사양은 있으나 일부 공차(±), 표면거칠기 또는 단위 표기가 누락·혼재되어 있습니다.',
        revisionGuide: '도면 주석과 규격서 요구사항의 치수·공차·재질 규격을 1:1 대조표로 맞추고 공차 기준(ISO 2768 등)을 명시하세요.',
        missingDoc: '국방규격서 사양 대조표 및 승인 도면(치수·공차) 증빙 미확인',
        missingGuide: '규격서 번호/개정일자, 주요 치수·공차 사양서, 재질 시험성적 연계표를 제출하세요.',
        missingDeadline: '기술검토회의(TRR) 5영업일 전까지 제출',
      }),
    C('CRIT-02', '국방규격서 및 도면 일치성', 'SPEC-INTERFACE', '체계 간 인터페이스(ICD) 및 커넥터·전원 규격 적합성', 'HIGH', 8,
      '연동 장비와의 기계적·전기적·통신 인터페이스(핀맵, 전압, 프로토콜)가 규격 기준에 부합해야 합니다.',
      ['인터페이스', 'icd', '커넥터', '전원', '통신', '전압', '신호', '연동'], {
        metBasis: 'ICD의 전기적 입출력, 커넥터 핀 할당 및 신호 사양이 명확히 정의되어 있습니다.',
        revisionCurrent: '인터페이스 개략도는 있으나 허용 전압·전류 또는 커넥터 환경등급 수치가 불완전합니다.',
        revisionGuide: '정상·비상 동작 범위의 전기적 한계치와 커넥터 결합력·접촉저항 기준을 정량 수치로 보완하세요.',
        missingDoc: '인터페이스 제어문서(ICD) 또는 전기·기계 연동 규격서 누락',
        missingGuide: 'ICD와 핀맵/커넥터 규격서를 제출하세요.',
        missingDeadline: '상세설계검토(CDR) 이전 제출',
      }),
    C('CRIT-03', '형상관리 및 설계변경(ECP)', 'MIL-HDBK-61 / ECP', '형상식별(CI) 및 설계변경 제안서(ECP) 추적성', 'CRITICAL', 10,
      '형상식별목록(CIL)과 설계변경 이력이 문서 번호·개정 차수·승인 일자 기준으로 추적 가능해야 합니다.',
      ['형상관리', '형상식별', 'ecp', '설계변경', '개정', 'rev', 'cil', '이력'], {
        metBasis: '형상식별 항목과 설계변경 이력이 버전·변경 사유와 함께 기록되어 있습니다.',
        revisionCurrent: '버전/개정 표기는 있으나 변경 사유(ECP 번호) 또는 영향도 분석이 일부 생략되었습니다.',
        revisionGuide: '모든 변경 항목에 ECP/변경관리 ID, 변경 전·후 비교, 규격 영향성 검토 결과를 기입하세요.',
        missingDoc: '형상식별목록(CIL) 및 설계변경(ECP) 관리 증빙 미제출',
        missingGuide: '형상식별목록과 설계변경 이력대장(또는 변경 없음 확인서)을 제출하세요.',
        missingDeadline: '형상감사(FCA/PCA) 착수 전 제출',
      }),
    C('CRIT-04', '형상관리 및 설계변경(ECP)', 'TRACE-MATRIX', '요구사항 추적성 매트릭스(RTM) 및 식별표기 기준', 'MEDIUM', 7,
      '상위 요구사항이 설계·시험·검증 항목과 양방향 추적되며 품목 식별표기 기준이 포함되어야 합니다.',
      ['추적성', 'rtm', '식별표기', '명판', '시리얼', 'uid', '요구사항', '추적'], {
        metBasis: '요구사항별 검증 연결성과 명판/시리얼 식별표기 기준이 확인됩니다.',
        revisionCurrent: '요구사항은 나열되어 있으나 시험/검사 항목과의 1:1 매핑 또는 명판 표기 위치가 모호합니다.',
        revisionGuide: '요구사항 ID별 설계 산출물·검증 증빙(ATP/QTR) 연결표를 작성하고 명판 각인 항목을 명시하세요.',
        missingDoc: '요구사항 추적성 증빙 및 품목 식별표기 기준 누락',
        missingGuide: '요구사항 추적표(RTM)와 품목 식별표기 준수 내역을 제출하세요.',
        missingDeadline: '초도생산품검사(FAI) 이전 제출',
      }),
    C('CRIT-05', '품질경영 및 검사성적서(ATP/QTR)', 'KQP / AS9100 / ISO9001', '품질경영시스템(KQP/AS9100) 및 품질보증계획서 준수', 'CRITICAL', 10,
      'KQP 또는 AS9100/ISO 9001 기반 품질관리 체계와 공정관리 기준이 명시되어야 합니다.',
      ['kqp', '품질', 'as9100', 'iso 9001', 'iso9001', '품질보증', '공정관리', '불량'], {
        metBasis: '품질경영시스템 기준과 공정 품질관리·부적합 처리 절차가 확인됩니다.',
        revisionCurrent: '품질관리 방침은 있으나 특수공정 관리 기준이나 부적합품 격리·폐기 절차가 구체화되지 않았습니다.',
        revisionGuide: '특수공정 관리 항목, 수입·공정·출하 검사 기준 및 부적합품 처리 절차를 보완하세요.',
        missingDoc: '품질보증계획서(QAP) 또는 KQP/AS9100 품질증빙 누락',
        missingGuide: '품질보증계획서와 품질경영시스템 인증/자체 품질관리 기준서를 제출하세요.',
        missingDeadline: '계약 이행 착수 및 품질검토 시 제출',
      }),
    C('CRIT-06', '품질경영 및 검사성적서(ATP/QTR)', 'ATP / QTR', '수락시험절차서(ATP) 및 품질인증시험(QTR) 성적서 증빙', 'CRITICAL', 10,
      '요구 항목에 대한 ATP/QTR의 시험항목·판정기준·성적서 데이터가 확보되어야 합니다.',
      ['atp', 'qtr', '시험성적서', '수락시험', '품질인증', '검사성적서', '판정기준', '시험'], {
        metBasis: 'ATP/QTR의 시험 항목, 기준치 및 성적서 내역이 확인됩니다.',
        revisionCurrent: '일부 시험 항목은 있으나 판정 기준치, 측정 불확도 또는 장비 교정 정보가 누락되었습니다.',
        revisionGuide: '시험 항목별 요구치, 실측값, 판정 결과 및 교정된 계측기 정보를 함께 기재하세요.',
        missingDoc: 'ATP/QTR 시험성적서 또는 검증 계획·결과 증빙 미제출',
        missingGuide: '필수 시험항목에 대한 ATP/QTR 시험성적서(또는 시험계획 및 결과서)를 제출하세요.',
        missingDeadline: '정부품질보증관 입회/서류심사 전 제출',
      }),
    C('CRIT-07', '신뢰성·환경시험 및 고장분석', 'MIL-STD-810 / ESS', '환경시험(MIL-STD-810) 및 환경스트레스스크리닝(ESS) 기준', 'HIGH', 9,
      '온도·습도·진동·충격 등 운용 환경조건과 양산 단계 ESS 기준이 반영되어야 합니다.',
      ['mil-std-810', '환경시험', 'ess', '진동', '충격', '온도', '습도', '스크리닝'], {
        metBasis: '운용 환경시험 및 ESS 조건과 적용 기준이 명시되어 있습니다.',
        revisionCurrent: '온도 또는 진동 시험 언급은 있으나 노출 시간, 진동 스펙트럼 또는 ESS 적용 대상 비율이 불명확합니다.',
        revisionGuide: '온도 범위, 체류 시간, 진동·충격 프로파일 및 ESS 적용 범위를 구체화하세요.',
        missingDoc: '환경시험 및 ESS 시험계획/결과 증빙 누락',
        missingGuide: '환경시험 기준서(또는 결과서)와 ESS 적용 계획을 제출하세요.',
        missingDeadline: '개발시험평가 및 초도양산 전 제출',
      }),
    C('CRIT-08', '신뢰성·환경시험 및 고장분석', 'MTBF / FMEA / FRACAS', '신뢰성(MTBF), 고장모드영향분석(FMEA) 및 FRACAS 체계', 'HIGH', 8,
      '목표 신뢰도 산출 근거, FMEA 위험도 분석, 고장보고·분석·시정조치 절차가 갖추어져야 합니다.',
      ['mtbf', '신뢰성', 'fmea', 'fracas', '고장분석', '시정조치', '위험도'], {
        metBasis: '신뢰성 지표와 고장분석(FMEA) 또는 FRACAS 체계가 확인됩니다.',
        revisionCurrent: '신뢰성 목표 또는 고장분석 개념은 있으나 근본원인 분석 및 시정조치 기한·담당 기준이 부족합니다.',
        revisionGuide: '고장 현상·원인·영향·시정조치와 재발방지 검증 기준을 명확히 기재하세요.',
        missingDoc: '신뢰성, FMEA 및 FRACAS 증빙 문서 미제출',
        missingGuide: '신뢰성 예측/평가서, FMEA 결과 및 FRACAS 운영 절차/이력을 제출하세요.',
        missingDeadline: '신뢰성인증시험 심의 전 제출',
      }),
    C('CRIT-09', '원산지·국산화율 및 부품단종(DMSMS)', 'LOCALIZATION / COO', '원산지 증명 및 국산화율 산정 기준', 'HIGH', 8,
      '주요 자재·부품의 원산지 정보와 국산화율 산정 근거가 제시되어야 합니다.',
      ['원산지', '국산화', '국산화율', '국내생산', '절충교역', '부품', '조달'], {
        metBasis: '원산지 및 국산화율 산정 기준 또는 국내 조달 구성 내역이 확인됩니다.',
        revisionCurrent: '국산화 또는 원산지 항목은 있으나 품목별 산정 산식이나 원산지 확인서 근거가 미비합니다.',
        revisionGuide: '품목별 원가/물량 기준 국산화율 산정 근거와 원산지 소명 자료를 보완하세요.',
        missingDoc: '원산지 확인서 및 국산화율 산정 증빙 누락',
        missingGuide: '주요 구성품 원산지 내역 및 국산화율 산정표를 제출하세요.',
        missingDeadline: '원가 및 규격 적합성 검토 시 제출',
      }),
    C('CRIT-10', '원산지·국산화율 및 부품단종(DMSMS)', 'DMSMS / OBSOLESCENCE', '부품단종(DMSMS) 예방 및 대체부품 적격성 관리', 'MEDIUM', 7,
      '단종 리스크 식별 및 대체부품의 기술적 적격성 검토 기준이 필요합니다.',
      ['단종', 'dmsms', 'obsolescence', '대체부품', '수명', '부품단종'], {
        metBasis: '부품단종 모니터링 및 대체부품 검토·승인 절차가 반영되어 있습니다.',
        revisionCurrent: '단종 대응 원칙은 있으나 대체부품 규격 동등성 검토 및 재시험 기준이 구체적이지 않습니다.',
        revisionGuide: '단종 위험 품목 식별 기준, 대체부품 선정 절차 및 재검증 기준을 명시하세요.',
        missingDoc: '부품단종 관리 계획 또는 대체부품 검토서 누락',
        missingGuide: 'DMSMS 관리 방안 및 대체품 승인 절차를 제출하세요.',
        missingDeadline: '양산 단계 규격 유지관리 심의 전 제출',
      }),
    C('CRIT-11', '보안·자료보호 및 수출통제', 'DEFENSE-SEC / CLASSIFICATION', '군사보안·방산기술보호 및 문서 등급·열람 통제 준수', 'CRITICAL', 10,
      '비밀/대외비/기술자료 등급 표기, 접근통제 및 반출 기준이 준수되어야 합니다.',
      ['보안', '기술보호', '비밀', '대외비', '등급', '열람', '반출', '암호'], {
        metBasis: '문서 보안등급 표기, 방산기술보호 및 자료 취급·통제 기준이 반영되어 있습니다.',
        revisionCurrent: '보안 문구는 있으나 문서별 등급/열람권한 표기나 사외 반출·파기 절차가 일부 누락되어 있습니다.',
        revisionGuide: '모든 기술문서에 보안/취급 등급을 표기하고 외부 반출 시 승인 절차와 암호화 기준을 준수하세요.',
        missingDoc: '보안등급 표기 및 방산기술보호 증빙 미확인',
        missingGuide: '보안관리 준수 확인서 및 문서 등급·접근통제 기준을 제출하세요.',
        missingDeadline: '기술자료 제출 및 보안심사 시 즉시 제출',
      }),
    C('CRIT-12', '보안·자료보호 및 수출통제', 'EXPORT-CONTROL / 전략물자', '전략물자 수출통제(EAR/ITAR/국내 전략물자) 및 연계 품목 확인', 'HIGH', 8,
      '수출통제 대상 품목·기술 해당 여부 및 수출허가/심사 요건이 검토되어야 합니다.',
      ['수출통제', '전략물자', 'itar', 'ear', '수출', '허가', '판정'], {
        metBasis: '전략물자/수출통제 해당 여부 판정 및 관련 준수 사항이 포함되어 있습니다.',
        revisionCurrent: '수출통제 언급은 있으나 전략물자 판정 결과나 해외 통제 기술 포함 여부의 근거가 부족합니다.',
        revisionGuide: '전략물자 사전판정/자가판정 결과와 해외 규제 적용 품목 포함 여부를 명확히 기재하세요.',
        missingDoc: '전략물자 및 수출통제 검토 증빙 누락',
        missingGuide: '전략물자 판정 내역 및 수출통제 준수 확인서를 제출하세요.',
        missingDeadline: '해외 조달·수출 및 규격 최종 승인 전 제출',
      }),
  ];

  // 시연용 후보 출처: 규격 원문 대조 전이므로 source_status는 항상 unverified.
  const SRC = {
    doc_name: 'KDS 0050-9000 (국방품질경영체제 인증기준) — 시연 후보',
    clause: '(후보) 원문 대조 전',
    page: '(후보) 원문 대조 전',
    source_status: 'unverified',
  };
  const ev = (id, name, required_meta) => ({ id, name, required_meta: required_meta || [] });
  const Q = (qid, area, rule_type, criterion, allowed_units, unit_conversions, required_evidence, guide, extra) => ({
    qid, area, rule_type, criterion, allowed_units, unit_conversions, required_evidence,
    source: { ...SRC }, guide, assumed: false, ...extra,
  });

  const QUESTIONS = [
    Q('Q01', '치수', 'range', { min: 24.95, max: 25.05, unit: 'mm', label: '외경 25.00 ± 0.05 mm' }, ['mm', 'cm'], { mm: 1, cm: 10 },
      [ev('E01', '치수검사성적서')], { '미흡': '공차 범위 안으로 재가공하거나 재측정 후 성적서를 갱신하세요.', '확인 필요': '측정값·단위와 성적서를 확인해 다시 입력하세요.' }, { assumed: true }),
    Q('Q02', '강도', 'min', { min: 800, unit: 'MPa', label: '인장강도 ≥ 800 MPa' }, ['MPa'], { MPa: 1 },
      [ev('E02', '인장시험성적서')], { '미흡': '재료·열처리를 점검하고 재시험 성적서를 확보하세요.', '확인 필요': '시험값·단위와 성적서를 확인해 다시 입력하세요.' }, { assumed: true }),
    Q('Q03', '표면조도', 'max', { max: 1.6, unit: 'µm', label: 'Ra ≤ 1.6 µm' }, ['µm'], { 'µm': 1 },
      [ev('E03', '표면조도 측정기록')], { '미흡': '가공 조건을 조정하고 재측정 기록을 남기세요.', '확인 필요': '측정값·단위와 기록을 확인해 다시 입력하세요.' }, { assumed: true }),
    Q('Q04', '내식성(염수분무)', 'min', { min: 96, unit: 'h', label: '염수분무 시험시간 ≥ 96 h 무부식' }, ['h', 'day', 'min'], { h: 1, day: 24, min: 1 / 60 },
      [ev('E04', '96h 염수분무 성적서')], { '미흡': '96시간 이상 염수분무 시험을 수행하고 성적서를 확보하세요.', '확인 필요': '시험시간·단위와 성적서를 확인해 다시 입력하세요.' }),
    Q('Q05', '열처리 경도', 'range', { min: 38, max: 42, unit: 'HRC', label: '38 ≤ HRC ≤ 42' }, ['HRC'], { HRC: 1 },
      [ev('E05', '경도시험 기록')], { '미흡': '재열처리 후 경도를 재시험하고 기록을 갱신하세요.', '확인 필요': '경도값과 시험 기록을 확인해 다시 입력하세요.' }),
    Q('Q06', '원자재 화학조성(밀시트)', 'evidence_only', { label: '규정 합금 성분 범위 내 밀시트' }, [], {},
      [ev('E06', '밀시트', ['lot_no'])], { '미흡': '밀시트를 확보하세요.', '확인 필요': '밀시트의 로트 번호(lot_no)를 입력하세요.' }),
    Q('Q07', '비파괴검사(UT/MT) 자격', 'evidence_only', { label: '공인 자격 보유 인력' }, [], {},
      [ev('E07', '자격증', ['valid_until'])], { '미흡': '공인 자격 보유 인력을 확보하세요.', '확인 필요': '자격 유효기간(valid_until)을 입력하세요.' }),
    Q('Q08', '공정관리(SPC)', 'min', { min: 5, unit: 'ea', label: '로트당 시료 ≥ 5개 측정·기록' }, ['ea'], { ea: 1 },
      [ev('E08', '공정검사일지'), ev('E08b', '관리도')], { '미흡': '로트당 5개 이상 측정하고 관리도를 작성하세요.', '확인 필요': '시료 수와 기록을 확인해 다시 입력하세요.' }),
    Q('Q09', '형상관리·도면 리비전', 'match', { expected_text: '최신 개정판(Rev.) 일치', label: '최신 개정판(Rev.) 일치' }, [], {},
      [ev('E09', '도면 관리대장'), ev('E09b', '개정 이력')], { '미흡': '도면 리비전을 최신판으로 맞추세요.', '확인 필요': '도면 개정판 일치 여부를 확인하세요.' }),
    Q('Q10', '포장·방청·출하검사', 'match', { expected_text: '방청 처리 및 출하검사 100% 점검', label: '방청 처리, 출하검사 항목 100% 점검' }, [], {},
      [ev('E10', '출하검사성적서')], { '미흡': '방청 처리와 출하검사 항목을 보완하세요.', '확인 필요': '출하검사 점검 결과를 확인해 다시 입력하세요.' }),
  ];

  // 기업 A 기본 입력 (의도적 누락 4건: Q04·Q05 미흡, Q06·Q07 확인 필요)
  const own = (...ids) => ids.map((id) => ({ id, state: '보유', meta: {} }));
  const SAMPLE_ANSWERS = {
    Q01: { value: 25.02, unit: 'mm', evidence: own('E01') },
    Q02: { value: 842, unit: 'MPa', evidence: own('E02') },
    Q03: { value: 1.2, unit: 'µm', evidence: own('E03') },
    Q04: { value: 72, unit: 'h', evidence: [{ id: 'E04', state: '미보유', meta: {} }] },
    Q05: { value: 35, unit: 'HRC', evidence: own('E05') },
    Q06: { evidence: [{ id: 'E06', state: '보유', meta: {} }] },
    Q07: { evidence: [{ id: 'E07', state: '보유', meta: {} }] },
    Q08: { value: 5, unit: 'ea', evidence: own('E08', 'E08b') },
    Q09: { condition: '합치', evidence: own('E09', 'E09b') },
    Q10: { condition: '합치', evidence: own('E10') },
  };

  const COMPANIES = [
    { id: 'A', name: '가상 부품 제조기업 A (경남)', userId: 'qa@demo-a.example', project: '시연용 방산 부품 사전 점검' },
    { id: 'hanwha', name: '한화에어로스페이스', userId: 'eng.kim@hanwha-defense.kr', project: 'KDS-2026-ENG-104 (터빈 구동 제어기 규격)' },
    { id: 'lig', name: 'LIG넥스원', userId: 'qa.park@lignex1.com', project: 'KDS-2026-RAD-219 (레이다 신호처리 모듈)' },
    { id: 'rotem', name: '현대로템', userId: 'spec.lee@hyundai-rotem.co.kr', project: 'KDS-2026-GRD-305 (전차 구동·현수장치 규격)' },
    { id: 'kai', name: '한국항공우주산업(KAI)', userId: 'air.choi@koreaaero.com', project: 'KDS-2026-AIR-412 (항공기 비행제어 컴퓨터)' },
  ];

  const SAMPLE_DOCS = [
    {
      name: 'KDS-2026-SYS-084_방산규격서_샘플.txt',
      text: '1. KDS Technical Spec: 치수 및 공차 (+/- 0.05mm), 재질 AL6061-T6, 도면 BOM 일치. ' +
        '2. 인터페이스 ICD: 커넥터 핀맵, 전원 28V, 통신 신호 연동. 3. 형상관리: 설계변경 ECP 이력, 개정 Rev.03. ' +
        '4. 품질보증 KQP 및 AS9100 공정관리. 5. 수락시험 ATP, 시험성적서, 판정기준. ' +
        '6. 환경시험 MIL-STD-810 온도 진동 충격, ESS 스크리닝. 7. 신뢰성 MTBF, FMEA, 시정조치. ' +
        '8. 원산지 및 국산화율 산정, 국내생산 부품 조달. 9. 보안 등급 표기, 대외비 반출 통제. 10. 수출통제 전략물자 판정.',
    },
    { name: '품질_신뢰성_증빙.json', text: '{"kqp":"품질보증계획서","atp":"수락시험 성적서","fmea":"고장분석","단종":"DMSMS 대체부품 검토"}' },
  ];

  const data = { CRITERIA, QUESTIONS, SAMPLE_ANSWERS, COMPANIES, SAMPLE_DOCS };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  root.SB_DATA = data;
})(typeof globalThis !== 'undefined' ? globalThis : window);
