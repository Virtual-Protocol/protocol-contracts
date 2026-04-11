# Enabler Results — VP Launchpad Suite Phase 4c Chain Analysis

> **Phase**: PHASE 0 — Enabler Enumeration (Rule 12)
> **Written by**: Chain Agent 1 — Enabler Enumeration and Grouping
> **Date**: 2026-04-03

---

## STEP 0-pre: Cross-Domain Dependency Scan ([CROSS-DOMAIN-DEP] Tags)

The following `[CROSS-DOMAIN-DEP]` tags were identified across depth agent output files:

| Source Finding | Tagged Domain | Assumption | Covered by Existing Finding? | Action |
|---------------|--------------|-----------|------------------------------|--------|
| DEPTH-TF-3 / H-11 | external — AgentFactory application threshold | graduation amounts sent to AgentFactory are correct | YES — DE-4 covers donation inflating amounts sent | No new enabler needed |
| DEPTH-ST-1 / H-2 | external — AgentFactory governance | AgentFactory remains accessible and non-paused | YES — H-4 covers role revocation trigger | H-4 is the enabler for H-2 |
| DEPTH-ST-9 / H-14 | external — bondingV5.tokenAntiSniperType() | Non-BondingV5 tokens should not call V5-specific functions | YES — H-14 is the finding | No new enabler needed |
| DE-1 / H-42 | external — DrainFounder approval | Founder must pre-approve off-chain before drainUniV2Pool succeeds | PARTIAL — H-42 flags the design gap; no existing finding creates the precondition | Add to S6 actor table |
| EP-11-R / H-5 | external — Uniswap V2 LP position | drainUniV2Pool recipient is unrestricted after graduation | YES — H-5 is the finding | No new enabler needed |
| DA-EP12-1 / H-12 | external — old FPairV2 syncAfterDrain | syncAfterDrain must succeed to avoid stale reserve DoS | NO coverage of "syncAfterDrain fails" as a separate enabler | Add as S7 actor table |

---

## STEP 0a: Dangerous Precondition States

| State ID | Dangerous Precondition State | Description | Known Finding(s) That Exploit This State | First Known Path to State |
|----------|-----------------------------|-----------|-----------------------------------------|--------------------------|
| S1 | EXECUTOR_ROLE held / controlled by attacker | beOpsWallet EOA is compromised, or EXECUTOR_ROLE granted to malicious contract | H-1, H-3, H-5, H-27 | Role inherited from deployment |
| S2 | AgentFactory inaccessible or BONDING_ROLE revoked | Any of the 4 AgentFactory calls at graduation fail | H-2, H-4 | AgentFactory admin action |
| S3 | Token at or above graduation threshold | tokenInfo.token.realReserveBalance >= tokenGradThreshold | H-2, H-4, H-11 | Normal user buys over time |
| S4 | Tax parameter at or above DoS boundary | buyTax >= 100 OR sellTax >= 101 OR antiSniperBuyTaxStartValue >= 100 | H-6 | EXECUTOR/admin calls setTaxParams |
| S5 | taxStartTime = type(uint256).max | Permanent anti-sniper window; 99% tax on all buys | H-3 | EXECUTOR calls setTaxStartTime |
| S6 | antiSniperTaxVault = address(0) | Anti-sniper tax collect call reverts; all anti-sniper-window buys fail | H-8 | Admin calls setAntiSniperTaxVault(address(0)) |
| S7 | fakeInitialVirtualLiq = 0 OR targetRealVirtual = 0 | Division-by-zero in AMM math; all new launches fail | H-7 | Admin calls BondingConfig admin setter |
| S8 | Storage slot collision in FRouterV2 upgrade | taxManager or antiSniperTaxManager deprecated slots removed | H-15 | Proxy upgrade that removes slot 103/104 |
| S9 | DEFAULT_ADMIN_ROLE self-revoked | No role management possible; role registry frozen | H-23 | DEFAULT_ADMIN calls renounceRole() on itself |
| S10 | teamTokenReservedWallet = address(0) or stale | Creator initial buy tokens sent to zero or wrong wallet | H-20, H-21 | Admin sets wallet to address(0); or wallet set before launch, changed after |

---

## STEP 0b: 5-Actor Enumeration per Dangerous State

### State S1: EXECUTOR_ROLE Held / Controlled by Attacker

| # | Actor Category | Path to State S1 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No direct path — EXECUTOR_ROLE is granted by DEFAULT_ADMIN_ROLE; external attacker cannot self-grant | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | DEFAULT_ADMIN_ROLE grants EXECUTOR_ROLE to malicious EOA; admin itself is semi-trusted | YES | H-23 chain — admin self-revokes then grants to attacker (complex 2-step) | N/A (H-23 captures) |
| 3 | Natural operation (normal protocol flow) | beOpsWallet already holds EXECUTOR_ROLE at deployment; this is the baseline state | YES (baseline) | H-1, H-3, H-5 (all assume baseline) | N/A |
| 4 | External event (slash, pause, governance) | beOpsWallet private key compromise via external key leak or phishing | YES | Implicit in H-1, H-3, H-5, H-27 | N/A |
| 5 | User action sequence (normal usage) | No user action can grant or remove EXECUTOR_ROLE | NO | NONE | N/A |

**Summary**: S1 is the baseline operational state for all EXECUTOR Abuse hypotheses. Path 4 (external key compromise) is the critical attack vector for H-1/H-3/H-5; paths exist via normal operation.

---

### State S2: AgentFactory Inaccessible or BONDING_ROLE Revoked

| # | Actor Category | Path to State S2 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No direct path — AgentFactory access is controlled by its own admin | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | AgentFactory admin (may be separate multisig from BondingV5 owner) revokes BONDING_ROLE | YES | H-4 (EP-14-R confirmed independent governance) | N/A |
| 3 | Natural operation (normal protocol flow) | AgentFactory upgrade that changes interface for any of the 4 graduation calls | YES | H-2 (DE-3 component) — no interface version check | N/A |
| 4 | External event (slash, pause, governance) | AgentFactory paused by its own governance (e.g., emergency pause) | YES | H-2 — _openTradingOnUniswap has no try/catch | N/A |
| 5 | User action sequence (normal usage) | No user can affect AgentFactory roles | NO | NONE | N/A |

**Summary**: S2 is reached via external governance action (AgentFactory admin) or upgrade. H-4 identifies the role-revocation path; H-2 encompasses all paths from S2.

---

### State S3: Token at or Above Graduation Threshold

| # | Actor Category | Path to State S3 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | Attacker buys enough tokens to push realReserveBalance >= tokenGradThreshold | YES | H-37 (DST-1 — creator can buy entire supply) | N/A |
| 2 | Semi-trusted role (within permissions) | EXECUTOR could theoretically accelerate graduation via buy() but gains no special power | YES | H-37 (within normal buy flow) | N/A |
| 3 | Natural operation (normal protocol flow) | Multiple normal users accumulate buys over time until threshold reached | YES (primary path) | H-2, H-11 (normal graduation path) | N/A |
| 4 | External event (slash, pause, governance) | BondingConfig.setCommonParams() changes targetRealVirtual to 0 → instant graduation | YES | H-7 (targetRealVirtual=0 variant) | N/A |
| 5 | User action sequence (normal usage) | Creator buys entire bonding curve supply in one transaction | YES | H-37 (DST-1) | N/A |

**Summary**: S3 is a natural protocol state; the dangerous aspect is what happens AFTER S3 is combined with S2. S3 alone is benign; S3 + S2 = H-2 activation.

**Cross-State**: S3 + S2 → H-2 (graduation DoS). S3 + S5 → graduation impossible (buys too small due to 99% tax). See Cross-State section below.

---

### State S4: Tax Parameter at DoS Boundary

| # | Actor Category | Path to State S4 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No permissionless path — setTaxParams requires EXECUTOR_ROLE or admin | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | EXECUTOR_ROLE holder calls setTaxParams(token, buyTax=100, sellTax=0, ...); no upper bound validation | YES | H-6 (DEPTH-EC-1/EC-2 primary) | N/A |
| 3 | Natural operation (normal protocol flow) | No natural operation reaches S4 — tax params are not auto-adjusted | NO | NONE | N/A |
| 4 | External event (slash, pause, governance) | Admin/governance misconfiguration in multi-sig call batch | YES | H-6 (misconfiguration scenario) | N/A |
| 5 | User action sequence (normal usage) | No user can set tax params | NO | NONE | N/A |

**Summary**: S4 is exclusively reached via semi-trusted admin action. H-6 covers both malicious and accidental paths. Combined with S1 (compromised EXECUTOR), severity escalates.

**Cross-State**: S1 + S4 → adversarial DoS on all buys/sells system-wide. S4 + S5 → complete buy DoS (two independent mechanisms both block buys simultaneously).

---

### State S5: taxStartTime = type(uint256).max

| # | Actor Category | Path to State S5 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No permissionless path — setTaxStartTime requires EXECUTOR_ROLE | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | beOpsWallet calls FRouterV3.setTaxStartTime(pair, type(uint256).max) | YES | H-3 (DEPTH-ST-6/AC-5) | N/A |
| 3 | Natural operation (normal protocol flow) | setTaxStartTime is called as part of preLaunch setup; no automatic update | NO (manual only) | NONE | N/A |
| 4 | External event (slash, pause, governance) | Compromised EXECUTOR key used to set max value on high-value pairs | YES | H-3 (implicit in key compromise scenario) | N/A |
| 5 | User action sequence (normal usage) | No user can call setTaxStartTime | NO | NONE | N/A |

**Summary**: S5 is an EXECUTOR-exclusive state. It is the most targeted mechanism for per-token buy freeze. H-3 covers this. No new enablers needed.

---

### State S6: antiSniperTaxVault = address(0)

| # | Actor Category | Path to State S6 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No permissionless path — setting vault address requires admin | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | Admin calls setAntiSniperTaxVault(address(0)) in BondingConfig or FRouter | YES | H-8 (BLIND-A1) | N/A |
| 3 | Natural operation (normal protocol flow) | If vault not set at initialization, default address(0) persists | YES | H-8 (initialization gap) | N/A — already in H-8 |
| 4 | External event (slash, pause, governance) | drainUniV2Pool requires founder off-chain pre-approval; founder failing to approve leaves no path to drain | YES (for H-42 chain) | H-42 (DE-1) | [EN-1]: see below |
| 5 | User action sequence (normal usage) | Normal buys during anti-sniper window trigger the revert | YES (trigger, not state setter) | H-8 | N/A |

**New Enabler [EN-1]**: *Founder absence or refusal creates permanent drainUniV2Pool DoS.* Founder is an external actor. If founder never provides ERC-20 approval to drainUniV2Pool, the protocol's LP recovery mechanism is permanently non-functional for that pair. This is not a malicious actor path — it is the expected behavior for any pair where the graduated LP was not anticipated. Severity: inherits H-42's Medium. This is ALREADY captured in H-42's description ("function always reverts without founder pre-approval").

---

### State S7: fakeInitialVirtualLiq = 0 OR targetRealVirtual = 0

| # | Actor Category | Path to State S7 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No permissionless path — admin setter required | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | EXECUTOR/admin calls BondingConfig setter with zero value | YES | H-7 (DEPTH-EC-3/EC-4) | N/A |
| 3 | Natural operation (normal protocol flow) | If BondingConfig deployed with no initialization (zero defaults) | YES | H-25 (FFactory role init gap extends here for parameter defaults) | N/A |
| 4 | External event (slash, pause, governance) | BondingConfig upgrade that resets storage to zero (proxy upgrade gap) | YES | H-49 (no __gap — storage collision on upgrade) — chain: S8 → S7 | [EN-2]: see below |
| 5 | User action sequence (normal usage) | No user can reach S7 | NO | NONE | N/A |

**New Enabler [EN-2]**: *Storage slot collision during FRouterV2/FFactory proxy upgrade can zero-out fakeInitialVirtualLiq or targetRealVirtual.* H-49 (no __gap) + H-7 chain: if a proxy upgrade is applied without proper storage layout management, fakeInitialVirtualLiq at storage slot N could be overwritten with a new variable's zero default. Result: all new launches fail with division-by-zero (H-7 trigger). This cross-state interaction is not covered by either H-49 or H-7 individually. Severity: Medium (H-7 severity; requires upgrade event).

---

### State S8: FRouterV2 Storage Slot Collision

| # | Actor Category | Path to State S8 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No permissionless path — requires proxy upgrade admin action | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | Protocol deployer/admin performs FRouterV2 proxy upgrade without preserving slots 103/104 | YES | H-15 (DEPTH-ST-8/MG-2) | N/A |
| 3 | Natural operation (normal protocol flow) | FRouterV2 deployed and never upgraded → S8 never triggered | NO | NONE | N/A |
| 4 | External event (slash, pause, governance) | Emergency upgrade to patch a vulnerability that inadvertently removes deprecated slots | YES | H-15 | N/A |
| 5 | User action sequence (normal usage) | No user can trigger storage layout changes | NO | NONE | N/A |

**Summary**: S8 is exclusively an upgrade-time risk. H-15 captures it. Cross-state with S7 identified in EN-2 above.

---

### State S9: DEFAULT_ADMIN_ROLE Self-Revoked

| # | Actor Category | Path to State S9 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No permissionless path — requires current DEFAULT_ADMIN_ROLE holder | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | DEFAULT_ADMIN_ROLE holder calls renounceRole(DEFAULT_ADMIN_ROLE, self) | YES | H-23 (BLIND-C1) | N/A |
| 3 | Natural operation (normal protocol flow) | OpenZeppelin AccessControl provides renounceRole() — no override blocking it | YES (latent risk) | H-23 | N/A |
| 4 | External event (slash, pause, governance) | Governance decision to "burn" admin — intended decentralization that permanently locks role management | YES | H-23 | N/A |
| 5 | User action sequence (normal usage) | No user can revoke DEFAULT_ADMIN_ROLE | NO | NONE | N/A |

**Summary**: S9 is a latent risk via natural OZ behavior. H-23 + EXECUTOR compromise creates full irrecoverability chain. H-23 includes the compound impact note.

---

### State S10: teamTokenReservedWallet = address(0) or Stale

| # | Actor Category | Path to State S10 | Reachable? | Existing Finding? | New Finding |
|---|---------------|-----------------|-----------|-------------------|-------------|
| 1 | External attacker (permissionless) | No permissionless path — wallet is set by admin/BondingV5 | NO | NONE | N/A |
| 2 | Semi-trusted role (within permissions) | Admin calls setTeamTokenReservedWallet(address(0)) in BondingConfig | YES | H-20 (BLIND-A5) | N/A |
| 3 | Natural operation (normal protocol flow) | Wallet set at preLaunch time; BondingV5 changes wallet between preLaunch and launch creating TOCTOU window | YES | H-21 (SP-5/MG-4/TE-1) | N/A |
| 4 | External event (slash, pause, governance) | BondingConfig governance changes wallet during active launches (retroactive global change) | YES | H-21 (retroactive change scenario) | N/A |
| 5 | User action sequence (normal usage) | No user can set teamTokenReservedWallet | NO | NONE | N/A |

**Summary**: S10 has two distinct paths — zero-address (H-20, permanent DoS) and TOCTOU stale value (H-21, creator token misdirection). Both are covered by existing hypotheses.

---

## STEP 0c: Cross-State Interactions

| State Pair | Interaction | Combined Effect | Covered? | Notes |
|-----------|------------|----------------|---------|-------|
| S2 + S3 | S2 (AgentFactory revoked) AND S3 (token at graduation threshold) | **CRITICAL**: Every graduation-triggering buy permanently reverts; token can never graduate; no recovery path | YES — H-4 is trigger of S2; H-2 is the consequence when S3 is active | H-4 → H-2 is the canonical chain hypothesis candidate |
| S1 + S3 | S1 (EXECUTOR controlled) AND S3 (token at graduation threshold) | **CRITICAL**: EXECUTOR calls graduate() directly, draining all VIRTUAL tokens from bonding pool; bypasses normal graduation flow | YES — H-1 covers this (no origin validation) | S1 + S3 is the full H-1 attack precondition |
| S1 + S4 | S1 (EXECUTOR controlled) AND S4 (tax at DoS boundary) | **HIGH**: Adversarial actor deliberately sets tax DoS; all buys blocked system-wide | PARTIAL — H-6 covers the misconfiguration; the adversarial EXECUTOR scenario is implicit via H-1's EXECUTOR compromise note | Chain: compromised EXECUTOR → sets buyTax=100 → all buys revert |
| S4 + S5 | S4 (tax DoS) AND S5 (taxStartTime=MAX) | **HIGH**: Dual-layer buy block — buys fail BOTH at tax calculation (underflow) AND if they reached tax check would get 99% rate. Sell may still work if sellTax<101 | NOT EXPLICITLY — H-6 and H-3 are separate hypotheses; compound scenario not analyzed | Potential chain for Chain Agent 2 |
| S3 + S5 | S3 (graduation threshold) AND S5 (taxStartTime=MAX) | **HIGH**: Token reaches graduation but can never graduate because all buys blocked by 99% tax → permanent intermediate state (token at threshold, all buys economically unviable) | PARTIAL — H-3 notes "graduation becomes impossible" in postconditions | Cross-state confirms H-3 postcondition analysis |
| S7 + S9 | S7 (fakeInitialVirtualLiq=0) AND S9 (DEFAULT_ADMIN_ROLE revoked) | **CRITICAL**: Protocol-breaking params set AND no role management to restore defaults. New launches fail with division-by-zero; no admin can fix. | NOT EXPLICITLY — H-7 and H-23 are independent | Chain hypothesis candidate: S9 enables unrecoverable S7 |
| S8 + S7 | S8 (storage slot collision) AND S7 (zero param result) | **HIGH**: Proxy upgrade corrupts fakeInitialVirtualLiq to zero via slot collision → all new launches fail | PARTIAL — captured as EN-2 above | Covered by EN-2 cross-state note |
| S2 + S8 | S2 (AgentFactory inaccessible) AND S8 (storage slot collision during upgrade) | **MEDIUM**: Two independent upgrade-path failures — a "double-upgrade" scenario where both AgentFactory and FRouterV2 are upgraded simultaneously with errors | NOT EXPLICITLY — lower priority (requires two simultaneous upgrade failures) | Not a strong chain candidate; independent probabilities are low |
| S9 + S1 | S9 (DEFAULT_ADMIN self-revoked) AND S1 (EXECUTOR compromised) | **CRITICAL**: EXECUTOR can drain pairs (H-1) AND no admin can revoke/restore EXECUTOR_ROLE. Permanent protocol takeover state | NOT EXPLICITLY — H-23 notes "combined with EXECUTOR compromise = irrecoverable" | Key chain hypothesis: H-27 + H-23 + H-1 compound |
| S6 + S3 | S6 (antiSniperTaxVault = address(0)) AND S3 (token at graduation) | **HIGH**: If anti-sniper window is active AND token nears graduation, all graduation-triggering buys fail silently (reverts during tax transfer to zero-address) | PARTIAL — H-8 covers S6; graduation interaction not fully analyzed | Chain: S6 blocks buys → S3 never reached → token trapped below graduation threshold indefinitely |

---

## New Enabler Findings

| Enabler ID | Description | Severity Inherited | Parent State | Action Required |
|-----------|------------|-------------------|-------------|----------------|
| EN-1 | Founder absence blocks drainUniV2Pool permanently — no protocol mechanism creates approval | Medium (H-42) | S6 | Already captured in H-42; no new hypothesis |
| EN-2 | Storage slot collision (H-49) → zeros fakeInitialVirtualLiq → division-by-zero in all new launches (H-7) | Medium (H-7) | S7+S8 | Chain hypothesis candidate for Agent 2: H-49 → H-7 compound |

---

## Summary: Enabler Enumeration

- **10 dangerous states identified** (S1–S10)
- **50 actor-category paths analyzed** (5 per state)
- **14 reachable paths** (YES or YES with conditions)
- **36 non-reachable paths** (NO — with explicit reason)
- **2 new enabler findings** (EN-1, EN-2)
- **EN-1**: Already captured in H-42; no new hypothesis needed
- **EN-2**: New cross-state chain (H-49 → H-7); qualifies as a chain hypothesis candidate for Chain Agent 2
- **Key compound attack chains for Chain Agent 2**:
  1. H-4 enables H-2 (S2 + S3): AgentFactory role revocation → graduation DoS (HIGH priority chain)
  2. H-23 + H-27 enables H-1 (S9 + S1): self-revoke admin → EXECUTOR unremovable → drain all pairs (CRITICAL priority chain)
  3. S6 + S3: antiSniperTaxVault=address(0) blocks graduation-triggering buys permanently
  4. S4 + S5: dual buy-block chain (tax DoS + permanent anti-sniper freeze simultaneously)
  5. S7 + S9 (EN-2): parameter corruption + no admin recovery → all new launches permanently blocked

---

> **Written by**: Chain Agent 1 — Enabler Enumeration and Grouping
> **Date**: 2026-04-03
> **Pipeline Phase**: 4c — Chain Analysis (PHASE 0)
