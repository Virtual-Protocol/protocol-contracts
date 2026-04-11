# Semantic Consistency Findings — VP Launchpad Suite

**Agent**: Semantic Consistency Agent (SEMANTIC_CONSISTENCY_AUDIT niche)
**Scope**: FRouterV2.sol, FRouterV3.sol, FFactoryV2.sol, FFactoryV3.sol, BondingV2-V5.sol, BondingConfig.sol, FPairV2.sol
**Checks Executed**: 5 (CHECK 1–5), all completed
**Duplicates filtered**: RS2-8 (anti-sniper algorithm mismatch already identified; this report extends with quantified severity), PC1-14 (role identity already identified), EVT-1 (cancelLaunch emit already identified)

---

## Processing Log

### CHECK 1: Config Variable Unit Consistency — DONE

| Variable | Contract A | Unit in A | Contract B | Unit in B | Match? | Finding? |
|----------|-----------|-----------|-----------|-----------|--------|---------|
| `buyTax` | FFactoryV2.sol:25 | percentage (÷100) | FFactoryV3.sol:33 | percentage (÷100) | YES | None |
| `sellTax` | FFactoryV2.sol:26 | percentage (÷100) | FFactoryV3.sol:34 | percentage (÷100) | YES | None |
| `antiSniperBuyTaxStartValue` | FFactoryV2.sol:27 | COMMENT says "basis points"; CODE uses as percentage | FFactoryV3.sol:35 | No comment; CODE uses as percentage | NO — comment mismatch | **[SC-1]** |
| `antiSniperBuyTaxStartValue` (consumer) | FRouterV2.sol:194-195 | divides by 100 (percentage) | FRouterV3.sol:199-200 | divides by 100 (percentage) | YES (both percentage) | — |
| `initialSupply` | BondingConfig.sol:112 | base units (not wei) | BondingV2.sol:28 | base units (not wei) | YES | None |
| `gradThreshold` | BondingV2/V3/V4 | global storage var, set at init | BondingV5 → `tokenGradThreshold[token]` | per-token mapping, set at preLaunch | DIFFERENT SCHEMA — by design | None (intentional) |
| Anti-sniper window for X_LAUNCH | FRouterV2.sol:345 (BondingV4 path) | 99 seconds (1% per second × 99) | BondingConfig.sol:315 (ANTI_SNIPER_60S) | 60 seconds | NO — different durations | **[SC-2]** |

### CHECK 2: Formula Semantic Drift — DONE

| Formula | Location A | Location B | Match? | Drift? | Finding? |
|---------|-----------|-----------|--------|--------|---------|
| Anti-sniper tax decay | FRouterV2.sol:345-351 | FRouterV3.sol:318 | NO | MAJOR — different algorithms (step-down integer vs. continuous interpolation) | **[SC-3]** (extends RS2-8) |
| Tax calculation (buy normal + anti-sniper) | FRouterV2.sol:194-195 | FRouterV3.sol:199-200 | YES | None | None |
| Tax calculation (sell) | FRouterV2.sol:151 | FRouterV3.sol:158 | YES | None | None |
| AMM pricing (`amountOut = k/newReserve - reserve`) | FRouterV2.sol:99-112 | FRouterV3.sol:99-120 | YES | None | None |
| `getAmountsOut` buy/sell branches | FRouterV2.sol:81-113 | FRouterV3.sol:88-120 | YES | None | None |
| Graduation amount calculation | BondingConfig.sol:224-233 (`calculateGradThreshold`) | BondingV2-V4: hardcoded `gradThreshold` global | DIFFERENT — V5 per-token formula, V2-V4 global; by design | None (intentional architectural difference) |

### CHECK 3: Magic Number Consistency — DONE

| Constant Value | Location A | Purpose A | Location B | Purpose B | Same Purpose? | Discrepancy? |
|--------------|-----------|---------|-----------|---------|------------|------------|
| `100` (tax denominator) | FRouterV2.sol:151,194,195 | percentage denominator | FRouterV3.sol:158,199,200 | percentage denominator | YES | None |
| `99` (start tax) | FRouterV2.sol:291 (comment "99%") | startTax from factory | BondingConfig.sol:29 (comment "99%") | startTax from factory | YES | None |
| `99` (window seconds) | FRouterV2.sol:294 (comment: "99 seconds to 0%") | X_LAUNCH anti-sniper window | BondingConfig ANTI_SNIPER_60S = 60 | X_LAUNCH window | NO — 99 seconds vs 60 seconds | **[SC-2]** (same as CHECK 1) |
| `60` (seconds) | BondingConfig.sol:315 (ANTI_SNIPER_60S) | X_LAUNCH/ACP_SKILL anti-sniper duration | FRouterV2.sol:345 (timeElapsed / 60 for non-X_LAUNCH) | Regular token minute-divisor | DIFFERENT PURPOSES — no confusion | None |
| `5880` (seconds = 98 min) | BondingConfig.sol:317 | ANTI_SNIPER_98M duration | FRouterV2.sol (99 min = 5940s implied by comment) | Regular non-X_LAUNCH full window | NO — 5880s vs 5940s one-off | **[SC-4]** |
| `10000` | BondingConfig.sol:207 (BPS denominator) | reserve bips calculation | FRouterV2.sol:325-326 (BondingV2 liquidity formula K * 10000) | K scaling factor (different domain) | Different purposes; no confusion | None |
| `86400` (seconds) | BondingV5.sol:614 | 24h volume update window | BondingV2.sol (same pattern) | 24h volume update window | YES | None |

### CHECK 4: Interface Semantic Drift — DONE

| Interface.Function | In Contract A | Expected Behavior | In Contract B | Expected Behavior | Semantic Match? |
|-------------------|-------------|-----------------|-------------|-----------------|---------------|
| `IFPairV2.getReserves()` | FRouterV2.sol:92 | reserve1 = VIRTUAL (fake, not balanceOf) | FRouterV3.sol:99 | same | YES | 
| `IFPairV2.assetBalance()` | FRouterV2.sol graduate():235 | real balanceOf(tokenB) | FRouterV3.sol graduate():235 | real balanceOf(tokenB) | YES |
| `IBondingV4ForRouter.isProjectXLaunch()` | FRouterV2.sol:332 | try/catch — non-BondingV4 tokens return false | FRouterV3.sol:293 | `bondingV5.tokenAntiSniperType()` — reverts for non-BondingV5 tokens | DIFFERENT — V2 degrades gracefully; V3 reverts (confirmed by MG-1) | MG-1 already covers this |
| `IAgentTaxForRouter.depositTax()` | FRouterV3.sol:167,210 | Called on taxVault for attribution | FRouterV2.sol | Direct safeTransfer to taxVault (no depositTax) | DIFFERENT interfaces — by version design | RS2-1 already covers zero-tax revert |
| `IFFactoryV2.taxVault()` | FRouterV2.sol:154 | address that receives sell tax directly | FRouterV3.sol:161 | address that receives depositTax() call | Different assumptions — V3 assumes taxVault is IAgentTax contract | RS2-1 already covers |

### CHECK 5: Version Migration Semantic Consistency — DONE

| Concept | BondingV2/V3/V4 Behavior | BondingV5 Behavior | Semantic Drift | Impact |
|---------|------------------------|-------------------|---------------|--------|
| `cancelLaunch` → `trading` flag | Does NOT set `trading=false`; token remains in trading=true state post-cancel | DOES set `trading=false` | YES — inconsistency | **[SC-5]** |
| Graduation threshold | Single global `gradThreshold` variable, shared by all tokens | Per-token `tokenGradThreshold[token]` set at preLaunch | By design | No issue |
| Anti-sniper window type | FRouterV2: X_LAUNCH = 99 seconds (isProjectXLaunch check), Regular = 99 minutes (1% per minute) | FRouterV3/BondingConfig: ANTI_SNIPER_60S = 60 seconds (no 99s window type exists) | YES — window changed between versions | [SC-2] |
| Team token reserved wallet | BondingV2-V4: stored in `launchParams.teamTokenReservedWallet` (fixed at init) | BondingV5: always read fresh from `bondingConfig.teamTokenReservedWallet()` at both preLaunch and launch | By design but creates staleness window | MG-4 already covers |
| Anti-sniper `99 minute` full window | FRouterV2: Regular tokens: 99 minutes (99 × 60 = 5940 seconds) | FRouterV3: ANTI_SNIPER_98M = 5880 seconds (98 minutes) | YES — 60-second gap | **[SC-4]** |

---

## Finding [SC-1]: `antiSniperBuyTaxStartValue` Comment in FFactoryV2 Declares "Basis Points" but Variable Is Used as Percentage

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3 | ✓4,5
**Rules Applied**: [R14:✗(no aggregate/settable constraint), R16:✗(no oracle), R13:✓]
**Severity**: Low
**Location**: FFactoryV2.sol:27
**Description**: The storage variable `antiSniperBuyTaxStartValue` carries the comment `// Starting tax value for anti-sniper (in basis points)`. In practice, FRouterV2 and FRouterV3 both consume this value as a **percentage** (dividing by 100 at FRouterV2.sol:194-195 and FRouterV3.sol:199-200). The comment is factually incorrect. FFactoryV3.sol:35 omits any unit comment, implying the same variable is treated correctly there.

**Impact**: Incorrect comment does not affect execution (the code is semantically consistent across both routers), but a misconfigured deployment that sets `antiSniperBuyTaxStartValue = 9900` (expecting BPS for 99%) would deliver a starting anti-sniper tax of `9900%`, causing `normalTax + antiSniperTax > 99` branch (FRouterV2.sol:190-191 / FRouterV3.sol:194-196) to trigger an underflow revert for any buyTax > 0, bricking all buys — which is also the impact of confirmed finding EC-1. The misleading comment is the direct path to that misconfiguration.

**Evidence**:
```solidity
// FFactoryV2.sol:27 — comment claims BPS
uint256 public antiSniperBuyTaxStartValue; // Starting tax value for anti-sniper (in basis points)

// FRouterV2.sol:194-195 — used as percentage (÷100)
uint256 normalTxFee = (normalTax * amountIn) / 100; // tax is in percentage
uint256 antiSniperTxFee = (antiSniperTax * amountIn) / 100; // tax is in percentage

// FRouterV2.sol:320 — retrieved as "99%"
uint256 startTax = factory.antiSniperBuyTaxStartValue(); // 99%
```

---

## Finding [SC-2]: X_LAUNCH Anti-Sniper Window Changed from 99 Seconds (BondingV4/FRouterV2) to 60 Seconds (BondingV5/BondingConfig) Without Name or Constant Alignment

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R8:✓, R13:✓, R14:✗(no settable constraint)]
**Depth Evidence**: [BOUNDARY:isXLaunch=true → taxReduction=timeElapsed (1% per second, cap at 99 seconds)], [VARIATION:ANTI_SNIPER_60S duration=60 → cap at 60 seconds]
**Severity**: Medium
**Location**: FRouterV2.sol:342-345, BondingConfig.sol:30-32, 314-315
**Description**: BondingV4 (operating through FRouterV2) implements the X_LAUNCH anti-sniper tax as a 99-second linear decay: `taxReduction = timeElapsed` with `startTax = 99`, so tax reaches 0% at t=99 seconds. BondingV5 (operating through FRouterV3 and BondingConfig) uses `ANTI_SNIPER_60S = 60 seconds` for ALL special launches (X_LAUNCH and ACP_SKILL). The constant `ANTI_SNIPER_60S` is named "60S" yet X_LAUNCH tokens in V4 had a 99-second window. This is a silent semantic change between versions: tokens that would have had 99 seconds of protection in BondingV4 now get only 60 seconds in BondingV5.

Additionally, FRouterV2's own comment at line 294 explicitly states "decreases by 1% per second to 0% over 99 seconds" for X_LAUNCH, while the BondingConfig constant ANTI_SNIPER_60S = 60 is in direct contradiction.

**Impact**: BondingV5 X_LAUNCH tokens lose 39 seconds (39%) of anti-sniper tax protection compared to BondingV4 X_LAUNCH tokens. Snipers can front-run or buy at a reduced tax 39 seconds earlier than implied by the V4 precedent. The difference is per-token and non-configurable after preLaunch.

**Evidence**:
```solidity
// FRouterV2.sol:292-351 — X_LAUNCH = 1% per second = 99-second window
// X_LAUNCH: 1% per second (99 seconds to 0%)
uint256 taxReduction = isXLaunch ? timeElapsed : (timeElapsed / 60);
// at t=60: taxReduction=60, tax = 99-60 = 39%  (still active)
// at t=99: taxReduction=99, tax = 0             (window ends)

// BondingConfig.sol:31, 314-315 — ANTI_SNIPER_60S = 60 seconds
uint8 public constant ANTI_SNIPER_60S = 1; // 60 seconds duration (default)
} else if (antiSniperType_ == ANTI_SNIPER_60S) {
    return 60; // 60 seconds
// at t=60: window ends, tax = 0 (39 seconds early)
```

### Postcondition Analysis
**Postconditions Created**: BondingV5 X_LAUNCH tokens permanently have 60-second anti-sniper window; no mechanism to extend to 99 seconds.
**Postcondition Types**: STATE
**Who Benefits**: Early buyers in the 60–99 second window post-launch avoid anti-sniper tax that V4 equivalents would have faced.

---

## Finding [SC-3]: Anti-Sniper Tax Decay Algorithm Is Structurally Different Between FRouterV2 and FRouterV3 — Up to ~20% Absolute Deviation at Mid-Window

**Verdict**: CONFIRMED (extends RS2-8 which characterized this only as "rounds toward zero")
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R10:✓, R13:✓]
**Depth Evidence**: [BOUNDARY:timeElapsed=30s, X_LAUNCH → V2: 99-30=69%, V3: 99*(60-30)/60=49%], [VARIATION:timeElapsed 1→59, duration=60 → V3 uses proportional formula, V2 uses integer subtraction], [TRACE:at t=50s → V2 outputs 49%, V3 outputs 99*(60-50)/60=16%]
**Severity**: Medium
**Location**: FRouterV2.sol:345-351, FRouterV3.sol:317-318
**Description**: The two router versions implement structurally different algorithms for computing anti-sniper tax:

**FRouterV2 (step-down integer subtraction):**
```
taxReduction = isXLaunch ? timeElapsed : (timeElapsed / 60)
tax = startTax - taxReduction   // integer floor subtraction
```
For non-X_LAUNCH tokens: tax decreases by exactly 1% every 60 seconds (99 steps → 99 minutes to zero). For X_LAUNCH: 1% per second over 99 seconds.

**FRouterV3 (continuous linear interpolation):**
```
tax = startTax * (duration - timeElapsed) / duration   // proportional, rounded toward zero
```
For ANTI_SNIPER_60S (duration=60): at t seconds, tax = `99 * (60 - t) / 60`.

The deviation is substantial and monotone within the window:
- At t=1s (ANTI_SNIPER_60S): V3 = `99*59/60 = 97%`; V2 equivalent for 60-second X_LAUNCH would be `99-1 = 98%`. Difference: 1%.
- At t=30s: V3 = `99*30/60 = 49%`; V2 (if 60s window) = `99-30 = 69%`. Difference: **20% absolute**.
- At t=59s: V3 = `99*1/60 = 1%`; V2 = `99-59 = 40%`. Difference: **39% absolute**.

V3 consistently delivers **lower tax** than the equivalent V2 formula at all mid-window timestamps. This is not a rounding artifact — it is a fundamentally different tax schedule.

**Impact**: Users transacting on BondingV5 tokens (FRouterV3) pay significantly less anti-sniper tax at mid-window timestamps compared to the implied design from FRouterV2. This reduces fee revenue and weakens sniper protection. The larger deviation at mid-window means the actual protection period ends much sooner functionally (tax drops below 50% at t=30s vs t=50s under V2). RS2-8 characterized this as "rounding," but the actual mechanism difference is algorithmic.

**Evidence**:
```solidity
// FRouterV2.sol:345-351 — step-down subtraction
uint256 taxReduction = isXLaunch ? timeElapsed : (timeElapsed / 60);
if (startTax <= taxReduction) { return 0; }
return startTax - taxReduction;

// FRouterV3.sol:317-318 — continuous proportional interpolation
// Linear decrease: tax = startTax * (duration - timeElapsed) / duration
return startTax * (duration - timeElapsed) / duration;
```

### Precondition Analysis
**Missing Precondition**: Both routers serve different versions of bonding — V2 serves BondingV2/V3/V4 tokens; V3 serves BondingV5 tokens. The V3 algorithm applies only to BondingV5 tokens. No single token is served by both routers simultaneously.
**Precondition Type**: STATE (version routing is per-token)
**Why This Blocks**: Both algorithms are in production but apply to different token populations. However, V5 tokens that migrate or are compared against V4 equivalents will have a materially weaker protection schedule under V3's formula.

---

## Finding [SC-4]: ANTI_SNIPER_98M Duration (98 Minutes = 5880 Seconds) Contradicts FRouterV2 Regular Token Window (99 Minutes = 5940 Seconds)

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R10:✓, R13:✓, R14:✗]
**Depth Evidence**: [BOUNDARY:timeElapsed=5880s (98 min) → FRouterV2 regular: 99-5880/60=99-98=1% tax still active; FRouterV3/BondingConfig: tax=0], [BOUNDARY:timeElapsed=5940s (99 min) → FRouterV2: tax=0; BondingConfig ANTI_SNIPER_98M: already expired at 5880s]
**Severity**: Low
**Location**: BondingConfig.sol:32, 317; FRouterV2.sol:344-351
**Description**: BondingV4 regular tokens (non-X_LAUNCH) under FRouterV2 have a 99-minute anti-sniper window. The comment at FRouterV2.sol:344 states: "ACP_SKILL: 1% per minute (99 minutes to 0%)". This implies a 99-minute = 5940-second window.

BondingConfig introduces `ANTI_SNIPER_98M = 2` with `getAntiSniperDuration` returning 5880 seconds (98 minutes). This is 60 seconds shorter than the V4 regular-token window. The constant name includes "98M" (98 minutes) which does not match the 99-minute precedent from FRouterV2.

Under FRouterV3's proportional formula with duration=5880s, tax reaches 0% at t=5880s (98 minutes). Under FRouterV2's step-down formula, regular tokens reach 0% at t=5940s (99 minutes). The ANTI_SNIPER_98M constant silently shortens the maximum anti-sniper window by 1 minute (60 seconds) relative to the V2 precedent.

**Impact**: Tokens using ANTI_SNIPER_98M in BondingV5 lose 60 seconds of anti-sniper protection at the tail end of the window compared to BondingV4 regular tokens. Combined with the proportional formula difference (SC-3), the effective protection at t=5880s under V3 is 0% vs 1% under V2 — a 1% absolute difference at the boundary, which is low severity on its own but consistent with a pattern of systematically reduced protection.

**Evidence**:
```solidity
// BondingConfig.sol:32, 317
uint8 public constant ANTI_SNIPER_98M = 2; // 98 minutes duration
return 5880; // 98 minutes = 98 * 60 = 5880 seconds

// FRouterV2.sol:343-345 (comment for regular/ACP_SKILL)
// ACP_SKILL: 1% per minute (99 minutes to 0%)
// Regular: 1% per minute (99 minutes to 0%)
uint256 taxReduction = isXLaunch ? timeElapsed : (timeElapsed / 60);
// 99 * 60 = 5940 seconds implied
```

---

## Finding [SC-5]: `cancelLaunch()` Sets `trading=false` in BondingV5 but NOT in BondingV2/V3/V4 — Cross-Version State Semantic Inconsistency

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R13:✓, R5:✓, R10:✓]
**Depth Evidence**: [VARIATION:cancelLaunch() in V2/V3/V4 → trading remains true; in V5 → trading set to false], [TRACE:BondingV2.cancelLaunch():412 → trading unchanged; BondingV5.cancelLaunch():488 → trading=false]
**Severity**: Medium
**Location**: BondingV2.sol:387-420, BondingV3.sol:322-355, BondingV4.sol:394-427, BondingV5.sol:462-497
**Description**: In BondingV2, BondingV3, and BondingV4, `cancelLaunch()` sets only:
- `_token.initialPurchase = 0`
- `_token.launchExecuted = true`

It does **not** set `trading = false`. The token therefore remains in a state where `trading == true` even after cancellation. For BondingV2/V3/V4, the `buy()` and `sell()` functions gate on `trading`, meaning a cancelled token in V2/V3/V4 technically still allows buy/sell calls until `launchExecuted` gate also rejects them. In practice the `launchExecuted` check blocks sells, but the `trading` flag inconsistency creates a semantic gap.

BondingV5.cancelLaunch() explicitly sets `tokenRef.trading = false` at line 488, which is the correct terminal state for a cancelled token. This inconsistency means:

1. Monitoring systems that read `tokenInfo[token].trading` to determine if a token is active will see `trading=true` for cancelled BondingV2/V3/V4 tokens, misidentifying them as live.
2. Any future logic that gates on `trading` without also checking `launchExecuted` would allow unintended interactions with V2/V3/V4 cancelled tokens.
3. The `tokenAntiSniperType()` gating and related external integrations assume `trading=false` implies cancellation — this assumption only holds for BondingV5.

**Impact**: Monitoring, analytics, and future integrations that query `trading` for BondingV2-V4 tokens will receive semantically incorrect `true` for cancelled tokens. If a future router or contract iterates over tokens assuming `trading=false` means "inactive," BondingV2-V4 cancelled tokens will be misclassified. Direct fund loss risk is low (buy/sell gating still blocks execution via `launchExecuted`), but monitoring blindspot and integration error risk is Medium.

**Evidence**:
```solidity
// BondingV2.sol:411-412 — NO trading=false on cancel
_token.initialPurchase = 0; // prevent duplicate transfer
_token.launchExecuted = true; // pretend it has been launched (cancelled)
// trading flag: unchanged (remains true)

// BondingV5.sol:487-489 — correctly sets trading=false on cancel
tokenRef.initialPurchase = 0;
tokenRef.trading = false;     // ← PRESENT only in V5
tokenRef.launchExecuted = true;
```

### Postcondition Analysis
**Postconditions Created**: BondingV2/V3/V4 cancelled tokens permanently remain with `trading=true` and `launchExecuted=true` — a state combination that does not exist in BondingV5 for cancelled tokens.
**Postcondition Types**: STATE
**Who Benefits**: Monitoring or integration systems that assume all versioned tokens follow V5's state model.

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|-----------|----------|---------------------|---------|----------|-------------------|--------------------|
| SC-1 | FFactoryV2.sol:27 | `antiSniperBuyTaxStartValue` comment says "basis points" but code uses as percentage; misconfiguration path to EC-1 DoS | CONFIRMED | Low | CONFIG | REVERT_DOS |
| SC-2 | FRouterV2.sol:342-345, BondingConfig.sol:31,315 | X_LAUNCH anti-sniper window silently shortened from 99s (BondingV4/FRouterV2) to 60s (BondingV5/BondingConfig) | CONFIRMED | Medium | DESIGN_DRIFT | TAX_BYPASS |
| SC-3 | FRouterV2.sol:345-351, FRouterV3.sol:317-318 | Anti-sniper decay is step-down integer subtraction in V2 vs. continuous linear interpolation in V3; up to 39% absolute deviation at mid-window | CONFIRMED | Medium | DESIGN_DRIFT | TAX_BYPASS |
| SC-4 | BondingConfig.sol:32,317; FRouterV2.sol:344 | ANTI_SNIPER_98M = 5880s (98 min) is 60s shorter than FRouterV2 regular-token 99-minute window (5940s implied) | CONFIRMED | Low | DESIGN_DRIFT | TAX_BYPASS |
| SC-5 | BondingV2.sol:387-420, BondingV3.sol:322-355, BondingV4.sol:394-427, BondingV5.sol:462-497 | cancelLaunch() does not set trading=false in V2/V3/V4 but does in V5; cancelled V2-V4 tokens remain with trading=true | CONFIRMED | Medium | DESIGN_DRIFT | MONITORING_BLINDSPOT |
