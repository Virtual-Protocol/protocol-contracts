# Phase 4b Confidence Scores

**Date**: 2026-04-03  
**Orchestrator**: Confidence Scoring Agent (Haiku)  
**Model**: Mechanical formula application (4-axis composite)

---

## Scoring Summary

**Total findings scored**: 141  
**CONFIDENT (≥0.7)**: 94 findings  
**UNCERTAIN (0.4–0.7)**: 42 findings  
**LOW CONFIDENCE (<0.4)**: 5 findings  

---

## Scores By Finding

| Finding ID | Severity | Evidence | Consensus | AQ | RAG | Composite | Classification | Notes |
|---|---|---|---|---|---|---|---|---|
| AC-1 | Critical | 0.80 | 0.70 | 0.71 | 0.90 | **0.80** | CONFIDENT | Breadth agent + high RAG; documented privileged role drain pattern |
| AC-2 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Breadth coverage; documented bypass pattern |
| AC-3 | High | 0.70 | 0.70 | 0.71 | 0.80 | **0.73** | CONFIDENT | Solodit checklist class; parameter boundary |
| AC-4 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Zero-address setter documented |
| AC-5 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Tax manipulation by privileged role; documented |
| AC-6 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Silent setter monitoring gap; standard class |
| AC-7 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | 23 silent setters; Solodit coverage |
| AC-8 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | EXECUTOR arbitrary approvals |
| AC-9 | Low | 0.70 | 0.70 | 0.71 | 0.50 | **0.63** | UNCERTAIN | Omission-based DoS; launchpad-specific variant uncommon |
| AC-10 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | DEFAULT_ADMIN single point of failure |
| EP-1 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Return value not checked; standard class |
| EP-2 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Factory createPair return unchecked |
| EP-3 | High | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Depth (DE-2) shows partial mitigation; revert-on-failure |
| EP-4 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Zero-check inconsistency between components |
| EP-5 | High | 0.80 | 0.70 | 0.71 | 1.00 | **0.82** | CONFIDENT | Donation attack; Solodit checklist item 3 direct match |
| EP-6 | Low | 0.70 | 0.70 | 0.71 | 0.50 | **0.63** | UNCERTAIN | Safe-by-accident; novel combination |
| EP-7 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Off-chain approval dependency; documented |
| EP-8 | Critical | 0.70 | 0.85 | 0.71 | 0.50 | **0.69** | UNCERTAIN | Graduation DoS; novel for bonding curve but related to multi-step DoS pattern |
| EP-9 | Medium | 0.80 | 0.70 | 0.71 | 0.90 | **0.81** | CONFIDENT | Donation attack at graduation; Solodit checklist coverage |
| EP-10 | Critical | 0.80 | 0.75 | 0.71 | 0.80 | **0.79** | CONFIDENT | Fee-on-transfer graduation mismatch; Uniswap V2 precedent + depth confirmation |
| EP-11 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Interface spoofing mitigated by EXECUTOR_ROLE |
| EP-12 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Silent try/catch failure; documented pattern but context-specific |
| EP-13 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Multi-step cached parameter staleness (R8 pattern) |
| EP-14 | High | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Sequential role dependency; related to EP-8 |
| MG-1 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Version-specific revert; known migration pitfall |
| MG-2 | Medium | 0.80 | 0.70 | 0.71 | 0.80 | **0.77** | CONFIDENT | Storage gap on upgrade; multiple code4rena precedents |
| MG-3 | Medium | 0.70 | 0.70 | 0.71 | 0.50 | **0.63** | UNCERTAIN | PARTIAL finding; limited evidence |
| MG-4 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Cached parameter staleness; R8 pattern |
| MG-6 | Low | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | No asset recovery for stranded dust; informational class |
| MG-7 | Info | 0.30 | 0.70 | 0.71 | 0.30 | **0.43** | UNCERTAIN | REFUTED as bug; separate deployments by design (floor score) |
| MG-8 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | EIP-170 contract size limit; documented constraint |
| SLS-1 | Medium | 0.80 | 0.70 | 0.71 | 1.00 | **0.85** | CONFIDENT | Missing __gap; multiple code4rena precedents + OpenZeppelin guidance |
| EVT-1 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Wrong event parameter; monitoring finding |
| EVT-4 | Low | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Missing event on buy/sell; standard low finding |
| EVT-5 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Silent setter; common class |
| EVT-6 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | 14 silent setters; very common |
| EVT-7 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Silent setter |
| EVT-8 | High | 0.80 | 0.70 | 0.71 | 0.80 | **0.78** | CONFIDENT | Silent setter on critical parameters (tax + vault) |
| EVT-9 | High | 0.80 | 0.70 | 0.71 | 0.80 | **0.78** | CONFIDENT | Silent setter on routing |
| EVT-10 | Low | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | 4 admin setters silent; common low |
| EVT-11 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Silent setter; medium |
| EVT-12 | Low | 0.50 | 0.85 | 0.71 | 0.50 | **0.61** | UNCERTAIN | Niche event agent (bonus); missing graduation event amounts |
| EVT-13 | Low | 0.50 | 0.85 | 0.71 | 0.60 | **0.63** | UNCERTAIN | Niche event agent; missing graduate event |
| EVT-14 | Low | 0.50 | 0.85 | 0.71 | 0.50 | **0.60** | UNCERTAIN | Niche event agent; missing addInitialLiquidity event |
| EVT-15 | Low | 0.50 | 0.85 | 0.71 | 0.50 | **0.60** | UNCERTAIN | Niche event agent; non-indexed event data |
| EVT-16 | Low | 0.50 | 0.85 | 0.71 | 0.60 | **0.63** | UNCERTAIN | Niche event agent; event missing old value |
| TE-1 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Cached parameter staleness (R8 pattern) |
| TE-2 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Multi-step staleness; context-specific |
| TE-3 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Validator timestamp manipulation; documented |
| TE-4 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Tax manipulation via timestamp setter |
| TE-5 | Medium | 0.70 | 0.70 | 0.71 | 0.50 | **0.63** | UNCERTAIN | Default zero timestamp; less common context |
| TE-6 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Retroactive parameter change (R8 pattern) |
| EC-1 | High | 0.80 | 0.70 | 0.71 | 0.80 | **0.78** | CONFIDENT | Arithmetic boundary; standard class in tax tokens |
| EC-2 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Zero-value parameter boundary |
| EC-3 | High | 0.80 | 0.70 | 0.71 | 0.80 | **0.78** | CONFIDENT | Arithmetic boundary; well-documented |
| EC-4 | High | 0.80 | 0.70 | 0.71 | 0.80 | **0.78** | CONFIDENT | Division by zero; extremely common |
| EC-5 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | K overflow in AMM; Sudoswap Cyfrin precedent |
| EC-7 | Low | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Rounding dust; standard |
| EC-10 | Low | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | BPS precision loss; common |
| EC-11 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Declared-but-not-enforced constraint |
| TF-1 | Medium | 0.80 | 0.70 | 0.71 | 1.00 | **0.85** | CONFIDENT | Donation attack; Solodit checklist item 3 direct match |
| TF-2 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Stranded tokens; protocol-specific variant |
| TF-3 | High | 0.80 | 0.75 | 0.71 | 0.80 | **0.79** | CONFIDENT | Fee-on-transfer graduation; Uniswap V2 issue + depth confirmation |
| TF-4 | Low | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | K invariant not validated; custom AMM pattern |
| TF-5 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | TOCTOU double-read (mitigated by nonReentrant) |
| TF-6 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Donation + reserve sync; documented class |
| TF-7 | Low | 0.50 | 0.70 | 0.71 | 0.50 | **0.60** | UNCERTAIN | Dead storage; informational |
| TF-8 | Low | 0.30 | 0.70 | 0.71 | 0.30 | **0.44** | UNCERTAIN | CONTESTED; graduation self-transfer production behavior novel |
| RS2-1 | High | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Zero-value external revert DoS; documented |
| RS2-2 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Multicall silent failure; Foundation 2022 precedent |
| RS2-3 | Medium | 0.80 | 0.85 | 0.71 | 0.90 | **0.84** | CONFIDENT | CEI violation reentrancy; multiple code4rena + Solodit precedents + multiple depth agent confirmation (B7, TF, CBS, SP) |
| RS2-4 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Factory duplicate pair; known pattern |
| RS2-7 | Info | 0.50 | 0.70 | 0.71 | 0.50 | **0.57** | UNCERTAIN | Zero test coverage; informational |
| RS2-8 | Low | 0.70 | 0.70 | 0.71 | 0.40 | **0.61** | UNCERTAIN | Anti-sniper algorithm mismatch; narrow variant, limited precedent |
| RS3-3 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | DAO address non-deterministic; less commonly reported |
| RS3-4 | Low | 0.50 | 0.70 | 0.71 | 0.50 | **0.59** | UNCERTAIN | Dead code; informational |
| PC1-3 | Medium | 0.80 | 0.70 | 0.71 | 0.90 | **0.83** | CONFIDENT | Single-step ownership; PoolTogether 2021 code4rena precedent |
| PC1-4 | Medium | 0.80 | 0.70 | 0.71 | 0.80 | **0.79** | CONFIDENT | ETH trapped; Solodit L-02 finding |
| PC1-5 | Low | 0.50 | 0.70 | 0.71 | 0.50 | **0.59** | UNCERTAIN | Silent zero return; informational |
| PC1-6 | Medium | 0.80 | 0.70 | 0.71 | 0.80 | **0.79** | CONFIDENT | Arbitrary external call via multicall; Foundation 2022 precedent |
| PC1-7 | Low | 0.50 | 0.70 | 0.71 | 0.40 | **0.56** | UNCERTAIN | Inline assembly assumptions; informational |
| PC1-8 | Low | 0.50 | 0.70 | 0.71 | 0.50 | **0.59** | UNCERTAIN | No admin enumeration; informational |
| PC1-10 | Critical | 0.80 | 0.70 | 0.71 | 0.90 | **0.83** | CONFIDENT | CREATOR_ROLE never granted; Solodit 2025 precedent |
| PC1-12 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Zero-address not blocked; documented |
| PC1-14 | Low | 0.50 | 0.70 | 0.71 | 0.40 | **0.57** | UNCERTAIN | Cross-factory role confusion; uncommon context |
| PC1-15 | Medium | 0.70 | 0.70 | 0.71 | 0.70 | **0.70** | CONFIDENT | Unbounded array growth; Solodit class |
| PC1-16 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | No code-existence check; known class |
| PC1-17 | Medium | 0.70 | 0.70 | 0.71 | 0.60 | **0.67** | UNCERTAIN | Unchecked tax at init; same as EC-1/EC-3 |
| SP-1 | High | 0.80 | 0.80 | 0.71 | 0.80 | **0.79** | CONFIDENT | sellTax underflow (sibling of EC-3); sibling propagation confirmation |
| SP-2 | High | 0.80 | 0.80 | 0.71 | 0.80 | **0.79** | CONFIDENT | antiSniper cap break (sibling of EC-1); sibling propagation confirmation |
| SP-3 | Medium | 0.80 | 0.80 | 0.71 | 0.90 | **0.85** | CONFIDENT | CEI violation across V2/V3/V4; sibling propagation of RS2-3 |
| SP-4 | Medium | 0.80 | 0.80 | 0.71 | 1.00 | **0.86** | CONFIDENT | Donation attack siblings V2/V3/V4; sibling propagation of TF-1 |
| SP-5 | Medium | 0.70 | 0.80 | 0.71 | 0.70 | **0.74** | CONFIDENT | Staleness across siblings; sibling propagation |
| SP-6 | Medium | 0.70 | 0.80 | 0.71 | 0.70 | **0.74** | CONFIDENT | Wrong event value V4 sibling; sibling propagation |
| VS-1 | Low | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | Validation sweep; boundary operator finding |
| VS-2 | Medium | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | Validation reachability gap; sweep agent |
| VS-3 | Unknown | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | Guard coverage; sweep agent |
| VS-4 | Low | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | Asymmetric operations; sweep agent |
| VS-5 | Medium | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | Batch function broken; sweep agent |
| VS-6 | Medium | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | Cross-contract parity; sweep agent |
| VS-7 | Medium | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | Validation sweep finding |
| VS-8 | Info | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | Validation sweep; informational |
| VS-9 | Low | 0.50 | 0.85 | 0.71 | 0.60 | **0.65** | UNCERTAIN | PARTIAL validation finding |
| BLIND-A1 | High | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | Zero-address BondingConfig setter; specialized blind spot agent (low step exec rate) |
| BLIND-A2 | High | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | Zero-address BondingConfig setter variant; blind agent specialized |
| BLIND-A3 | Medium | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | BondingConfig DoS; blind agent |
| BLIND-A4 | Medium | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | Zero-address setter; blind agent |
| BLIND-A5 | Medium | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | BondingConfig parameter DoS; blind agent |
| BLIND-B1 | Medium | 0.70 | 0.85 | 0.50 | 0.70 | **0.71** | CONFIDENT | CEI violation; blind agent found with evidence |
| BLIND-B2 | Medium | 0.70 | 0.85 | 1.00 | 0.70 | **0.79** | CONFIDENT | Donation attack reentry; blind agent with strong step coverage |
| BLIND-B3 | Medium | 0.70 | 0.85 | 0.50 | 0.70 | **0.71** | CONFIDENT | Double-refund reentrancy; blind agent |
| BLIND-B4 | Low | 0.70 | 0.85 | 0.50 | 0.70 | **0.71** | CONFIDENT | Launch precondition; blind agent |
| BLIND-B5 | Low | 0.70 | 0.85 | 1.00 | 0.70 | **0.79** | CONFIDENT | PARTIAL; blind agent with strong evidence |
| BLIND-C1 | Medium | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | Router zero-address; blind agent narrow coverage |
| BLIND-C2 | Medium | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | Router malicious setter; blind agent |
| BLIND-C3 | Low | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | FFactory pair enumeration; blind agent |
| BLIND-C4 | High | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | Role revocation DoS; blind agent |
| BLIND-C5 | Medium | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | FFactory duplicate pair; blind agent |
| BLIND-C6 | Medium | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | FPairV2 invariant; blind agent |
| BLIND-C7 | Low | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | Dead code finder; blind agent |
| BLIND-C8 | Medium | 0.30 | 0.85 | 0.14 | 0.30 | **0.39** | LOW CONFIDENCE | BondingV5 initialization; blind agent |
| CBS-1 | Low | 0.70 | 0.85 | 0.50 | 0.60 | **0.68** | UNCERTAIN | Callback safety; niche agent |
| CBS-2 | Low | 0.70 | 0.85 | 0.50 | 0.60 | **0.68** | UNCERTAIN | Callback TOCTOU; niche agent |
| CBS-3 | Info | 0.70 | 0.85 | 0.50 | 0.60 | **0.68** | UNCERTAIN | Callback pattern; niche agent informational |
| CBS-4 | Medium | 0.70 | 0.85 | 0.50 | 0.70 | **0.71** | CONFIDENT | CEI violation callback; niche agent PARTIAL finding |
| CBS-5 | Medium | 0.30 | 0.85 | 0.14 | 0.70 | **0.55** | UNCERTAIN | Niche callback agent; low evidence tag count |
| DA-1 | Low | 0.80 | 0.85 | 0.50 | 0.50 | **0.68** | UNCERTAIN | Dimensional analysis; niche agent with 3 evidence tags |
| DA-2 | Low | 0.70 | 0.85 | 0.50 | 0.50 | **0.65** | UNCERTAIN | Dimensional analysis; niche agent |
| DA-3 | Info | 0.70 | 0.85 | 0.50 | 0.50 | **0.65** | UNCERTAIN | Dimensional analysis informational; niche agent |
| DE-1 | High | 0.70 | 0.90 | 0.50 | 0.70 | **0.72** | CONFIDENT | Depth external; moderate consensus (depth agent) |
| DE-2 | Medium | 0.80 | 0.90 | 0.50 | 0.60 | **0.71** | CONFIDENT | Depth external PARTIAL; depth agent with evidence |
| DE-3 | Critical | 0.80 | 0.90 | 0.50 | 0.50 | **0.70** | CONFIDENT | Depth external graduation DoS; depth expert agent (but lower RAG on novel pattern) |
| DE-4 | Medium | 0.80 | 0.90 | 0.50 | 0.70 | **0.75** | CONFIDENT | Depth external; 4 evidence tags |
| DE-5 | Medium | 0.70 | 0.90 | 0.50 | 0.70 | **0.71** | CONFIDENT | Depth external; depth agent |
| DE-6 | Medium | 0.70 | 0.90 | 0.50 | 0.70 | **0.71** | CONFIDENT | Depth external; depth agent |
| DE-7 | Medium | 0.80 | 0.90 | 0.50 | 0.70 | **0.74** | CONFIDENT | Depth external; depth agent |
| DE-8 | Low | 0.70 | 0.90 | 0.50 | 0.60 | **0.68** | UNCERTAIN | Depth external PARTIAL; depth agent |
| DE-9 | Low | 0.70 | 0.90 | 0.50 | 0.70 | **0.71** | CONFIDENT | Depth external; depth agent |
| DE-10 | Low | 0.70 | 0.90 | 0.50 | 0.70 | **0.71** | CONFIDENT | Depth external; depth agent |
| DE-11 | Low | 0.80 | 0.90 | 0.50 | 0.70 | **0.74** | CONFIDENT | Depth external; depth agent with 3 evidence tags |
| DEPTH-EC-1 | High | 0.80 | 0.90 | 1.00 | 0.80 | **0.88** | CONFIDENT | 4 boundary evidence tags; depth edge-case agent |
| DEPTH-EC-2 | High | 0.80 | 0.90 | 1.00 | 0.80 | **0.88** | CONFIDENT | 4 boundary evidence tags; depth agent |
| DEPTH-EC-3 | High | 0.80 | 0.90 | 1.00 | 0.80 | **0.88** | CONFIDENT | 3 boundary tags; depth agent |
| DEPTH-EC-4 | High | 0.80 | 0.90 | 1.00 | 0.80 | **0.88** | CONFIDENT | 2 boundary tags; depth agent |
| DEPTH-EC-5 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | 3 boundary tags; depth agent |
| DEPTH-EC-6 | Low | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | 4 boundary tags; depth agent |
| DEPTH-EC-7 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | 4 boundary tags PARTIAL; depth agent |
| DEPTH-EC-8 | Low | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | 3 boundary tags; depth agent |
| DEPTH-EC-9 | Info | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | REFUTED; 3 boundary tags but verdict overrides |
| DEPTH-EC-10 | Low | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | 3 boundary tags; depth agent |
| DEPTH-EC-11 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | 3 boundary tags; depth agent |
| DEPTH-EC-12 | High | 0.70 | 0.90 | 1.00 | 0.80 | **0.86** | CONFIDENT | 2 boundary tags; depth agent |
| DEPTH-EC-13 | Low | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | 4 boundary tags PARTIAL; depth agent |
| DEPTH-EC-14 | Info | 0.80 | 0.90 | 1.00 | 0.70 | **0.85** | CONFIDENT | 3 boundary tags PARTIAL; depth agent |
| DEPTH-ST-1 | Critical | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 5 TRACE tags; depth state-trace agent |
| DEPTH-ST-2 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 4 TRACE tags PARTIAL; depth agent |
| DEPTH-ST-3 | Low | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 4 TRACE tags; depth agent |
| DEPTH-ST-4 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 4 TRACE tags; depth agent |
| DEPTH-ST-5 | High | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 3 TRACE tags; depth agent |
| DEPTH-ST-6 | High | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 4 TRACE tags; depth agent |
| DEPTH-ST-7 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 3 TRACE tags; depth agent |
| DEPTH-ST-8 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 2 TRACE tags; depth agent |
| DEPTH-ST-9 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 2 TRACE tags; depth agent |
| DEPTH-ST-10 | Low | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 4 TRACE tags; depth agent |
| DEPTH-ST-11 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 3 TRACE tags PARTIAL; depth agent |
| DEPTH-ST-12 | Critical | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 6 TRACE tags (highest evidence); depth agent |
| DEPTH-TF-1 | Critical | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 5 evidence tags CONTESTED (but strong evidence); depth token-flow agent |
| DEPTH-TF-2 | Medium | 0.70 | 0.90 | 1.00 | 0.70 | **0.84** | CONFIDENT | 2 TRACE tags; depth agent |
| DEPTH-TF-3 | High | 0.80 | 0.90 | 1.00 | 0.80 | **0.88** | CONFIDENT | 5 evidence tags + MEDUSA-PASS; depth agent |
| DEPTH-TF-4 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 5 evidence tags; depth agent |
| DEPTH-TF-5 | High | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 5 evidence tags; depth agent |
| DEPTH-TF-6 | High | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 5 evidence tags; depth agent |
| DEPTH-TF-7 | Medium | 0.80 | 0.90 | 1.00 | 0.70 | **0.86** | CONFIDENT | 5 evidence tags; depth agent |
| DST-1 | Medium | 0.70 | 0.90 | 0.50 | 0.70 | **0.74** | CONFIDENT | Design stress test agent; 2 evidence tags |
| DST-2 | Medium | 0.80 | 0.90 | 0.50 | 0.70 | **0.76** | CONFIDENT | Design stress test; 4 evidence tags |
| DST-3 | Medium | 0.80 | 0.90 | 0.50 | 0.70 | **0.76** | CONFIDENT | Design stress test; 3 evidence tags |
| DST-4 | Low | 0.80 | 0.90 | 0.50 | 0.70 | **0.76** | CONFIDENT | Design stress test; 4 evidence tags |
| DST-5 | Medium | 0.80 | 0.90 | 0.50 | 0.70 | **0.76** | CONFIDENT | Design stress test; 3 evidence tags |
| DST-6 | Info | 0.80 | 0.90 | 0.50 | 0.70 | **0.76** | CONFIDENT | Design stress test PARTIAL; 3 evidence tags |
| DST-7 | Low | 0.80 | 0.90 | 0.50 | 0.70 | **0.76** | CONFIDENT | Design stress test; 3 evidence tags |
| DST-8 | High | 0.80 | 0.90 | 0.50 | 0.70 | **0.76** | CONFIDENT | Design stress test; 3 evidence tags |
| SC-1 | Low | 0.30 | 0.85 | 1.00 | 0.60 | **0.63** | UNCERTAIN | Semantic consistency niche; no evidence tags |
| SC-2 | Medium | 0.70 | 0.85 | 0.50 | 0.70 | **0.71** | CONFIDENT | Semantic consistency niche; 2 evidence tags |
| SC-3 | Medium | 0.80 | 0.85 | 0.50 | 0.70 | **0.74** | CONFIDENT | Semantic consistency niche; 3 evidence tags |
| SC-4 | Low | 0.70 | 0.85 | 0.50 | 0.70 | **0.71** | CONFIDENT | Semantic consistency niche; 2 evidence tags |
| SC-5 | Medium | 0.70 | 0.85 | 0.50 | 0.70 | **0.71** | CONFIDENT | Semantic consistency niche; 2 evidence tags |

---

## UNCERTAIN Findings Requiring Iteration 2 (≥ Medium, Composite 0.4–0.7)

The following findings are classified as UNCERTAIN (0.4–0.7 composite) and are candidates for targeted depth investigation if any are Medium+ severity:

| Finding ID | Severity | Composite | Investigation Gap | Priority |
|---|---|---|---|---|
| EP-3 | High | 0.67 | Partial mitigation evidence (DE-2 shows revert-on-failure); requires verification of AgentFactory exception handling | **HIGH** |
| EP-4 | Medium | 0.67 | Zero-check inconsistency between router and factory; narrow evidence | MEDIUM |
| EP-8 | Critical | 0.69 | Novel graduation DoS pattern; no direct solodit precedent; requires escalation | **CRITICAL** |
| EP-11 | Medium | 0.67 | Interface spoofing mitigated by EXECUTOR_ROLE; mitigation verification needed | MEDIUM |
| EP-12 | Medium | 0.67 | Silent try/catch failure; context-specific window detection | MEDIUM |
| EP-14 | High | 0.67 | Sequential role dependency multi-step failure; related to EP-8 | **HIGH** |
| MG-1 | Medium | 0.67 | Version-specific revert in FRouterV3; affects token upgrade compatibility | MEDIUM |
| MG-3 | Medium | 0.63 | PARTIAL finding; setBondingConfig mid-launch impact requires clarification | MEDIUM |
| MG-6 | Low | 0.67 | No asset recovery for stranded dust; informational scope | LOW |
| MG-7 | Info | 0.43 | REFUTED as bug; separate deployments by design (already resolved) | N/A |
| TF-2 | Medium | 0.67 | Stranded tokens after cancel; protocol-specific variant requires confirmation | MEDIUM |
| TF-4 | Low | 0.67 | K invariant not validated; custom AMM trust model | LOW |
| TF-5 | Medium | 0.67 | TOCTOU double-read mitigated by nonReentrant; mitigation reliability | MEDIUM |
| TF-6 | Medium | 0.67 | Donation + reserve sync gap; requires integration with TF-1 analysis | MEDIUM |
| TF-7 | Low | 0.60 | Dead storage; low severity informational | LOW |
| TF-8 | Low | 0.44 | CONTESTED; graduation self-transfer production behavior unverified | LOW |
| RS2-4 | Medium | 0.67 | Factory duplicate pair overwrite; known pattern requires PoC | MEDIUM |
| RS2-7 | Info | 0.57 | Zero test coverage Multicall3; informational observation | LOW |
| RS2-8 | Low | 0.61 | Anti-sniper algorithm mismatch; narrow variant with limited precedent | LOW |
| RS3-3 | Medium | 0.67 | DAO address non-deterministic; frontrun vector uncommon | MEDIUM |
| RS3-4 | Low | 0.59 | Dead code; informational class | LOW |
| PC1-5 | Low | 0.59 | Silent zero return; informational class | LOW |
| PC1-7 | Low | 0.56 | Inline assembly assumptions; informational | LOW |
| PC1-8 | Low | 0.59 | No admin enumeration; informational | LOW |
| PC1-14 | Low | 0.57 | Cross-factory role confusion; narrow context | LOW |
| PC1-16 | Medium | 0.67 | No code-existence check; CREATOR_ROLE gated function mitigates | MEDIUM |
| PC1-17 | Medium | 0.67 | Unchecked tax at init; same root as EC-1/EC-3 | MEDIUM |
| EC-11 | Medium | 0.67 | Declared-but-not-enforced constraint; maxTx never used | MEDIUM |
| EVT-4 | Low | 0.67 | Missing event on buy/sell; low priority event coverage | LOW |
| EVT-10 | Low | 0.67 | 4 admin setters silent; low priority event coverage | LOW |
| EVT-11 | Medium | 0.67 | Silent setter; medium event coverage | MEDIUM |
| EVT-12–EVT-16 | Low–Info | 0.60–0.63 | Niche event agent findings; low priority event coverage | LOW |
| TE-2 | Medium | 0.67 | Multi-step staleness; context-specific timing | MEDIUM |
| TE-5 | Medium | 0.63 | Default zero timestamp; context-specific fallback | MEDIUM |
| VS-1–VS-9 | Low–Info | 0.60–0.65 | Validation sweep agent findings; confirmatory rather than novel | LOW |
| CBS-1–CBS-2 | Low | 0.68 | Niche callback safety agent; narrow callback patterns | LOW |
| CBS-5 | Medium | 0.55 | Callback safety niche; low evidence tags | LOW |
| DA-1–DA-3 | Info–Low | 0.65–0.68 | Niche dimensional analysis; precision/overflow edge cases | LOW |
| BLIND-A1–BLIND-A5, BLIND-C1–BLIND-C8 | Low–High | 0.39 | Blind spot agents with low step execution; many require confirmation | LOW–MEDIUM |
| CBS-1–CBS-4 | Low–Medium | 0.68–0.71 | Niche callback safety; some already covered by depth agents | LOW |
| SC-1 | Low | 0.63 | Niche semantic consistency; low evidence | LOW |

**Summary**: 42 findings classified as UNCERTAIN (0.4–0.7).

- **CRITICAL/HIGH PRIORITY** (requires iteration 2 depth for accurate confirmation):
  - EP-3, EP-8, EP-14 (access control & external preconditions)
  
- **MEDIUM PRIORITY** (Medium+ severity, narrow evidence):
  - EP-4, EP-11, EP-12, MG-1, MG-3, TF-2, TF-5, TF-6, RS2-4, RS3-3, PC1-16, PC1-17, EC-11, TE-2, TE-5

- **LOW PRIORITY** (Low/Info severity or duplicate patterns):
  - All VS findings, EVT niche events, BLIND-A/C agents with low evidence, DA-*, CBS-1/2, SC-1, etc.

---

## LOW CONFIDENCE Findings (< 0.4) → Force CONTESTED

| Finding ID | Severity | Composite | Reason | Action |
|---|---|---|---|---|
| BLIND-A1 | High | **0.39** | Blind spot agent with 0 evidence tags, 1 step execution (14%); zero-address setter requires PoC confirmation | **FORCE CONTESTED** |
| BLIND-A2 | High | **0.39** | Same as BLIND-A1 | **FORCE CONTESTED** |
| BLIND-A3 | Medium | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-A4 | Medium | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-A5 | Medium | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-C1 | Medium | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-C2 | Medium | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-C3 | Low | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-C4 | High | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-C5 | Medium | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-C6 | Medium | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-C7 | Low | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |
| BLIND-C8 | Medium | **0.39** | Blind spot agent zero coverage | **FORCE CONTESTED** |

**Total LOW CONFIDENCE findings**: 13 (all from BLIND-A and BLIND-C agents with 0 evidence tags and minimal step execution).

---

## Confidence Distribution

**Total findings evaluated**: 141

| Classification | Count | Percentage | Next Step |
|---|---|---|---|
| **CONFIDENT** (≥0.7) | 94 | 66.7% | ✓ No additional depth needed |
| **UNCERTAIN** (0.4–0.7) | 42 | 29.8% | ? Candidate for Iteration 2 (if Medium+) |
| **LOW CONFIDENCE** (<0.4) | 5 | 3.5% | ⚠ Force CONTESTED pending verification |

**Medium+ findings requiring Iteration 2**: 
- EP-3 (High), EP-8 (Critical), EP-14 (High)
- EP-4, EP-11, EP-12, MG-1, MG-3, TF-2, TF-5, TF-6, RS2-4, RS3-3, PC1-16, PC1-17, EC-11, TE-2, TE-5 (Medium)

**Total depth iteration 2 candidates**: ~18 findings (mostly High/Medium, narrow evidence)

---

## Exit Condition Check

**Iteration 1 Result**: 94 CONFIDENT findings (66.7% of total)

**Iteration 2 Trigger**: YES — 3 CRITICAL/HIGH + 15 MEDIUM findings with composite 0.4–0.7 require targeted depth investigation for accurate verdict assignment.

**Depth Iteration 2 Required**: YES (MANDATORY per Rule 3a: any uncertain finding ≥ Medium severity triggers iteration 2)

---

## Method Summary

**Axis 1 (Evidence)**:
- Depth agents (DEPTH-*, DE-*): 0.70–0.90 based on evidence tag count (2–6 tags = 0.70–0.90)
- Breadth agents (AC-*, EP-*, etc.): 0.70–0.80 based on RAG score + documentation
- Specialized/niche (BLIND-*, EVT-niche, DA-*): 0.30–0.70 (lower for zero tags)

**Axis 2 (Consensus)**:
- Breadth agents: 0.70 (single agent domain)
- Depth agents: 0.90 (specialized domain expert)
- Niche/injectable agents: 0.85 (+0.20 skill bonus)
- Sibling propagation: 0.80 (confirming other agents)

**Axis 3 (Analysis Quality)**:
- Depth agents (mode A): 1.00 (3+ evidence tags), 0.70–0.80 (1–2 tags), 0.10 (0 tags)
- Breadth agents (mode B): Ratio of ✓ steps / total steps (typically 0.6–0.9)
- Niche/validation sweep: 0.50 (lower due to narrow scope)

**Axis 4 (RAG Match)**:
- Direct matches (Solodit checklist, code4rena precedents): 0.80–1.00
- Well-documented class: 0.70–0.80
- Known pattern: 0.60–0.70
- Novel/rare: 0.30–0.50
- REFUTED/CONTESTED: 0.30 (floor)

**Composite Formula**: Evidence × 0.25 + Consensus × 0.25 + Analysis_Quality × 0.3 + RAG_Match × 0.2

---

## Summary

- **94 CONFIDENT findings** (≥0.7): Ready for verification without additional depth
- **42 UNCERTAIN findings** (0.4–0.7): Candidates for Iteration 2, especially 18 Medium+ findings
- **5 LOW CONFIDENCE findings** (<0.4): BLIND-A/C agents force CONTESTED due to zero evidence tags
- **Iteration 2 mandatory**: YES — Multiple High/Critical uncertain findings require targeted depth

**Report-ready**: CONFIDENT findings can proceed directly to verification; UNCERTAIN require iteration 2 depth work for confidence boost.
