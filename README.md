# Robinhood Chain Onchain Opportunity Intelligence Dashboard

> Robinhood Chain에서 어디로 돈이 이동하고 있으며, 그 움직임이 실제 투자 가능한 기회인지 위험 조정 후 우선순위로 보여주는 온체인 투자 인텔리전스 터미널.

---

## Executive Summary

Robinhood Chain은 2026년 7월 1일 메인넷을 시작한 Ethereum L2 (Arbitrum Orbit) 체인으로, Stock Tokens (토큰화된 미국 주식), USDG 스테이블코인, Uniswap, Morpho 등을 결합하는 온체인 금융 인프라를 구축하고 있다.

### 핵심 지표 (2026년 9월 기준)

| 지표 | 값 |
|------|-----|
| DEX 일일 거래량 | 1.595B (9/1 기록) |
| 누적 DEX 거래량 | 47B+ |
| DeFi TVL | 738M |
| 브릿지 자산 | 2.52B |
| 스테이블코인 공급량 | ~797M (USDe 44%, USDG) |
| 토큰화 RWA | 41.9M / 202개 자산 |
| Stock Token 일일 거래량 | 85.1M |
| 일간 활성 사용자 | 323,969 (피크) / ~115K (안정) |
| 일일 트랜잭션 | 11.6M 평균 |
| 앱 수익 | 2.66M/일 (Solana 다음 2위) |
| RWA 보유자 | 328,000+ |

### 왜 이 대시보드가 필요한가

단순 가격/거래량 Top N 대시보드는 투자 정보력이 낮다. 초기 체인에서는:

- 동일 티커의 canonical/non-canonical contract가 공존 (GME, SPCX 등)
- 누적 holder/transfer 수치가 bot/airdrop으로 왜곡되기 쉽다
- 표시 시총과 실제 liquidity 사이에 큰 괴리가 존재한다
- ERC-4337 bundler, Relay router, Uniswap pool이 하나의 transaction 안에서 복합 연결된다

따라서 본 제품은 transaction graph를 경제적 행동으로 재구성하고, canonical identity와 liquidity/risk를 결합해 actionable signal로 변환하는 데 핵심 가치가 있다.

---

## 1. 체인 구조

### 네트워크 사양

| 항목 | 값 |
|------|-----|
| Chain ID | 4663 (메인넷) / 46630 (테스트넷) |
| Gas Token | ETH |
| RPC | rpc.mainnet.chain.robinhood.com |
| Explorer | robinhoodchain.blockscout.com |
| Settlement | Ethereum (blob DA) |
| Sequencer | 중앙화 (Offchain Labs) |
| 컨트랙트 배포 | 퍼미션리스 |

---

## 2. 생태계 맵

### DEX 레이어

| 프로토콜 | 유형 | 점유율 |
|----------|------|--------|
| Uniswap V3/V4 | AMM | 거래량의 96% |
| Arcus (dYdX + Robinhood) | Spot + Perps | 95개 Stock Token 상장 |
| Lighter | 탈중앙화 Perps | 크립토 퍼프 |

### DeFi 레이어

| 프로토콜 | 기능 | TVL |
|----------|------|-----|
| Morpho | 대출 (Robinhood Earn) | ~260M (TVL의 44%) |
| Ethena | USDe 스테이블코인 | ~156M |
| Maple | 기관 대출 | ~43M |
| USDG | Paxos 스테이블코인 | ~330-350M 공급 |

### 인프라

| 제공자 | 역할 |
|--------|------|
| Chainlink | Stock Token 가격 오라클 |
| BitGo | 기초 자산 custody |
| LayerZero | 크로스체인 브릿지 |
| Alchemy | RPC / 개발 인프라 |

---

## 3. 핵심 문제와 솔루션

### Problem 1: Canonical Identity
동일 GME 티커에 두 개의 contract 존재. Robinhood /rhj/assets registry 기반 Canonical Asset Resolver로 해결.

### Problem 2: Transfer Distortion
USDG bridge-in-router-pool-TOKEN buy를 4~6개 transfer로 세면 과대계상. gross/economic volume 분리로 해결.

### Problem 3: Multiplier-Aware Pricing
AAPL multiplier: 1.000566, CRWD multiplier: 4.0. raw_mid / multiplier = adjusted_reference_price.

### Problem 4: Shallow Liquidity Illusion
표시 시총 290M (PONS) BUT depth가 매우 낮음. displayed market cap 대신 depth/volume ratio 사용.

---

## 4. 제품 아키텍처

### 4-Layer Intelligence Model
1. Identity Layer: canonical Stock Token / 공식 자산 검증
2. Flow Layer: bridge inflow, stablecoin flow, whale flow, DEX swap, mint/burn
3. Signal Layer: holder growth, unique buyer growth, liquidity depth, smart-money accumulation
4. Risk Layer: contract 권한, holder 집중도, wash/sybil, ticker collision

### Data Pipeline
Robinhood RHJ APIs + Blockscout API + RPC/WebSocket -> Ingestion Layer -> Raw Event Store -> Normalizer/Entity Resolver -> Feature/Metric Engine -> Signal/Risk Engine -> API/Realtime/Dashboard

---

## 5. 핵심 Dashboard 화면

### 5.1 Overview: Chain Pulse
KPI Cards: Transactions, Active Wallets, New Wallets, Net Bridge Inflow, USDG Net Flow, DEX Volume, New ERC-20, Gas Fee

### 5.2 Opportunity Radar
모든 자산을 Opportunity Score (0~100)와 Risk Score (0~100)로 순위화.

### 5.3 Stock Token Radar
Canonical Badge, Current Multiplier, Adjusted Reference Price, Best DEX Price, Premium/Discount, Depth, Holder Delta, Unique Buyers/Sellers, Top 10 Concentration

### 5.4 Token Scanner
Contract Creation -> ERC-20 Detection -> Verification -> Creator Analysis -> Pool Discovery -> Liquidity -> Holder Distribution -> Smart Money -> Risk Gate -> Opportunity Ranking

### 5.5 Bridge and Capital Flow
Bridge Inflow Spike + DEX Buy + Liquidity Increase + Smart Wallet = Capital Rotation Signal

### 5.6 Smart Money Engine
Rolling score: 25% PnL Quality + 20% Win Rate + 20% Entry Lead Time + 15% Trade Consistency + 10% Liquidity-adjusted Return + 10% Breadth - Sybil/Bot Penalty

---

## 6. Signal Recipes

- SMART_ACCUMULATION: smart_money_flow positive + holder_growth positive + unique_buyers rising + liquidity stable
- CAPITAL_ROTATION: bridge_inflow spike + destination_buy positive + liquidity_up + diversified_wallets
- NEW_TOKEN_BREAKOUT: age adequate + verified + liquidity min + buyers accelerating + sellers exist + top10 low + smart_money_in
- STOCK_TOKEN_DIVERGENCE: canonical + fresh_price + no_halt + normalized + premium/discount threshold + depth sufficient
- TICKER_COLLISION: stock-like ticker + not_in_registry -> excluded from leaderboard

---

## 7. Risk Engine

Risk Score 0~100: Contract 25 + Liquidity 20 + Concentration 20 + Manipulation 15 + Identity 10 + Data Quality 10

Hard Gates: TICKER_COLLISION, LOW_LIQUIDITY, HIGH_CONCENTRATION, DATA_ANOMALY, CONTRACT_PRIVILEGE

---

## 8. Opportunity Score

Raw Score = 23% Capital Flow + 18% Adoption + 18% Liquidity + 15% Smart Money + 11% Relative Value + 15% Catalyst

Adjusted = Raw x (1 - RiskScore/125)

---

## 9. 기술 스택

- Application: Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, TanStack Query, viem, Recharts
- API: Next.js Server Routes / Fastify, Zod, OpenAPI
- Worker: Node.js/TypeScript, viem WebSocket, BullMQ
- Storage: PostgreSQL + TimescaleDB, Redis, ClickHouse (scale)
- Deploy: Vercel (frontend), Railway/Fly.io (API/Worker)

---

## 10. Internal API

GET /api/v1/overview, /opportunities, /stock-tokens, /stock-tokens/{symbol}, /tokens/{address}, /tokens/{address}/flows, /holders, /pools, /wallets/{address}, /smart-money, /bridge/flows, /signals, /alerts

Realtime: SSE /api/v1/stream/signals

---

## 11. 데이터 소스

Blockscout API: api.blockscout.com/4663/api/v2
Robinhood API: api.robinhood.com/rhj/assets, /rhj/prices/{symbol}, /rhj/corporate-actions

---

## 12. DB Schema (핵심)

- canonical_assets: asset_id, symbol, contract_address, current_multiplier, asset_status
- economic_actions: action_id, tx_hash, action_type, actor, protocol, input/output asset, usd_value
- token_features: token_address, window, holder_delta, unique_buyers, net_flow_usd, liquidity_usd, risk_score, opportunity_score
- signals: id, entity, signal_type, score, risk_score, confidence, evidence_json

---

## 13. Roadmap

P0 MVP (8주): DB + Ingestion + Canonical Resolver + Feature Engine + Signal/Risk + Dashboard UI (8 screens)
P1 (9-16주): Uniswap analytics, Wallet PnL, Morpho, Alerts, Backtest
P2 (17-24주): Perps, Cross-chain Identity, AA Intelligence, API Product

---

## 14. Business Model

Free: Chain Pulse, Delayed Radar, Canonical Check, Basic Risk
Pro: Realtime Signals, Smart Money, Alerts, Watchlist, Flow Analytics, Backtest
Team/API: API, Webhook, Exports, Shared Watchlists, Custom Labels

---

## 15. 투자 테마

A. Stock Token Onchain Adoption
B. Stablecoin-Led Capital Rotation
C. New Liquidity Formation
D. Lending Monetization of Stock Tokens
E. Agent/AA-Native Activity

---

## 16. MVP Acceptance Criteria

Data: canonical mapping 100%, minimal duplication, reorg handling, gap detection
UX: 3 clicks to answer 5 key questions (inflow, liquidity, smart money, risk, invalidators)

---

## 17. Repository 구조

/apps/web, /apps/api, /workers/chain-indexer, /workers/feature-engine, /packages/*, /fixtures/*, /docs/*

---

## 18. 리스크 및 제한

- Blockscout 표시 가격 직접 신뢰 금지
- 동일 티커 contract 존재 가능
- 얕은 liquidity token의 execution price 괴리
- Router/bridge/MM transfer 오분류 가능
- 관할지역별 제한 존재
- 투자 조언이 아닌 데이터/리서치 도구

---

## 19. 주요 소스

| 구분 | URL |
|------|-----|
| Blockscout | robinhoodchain.blockscout.com |
| Docs | docs.robinhood.com/chain/ |
| APIs | api.robinhood.com/rhj/assets |
| DefiLlama | defillama.com/chain/robinhood-chain |
| Galaxy | galaxy.com/insights/research/robinhood-chain-launch-analysis/ |

---

## License

Private - Jeonyomi
