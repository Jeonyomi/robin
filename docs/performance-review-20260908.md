# Robinwatch 코드·데이터 성능 점검

## 범위와 결론

- 기준 코드: `Jeonyomi/robin`, `main`, `c59dfdd5cb0601b89a4f32f076677781b9fc94b2`.
- 운영 표본: 2026-09-08 18:31 KST, 공개 GET 엔드포인트 6개를 각각 1회 조회.
- 운영 API 모두 HTTP 200. 다만 소스 상태는 degraded이고, 일부 수집·메타데이터는 불완전함. 정상 HTTP 응답을 최신·완전한 데이터의 증거로 보지 않음.
- 개선은 로컬 소스/테스트에만 적용. Git commit/push, Vercel 배포, DB 쓰기·마이그레이션, 수집기·예약·설정 변경 없음.
- 전체 앱 성능이 특정 비율만큼 개선됐다고 주장하지 않음. 실제로 검증한 것은 SQL/네트워크 요청 수와 포맷터 생성 횟수 감소, 출력 동등성임.

## 1. 운영 응답 표본

클라이언트 관측 경과시간이며 DNS·네트워크·플랫폼 초기화 등이 포함됨. 각 1회이므로 평균·p95·순수 서버 실행시간이 아님. 본문 크기는 requests가 수신 후 디코딩한 데이터 크기이며 압축 전송량이 아님.

- `/api/v1/overview`: 200 / 1.86초 / 8.9 KiB.
- `/api/v1/stock-tokens`: 200 / 0.81초 / 113.7 KiB.
- `/api/v1/source-health`: 200 / 0.69초 / 1.4 KiB.
- `/api/v1/lp-leaders`: 200 / 1.42초 / 11.0 KiB.
- `/api/v1/meme-stock-pairs`: 200 / 2.52초 / 46.8 KiB.
- `/api/v1/meme-leaders`: 200 / 1.41초 / 19.7 KiB.

`x-vercel-cache=MISS`가 관측됐지만 이것만으로 애플리케이션의 인스턴스 내 캐시가 작동하지 않는다고 단정할 수 없음.

## 2. 데이터 상태

### 관측된 사실

- Source Health: `overallStatus=degraded`.
- Robinhood registry의 저장된 마지막 성공은 약 328.9분 전. Chain Stats는 약 301.0분 전이며 최근 collector 실패가 기록됨.
- Gas·Token Transfers도 최근 실패 기록이 있으나 최근 성공 데이터는 존재함. 실패 기록과 마지막 성공 시각을 구분해야 함.
- Database와 LP snapshot은 이 표본에서 healthy. LP 데이터에는 실제 블록의 `observedAt`과 collector 시각이 별도로 존재함.
- Stock Tokens: 194개, 모두 CANONICAL. 1개는 metrics 객체 자체가 없음. 나머지 모든 지표가 유효하다는 의미는 아님.
- Meme / Stock Pairs: 58개/58개 고유 풀. v4 54개, v3 2개, unsupported 2개. discovery 요청 실패 항목은 없었으나 bounded 표본이므로 partial=true 유지가 맞음.
- Meme Leaders: 20개 소스 풀 → 19개 고유 토큰. source-tagged 3개, candidate 16개. 메타데이터 요청 9개 중 3개 실패, 10개는 미요청.
- Overview: 과거 완료 cycle=61, 현재 cycle 진행률=30%, collector status=degraded. `cycle-complete` 표시는 과거 완료 이력에서 계산되므로 현재 cycle이 완전히 수집됐다는 뜻으로 읽으면 안 됨.

### 해석과 주의

- 메타데이터 분류 누락을 밈이 아님으로 해석하거나 후보 전체를 검증된 밈으로 표현하면 안 됨. All candidates 기본값과 분류 배지는 유지함.
- Overview의 최신 전송 시각이 Chain Stats의 오래된 관측 시각을 최신으로 바꿔주지 않음. 지표별 시각/상태 구분이 필요함.
- 실패 원인(제공자 제한, 수집기 운영 문제 등)은 이번 공개 응답만으로 특정하지 않았음. 운영 로그·scheduler 변경 없이 원인 확정 불가.

## 3. 로컬 개선 적용

### A. 버려지는 순위 SQL 계산 제거

- 근거: 기존 `src/lib/queries.ts`의 `getOverviewData()`는 집계·순위 등 SQL 7개를 실행. Overview와 capital-flow API는 결과의 topTokens를 빈 배열로 덮어써 순위를 버리고 있었음.
- 변경: `includeTopTokens` 옵션을 추가하되 기본값 true 유지. 해당 두 API만 false 전달.
- 검증: 실제 Drizzle SQL 컴파일 + 가짜 전송 계층으로 각 API의 SQL 7개 → 6개 확인. 순위 쿼리 이외 SQL/파라미터와 비순위 응답이 동일함을 비교.
- Activity Lens/opportunities와 snapshot builder는 기본 순위 계산 유지.
- DB 실행계획·실제 ms 절감은 측정하지 않았음. 쿼리 하나 제거를 동일 비율의 응답시간 개선으로 환산하지 않음.

### B. 스냅샷 fallback의 중복 요청·무한 대기·만료 오류 개선

- 근거: `src/lib/snapshot.ts`는 동시 cache miss마다 Blob을 호출했고 네트워크 제한 시간이 없었음. fetch가 throw하면 문서상의 local fallback도 건너뛰었음.
- 변경: 인스턴스 내 singleflight, 8초 upstream abort, 실패 후 30초 cooldown 추가. 네트워크 예외/timeout 뒤에도 로컬 fallback 시도.
- 변경: cache TTL뿐 아니라 원본 builtAt의 최대 허용 나이도 매번 재검사. 응답 수신 완료 시각으로 원본 나이를 다시 확인하며 builtAt을 갱신하지 않음.
- 검증: 합성 테스트에서 동시 8개 요청 → Blob 호출 1개. 실패 반복/회복, 만료 경계, timeout 후 fallback 테스트 통과.
- 제한: 인스턴스 내 최적화임. 여러 Vercel 인스턴스 사이의 전역 중복 호출까지 막지 않음. 30초 cooldown 동안 새로 회복된 소스도 즉시 재조회하지 않는 절충이 있음.

### C. Meme Leaders 숫자 포맷터 재사용

- 근거: `src/app/meme-leaders/explorer.tsx`가 표시 시계 갱신 때마다 행별 Intl.NumberFormat 인스턴스를 새로 생성함.
- 변경: USD compact·일반 가격·극소 가격·정수 포맷터를 모듈 단위로 재사용.
- 검증: 합성 토큰 1개 UI에서 한 번의 시계 갱신당 생성 횟수 8회 → 0회. 새 API 호출 없음.
- All candidates 기본값, N/A, 0, 극소 가격 scientific 경계, 유효숫자, 5분 만료 후 순위 숨김 유지 확인.
- 전체 재렌더링 자체를 없앤 것은 아님. 실기기 FPS·LCP 개선 수치는 미측정.

## 4. 후속 개선 우선순위 — 이번에는 미적용

### 높음: 기간/필터 변경의 요청 경쟁과 낭비

- 근거: `src/app/page.tsx:49–62`, `capital-flow/page.tsx:32–41`, `opportunities/page.tsx:36–51`, `stock-tokens/page.tsx:32–37`에 이전 fetch 취소/응답 식별 가드가 없음.
- 빠른 조건 전환 시 늦게 도착한 이전 응답이 새 조건의 결과를 덮어쓸 수 있음. 재조회 중 이전 데이터 표시도 구분 필요.
- 다음 우선 수정 대상: AbortController + 요청 키 가드 + 선택 조건과 일치하는 로딩/표시 상태. 지연 응답을 뒤집어 전달하는 테스트로 검증.
- 브라우저 fetch 취소가 서버에서 이미 시작한 DB 작업 취소까지 보장하지는 않음.

### 높음: Stock Tokens의 전체 metric 이력 조회

- 근거: `src/lib/queries.ts`의 getStockTokensData가 선택 window의 metric 이력을 전부 정렬·전송받은 뒤 JS Map으로 토큰별 최신 행만 남김.
- 이력이 증가할수록 DB 정렬·전송·함수 메모리 비용이 커질 수 있음. 실제 이력 행 수와 실행계획은 미조회.
- 후속 검증 후보: SQL에서 토큰별 최신 행만 선택하고 필요 컬럼만 반환. 동시각 tie 처리와 출력 동등성을 검증한 뒤 적용. 인덱스/스키마 변경은 별도 승인 필요.

### 높음: 지표별 신선도/coverage 표현

- 최신 전송 timestamp를 오래된 체인 통계까지 대표하는 것으로 오해하지 않도록 구분.
- `completedCycles > 0`은 과거 rotation 성공 이력이지 현재 rotation 완료/전수 완전성의 증거가 아님.
- `src/lib/snapshot.ts`의 pickWindow는 없는 window를 24h로 대체함. fallback 데이터와 요청 window의 의미가 어긋날 수 있어 fail-closed 또는 effectiveWindow 명시 검증 필요.

### 중간: 화면 반복 작업과 차트 번들

- 시계 변화와 데이터 목록 렌더링 분리, 안정적인 파생 데이터 memoization 검토. 적은 행 수에서는 이득보다 복잡성이 클 수 있으므로 프로파일링 후 적용.
- ActivityTimelineChart는 echarts-for-react 전체 진입점을 dynamic import함. 필요한 ECharts core/chart/component만 가져오는 방식의 번들 차이는 실제 production build로 검증해야 함.
- lazy import가 이미 있으므로 모든 차트를 항상 초기 로드한다고 단정하지 않음. 설치된 미사용 패키지의 용량을 전송 번들로 계산하지 않음.

### 중간: 제공자 호출 예산과 캐시

- Meme feed·pair discovery는 고정 호출 범위, 인스턴스 캐시와 일부 실패 처리가 있음. 무조건 재시도를 늘리는 방식은 추천하지 않음.
- 느리게 바뀌는 registry/category와 빠른 시장 지표를 별도 캐시할 수 있으나 각각 retrievedAt/holder timestamp 유지, 음성 캐시, 전역 rate limit 정책을 먼저 검증해야 함.
- 유료 API·플랜 상향·새 DB·수집 빈도 증가는 이번 작업에서 사용하거나 권장하지 않았음.

## 5. 검증과 전달 경계

- 변경 전: unit tests 368개 통과, typecheck 통과. 선택 파일 lint는 기존 img 경고 1개/오류 0개.
- 변경 후: unit tests 385개 / 20개 테스트 파일 통과. 실제 외부 데이터가 아닌 명시적 합성 fixture로 비용/경계 테스트 수행.
- 변경 후 typecheck 통과. 변경 소스/테스트 대상 lint 오류 0개, 기존 img 경고 1개. git diff --check 통과.
- 상세 최종 검증 결과는 아래 증거 디렉터리의 performance-review-verification.json에 기록.
- Production build·배포 후 QA·브라우저 시각 QA·부하 테스트·DB EXPLAIN은 수행하지 않음.
- 독립 명세·품질 리뷰 모두 통과. 품질 리뷰 JSON을 직접 읽어 passed=true, security_concerns/logic_errors가 빈 목록임을 확인함. 비차단 제안인 malformed JSON·동시 실패 회복 추가 테스트는 후속 보완으로 남김.
- 되돌리기: 이번 로컬 diff의 명시된 파일만 역적용하면 됨. DB/원격 상태 복구는 필요하지 않음. 사용자 변경을 덮어쓰는 전체 reset은 사용하지 않음.

## 증거 위치

- `C:/Users/USER/AppData/Local/hermes/cache/robinwatch-performance-review/public-baseline.json`
- `C:/Users/USER/AppData/Local/hermes/cache/robinwatch-performance-review/review-payload.json`
- `C:/Users/USER/AppData/Local/hermes/cache/robinwatch-performance-review/quality-verdict.json`
- `tests/unit/overview-query-cost.test.ts`
- `tests/unit/snapshot.test.ts`
- `tests/unit/meme-leaders-render-cost.test.ts`
