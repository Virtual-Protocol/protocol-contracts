# Chain Hypotheses — VP Launchpad Suite Phase 4c

> **Written by**: Chain Agent 2 — Chain Matching and Composition Coverage
> **Date**: 2026-04-03
> **Pipeline Phase**: 4c — Chain Analysis (PHASE 2)

---

## Chain Summary Table

| Chain ID | Finding A (Blocked) | Missing Precondition | Finding B (Enabler) | Postcondition Match | Chain Severity |
|----------|--------------------|--------------------|--------------------|--------------------|---------------|
| CH-1 | H-2 (Graduation Permanent DoS) | AgentFactory inaccessible / BONDING_ROLE revoked [STATE] | H-4 (BONDING_ROLE Revocation) | Activates AgentFactory failure state → all graduation calls revert | **Critical** ↑ (from High+Critical) |
| CH-2 | H-1 (EXECUTOR Drains Pools) | EXECUTOR_ROLE permanently irrevocable [ACCESS] | H-23 + H-27 (Admin self-revoke + EXECUTOR self-removal threat) | DEFAULT_ADMIN_ROLE gone → EXECUTOR_ROLE cannot be revoked → drain persists without recovery | **Critical** (existing + irrecoverability) |
| CH-3 | H-8 (antiSniperTaxVault=0 Blocks Graduation Buys) | Token at or near graduation threshold [STATE] | H-7 / H-37 (zero param OR creator front-run moves threshold) | S6 active during graduation approach → graduation-triggering buys permanently blocked | **High** ↑ (from High+Medium) |
| CH-4 | H-6 (Tax DoS Buys) | taxStartTime manipulation also active [STATE] | H-3 (taxStartTime=MAX_UINT) | Dual independent buy-block: tax underflow (H-6) AND 99% sniper tax (H-3) trigger simultaneously | **High** (H-6 standalone + reinforced) |
| CH-5 | H-7 (Zero Param Division-by-Zero) | Admin recovery path permanently removed [ACCESS] | H-24 (renounceOwnership unguarded) | BondingConfig owner permanently removed → zero param cannot be corrected → all new launches permanently blocked | **High** ↑ (from High+Medium, unrecoverable) |
| CH-6 | H-43 (Comment Says "Basis Points") | Admin follows documentation, sets 9900 | H-16 (antiSniperBuyTaxStartValue + buyTax sum not enforced) | Admin sets value per misleading comment → sum > 99 → all anti-sniper buys DoS (H-6 underflow triggered) | **High** ↑ (from Info+Medium) |
| CH-7 | H-2 (Graduation Permanent DoS) | Token at graduation threshold when AgentToken has transfer tax | H-11 (Donation inflates graduation amounts) + EP-10 (AgentToken transfer tax at graduation) | Donation shifts pool ratio; AgentToken transfer tax reduces actual transferred amounts below addLiquidity minimums → graduation reverts → H-2 loop activated | **Critical** ↑ (EP-10+H-11+H-2) |

---

## Detailed Chain Hypotheses

---

## Chain Hypothesis CH-1: BONDING_ROLE Revocation Triggers Permanent Graduation DoS (High Priority)

### Blocked Finding (A)
- **ID**: H-2, **Title**: Graduation Failure — Permanent Per-Token DoS With No Admin Recovery
- **Original Severity**: Critical (EP-8, DEPTH-ST-1)
- **Verdict**: CONFIRMED (with precondition dependency on external trigger)
- **Missing Precondition**: AgentFactory must fail during graduation — role revocation, pause, or interface change
- **Precondition Type**: STATE (external governance action creating state S2)
- **Current status**: H-2 is CONFIRMED standalone, but the "how does S2 get triggered?" path is documented separately in H-4

### Enabler Finding (B)
- **ID**: H-4, **Title**: AgentFactory BONDING_ROLE Revocation Triggers Systemic Graduation DoS
- **Original Severity**: High (EP-14, EP-14-R Iter3)
- **Verdict**: CONFIRMED (independent governance event)
- **Postcondition Created**: BONDING_ROLE permanently revoked from BondingV5 on AgentFactoryV7; all 3+ required AgentFactory calls at graduation revert
- **Postcondition Type**: STATE — permanent role absence enabling H-2

### Chain Match
- **Match Strength**: STRONG
- **Match Reasoning**: H-4's postcondition (AgentFactory graduation calls revert permanently) is EXACTLY the precondition H-2 requires (any of the 4 sequential AgentFactory graduation calls fail). H-4 is the specific mechanism by which S2 is reached. H-2 documents the consequence once S2 is in place. The cross-state interaction S2+S3 from enabler_results.md directly confirms this chain.

### Combined Attack Sequence
1. **[Step from H-4]**: AgentFactory admin (independent governance from BondingV5) calls `revokeRole(BONDING_ROLE, address(BondingV5))` on AgentFactoryV7. This is within AgentFactory's normal governance powers and may occur as part of a system upgrade or security incident.
2. **[State reached]**: BondingV5 no longer holds BONDING_ROLE on AgentFactory. Any of the 3+ AgentFactory calls inside `_openTradingOnUniswap()` will revert with an access control error.
3. **[Step from H-2 part 1]**: A user buys enough tokens to push `realReserveBalance >= tokenGradThreshold`. BondingV5 calls `_openTradingOnUniswap()`, which calls AgentFactory. AgentFactory reverts. The entire buy() transaction reverts.
4. **[Step from H-2 part 2]**: `tokenInfo[token].trading` remains `true`. The token is still in "trading" state, above graduation threshold. Every subsequent buy that tries to push through the graduation threshold re-enters `_openTradingOnUniswap()` and reverts again. Small buys below the graduation threshold still work, but no buy can succeed if it would trigger graduation.
5. **[Impact]**: Token is permanently locked in a "graduation loop" — always above or at the threshold, can never graduate, cannot be cancelled (launchExecuted was set true on first failed attempt scenario, or cancelLaunch blocked by trading state). No admin setter exists for `tokenInfo.trading`, `tokenInfo.tradingOnUniswap`, or `tokenGradThreshold`. EXECUTOR cannot trigger graduation directly via H-1 because pair validation (or the same AgentFactory calls) would fail. The token is effectively dead for all practical purposes.

### Severity Reassessment
- **Finding A original**: Critical
- **Finding B original**: High
- **Chain Severity**: **Critical** (H-4 + H-2 = Critical per matrix: HIGH enabler + CRITICAL consequence = CRITICAL)
- **Upgrade reason**: H-4 was analyzed as High in isolation (role revocation requires external admin action). Combined with H-2 (Critical), the chain demonstrates that a single governance action by an independent multisig permanently bricks all tokens at graduation threshold — no user recovery, no admin recovery from BondingV5 side. The combined blast radius (every token at or above threshold at time of revocation) elevates this to the most severe chain.
- **Chain ID**: CH-1

---

## Chain Hypothesis CH-2: EXECUTOR_ROLE Irrevocability Compound (Irrecoverable Protocol Takeover)

### Blocked Finding (A)
- **ID**: H-1, **Title**: EXECUTOR_ROLE Can Graduate Any Pair, Draining All Bonding Curve Pools
- **Original Severity**: Critical
- **Verdict**: CONFIRMED
- **Missing Precondition for irrecoverability**: DEFAULT_ADMIN_ROLE must be absent or unable to revoke EXECUTOR_ROLE — otherwise, compromised EXECUTOR can be revoked
- **Precondition Type**: ACCESS (DEFAULT_ADMIN_ROLE must be present/functional to provide recovery)
- **Current status**: H-1 is CONFIRMED as a standalone Critical, but recovery is possible if DEFAULT_ADMIN_ROLE can revoke the compromised EXECUTOR

### Enabler Finding (B)
- **ID**: H-23, **Title**: DEFAULT_ADMIN_ROLE Can Self-Revoke, Locking Role Management Permanently
- **Original Severity**: Medium
- **Verdict**: CONFIRMED
- **Postcondition Created**: DEFAULT_ADMIN_ROLE no longer exists in the system; no account can grant or revoke EXECUTOR_ROLE, ADMIN_ROLE, or any other AccessControl role
- **Postcondition Type**: ACCESS

### Supporting Enabler (B2)
- **ID**: H-27, **Title**: EXECUTOR_ROLE Self-Removal via renounceRole() — Permanent Trading Halt
- **Original Severity**: High
- **Postcondition Created**: EXECUTOR_ROLE can be removed from the legitimate operator; if attacker ALSO holds EXECUTOR_ROLE, attacker can remove the legitimate operator while retaining their own EXECUTOR_ROLE

### Chain Match
- **Match Strength**: STRONG
- **Match Reasoning**: H-23 creates permanent ACCESS loss: no account can call grantRole(EXECUTOR_ROLE) or revokeRole(EXECUTOR_ROLE). This means if a malicious actor acquires EXECUTOR_ROLE (via key compromise of beOpsWallet or a separate grant), there is no on-chain recovery path. H-27 adds that the legitimate EXECUTOR can be removed (either by accident or by attacker calling renounceRole on legitimate wallet), leaving only the attacker's EXECUTOR_ROLE. Combined with H-1, this creates an irrecoverable drain state.

### Combined Attack Sequence
**Scenario: Compromise + Admin Removal**
1. **[External event]**: beOpsWallet EOA private key is compromised (phishing, supply-chain attack on deployer CI/CD).
2. **[Step from H-23 enabler]**: Attacker uses compromised DEFAULT_ADMIN_ROLE (if beOpsWallet also holds it, or via a separate compromise) to grant EXECUTOR_ROLE to attacker-controlled address, then calls `renounceRole(DEFAULT_ADMIN_ROLE, self)`. DEFAULT_ADMIN_ROLE is now unrecoverable — no on-chain mechanism can re-grant it.
3. **[Step from H-27 enabler]**: Attacker calls `renounceRole(EXECUTOR_ROLE, beOpsWallet)` to remove the legitimate EXECUTOR. Attacker retains their own EXECUTOR_ROLE.
4. **[Step from H-1]**: Attacker calls `FRouterV3.graduate(pair)` for each active bonding pair. Each call drains all VIRTUAL and agent tokens from FPairV2 to the attacker's address. No origin validation in graduate().
5. **[Impact]**: All VIRTUAL from all active bonding curve pools drained to attacker. Recovery is permanently impossible: DEFAULT_ADMIN_ROLE gone (cannot revoke attacker EXECUTOR_ROLE), no upgrade mechanism confirmed, no emergency pause without EXECUTOR_ROLE.

### Severity Reassessment
- **Finding A original**: Critical (H-1)
- **Finding B original**: Medium (H-23) + High (H-27)
- **Chain Severity**: **Critical** (chain combines existing Critical with irrecoverability dimension — the irrecoverability aspect elevates this from a Critical-with-recovery to a Critical-without-recovery state)
- **Chain ID**: CH-2

---

## Chain Hypothesis CH-3: antiSniperTaxVault=0 Blocks Graduation-Triggering Buys Permanently

### Blocked Finding (A)
- **ID**: H-2, **Title**: Graduation Failure — Permanent Per-Token DoS With No Admin Recovery
- **Original Verdict**: CONFIRMED — but H-2 requires AgentFactory to fail as the precondition
- **Also involved**: H-8 (antiSniperTaxVault=0 bricks all anti-sniper window buys)
- **Missing Precondition**: For H-8 as an enabler of graduation DoS, token must be at graduation threshold AND anti-sniper window must be active when graduation-triggering buy is attempted
- **Precondition Type**: TIMING + STATE

### Enabler Finding (B)
- **ID**: H-8, **Title**: antiSniperTaxVault Zero-Address Bricks All Buys in Anti-Sniper Window
- **Original Severity**: High (BLIND-A1)
- **Verdict**: CONFIRMED
- **Postcondition Created**: All buy() calls during anti-sniper window revert (safeTransferFrom to address(0)); if the anti-sniper window overlaps with graduation threshold crossing, no graduation-triggering buy can succeed during that window
- **Postcondition Type**: TIMING + STATE

### Secondary Context: H-37 / H-7 Interaction
- H-37 (creator buys entire supply, instant graduation) + H-7 (targetRealVirtual=0 causes near-zero threshold) = graduation threshold reached during anti-sniper window → H-8 blocks the graduation-triggering buy if anti-sniper window is active

### Chain Match
- **Match Strength**: MODERATE
- **Match Reasoning**: H-8 creates a TIMING-bounded DoS that coincides with graduation. Unlike H-2 (permanent DoS), this is bounded by the anti-sniper window duration (99s for FRouterV2, 60s for FRouterV3). However, if the token's graduation threshold is reached during the anti-sniper window (possible via H-37 or normal accumulation near launch), ALL graduation-triggering buys fail during that window. Once the window expires, buys can succeed again. The DoS is temporary BUT if combined with H-2 conditions (i.e., a failed graduation attempt persists into H-2's permanent loop), the temporary DoS becomes permanent.

### Combined Attack Sequence
1. **[Setup]**: Admin sets antiSniperTaxVault=address(0) (H-8).
2. **[State reached]**: Token launches, trading begins. Anti-sniper window is active (60-99 seconds).
3. **[Graduation timing]**: Creator or large buyer accumulates to graduation threshold during anti-sniper window (e.g., creator pre-loaded large initial purchase via H-37 that brings token close to threshold).
4. **[Blocked by H-8]**: Graduation-triggering buy is attempted. FRouterV3.buy() reaches anti-sniper tax calculation, computes antiSniperTaxFee, calls safeTransferFrom(from, address(0), antiSniperTaxFee) → ERC20 reverts. Graduation-triggering buy fails.
5. **[H-2 activation]**: If the graduation attempt was processed far enough that `_openTradingOnUniswap()` was partially entered before the revert (depends on execution order), H-2's permanent DoS may activate. More likely: H-8 prevents the graduation-triggering buy from reaching `_openTradingOnUniswap()` entirely, so H-2 is NOT activated. The buy simply reverts. After the anti-sniper window expires, normal graduation proceeds.
6. **[Worst case]**: If H-7 (targetRealVirtual=0) is also active, graduation threshold is near-zero, and the first graduation-triggering buy during the anti-sniper window activates H-2. H-8 blocks recovery buys. H-2 loop is permanent.

### Severity Reassessment
- **Finding A original**: High (H-8) / Critical (H-2)
- **Finding B context**: The H-8+H-2 combination is HIGH standalone (H-8 is time-bounded)
- **Chain Severity**: **High** (H-8 + H-37 enabling graduation during anti-sniper window = High; H-8 alone as graduation blocker = temporarily bounded, not permanent without H-2 co-condition)
- **Upgrade reason**: H-8 + H-2 activation path (if graduated enough to trigger _openTradingOnUniswap partially) would be Critical, but this requires specific ordering. High is conservative and appropriate for the bounded timing attack.
- **Chain ID**: CH-3

---

## Chain Hypothesis CH-4: Dual Buy-Block — Tax DoS + Permanent Anti-Sniper Freeze Simultaneously

### Blocked Finding (A)
- **ID**: H-6, **Title**: Global Tax Parameter Without Upper Bound — Admin-Settable DoS on Buy/Sell
- **Original Severity**: High
- **Verdict**: CONFIRMED
- **Postcondition Created**: All buys revert (buyTax>=100 underflow); creates state S4
- **Precondition for this chain**: buyTax DoS AND taxStartTime DoS active simultaneously on same pair

### Enabler Finding (B)
- **ID**: H-3, **Title**: EXECUTOR_ROLE Anti-Sniper Tax Manipulation — Permanent Buy Freeze
- **Original Severity**: High
- **Verdict**: CONFIRMED
- **Postcondition Created**: 99% anti-sniper tax applied permanently to all buys on that pair; creates state S5

### Chain Match
- **Match Strength**: MODERATE
- **Match Reasoning**: H-6 (buyTax DoS) and H-3 (taxStartTime=MAX DoS) operate on DIFFERENT code paths in FRouterV3.buy(). H-6 triggers at the `99 - normalTax` underflow (anti-sniper cap calculation). H-3 triggers because `block.timestamp < taxStartTime` always evaluates true, making the anti-sniper branch always taken. These are independent mechanisms that both block buys, but they are NOT necessary together — each independently causes a DoS. The chain value is that if one is patched, the other still creates a DoS. Additionally, the combination is unambiguous: if BOTH are set, sell() may still work (H-3 only blocks buys; H-6 with sellTax < 101 also only blocks buys). Combined, no buy path exists on the pair.

### Combined Attack Sequence
1. **[Step from H-3]**: EXECUTOR (beOpsWallet compromised) calls `FRouterV3.setTaxStartTime(pair, type(uint256).max)` — permanent anti-sniper window on target pair.
2. **[Step from H-6]**: ADMIN (via multisig or compromise) calls `FFactoryV2/V3.setTaxParams(token, 100, 0, ...)` — buyTax=100.
3. **[State reached S4+S5]**: For this token: (a) `block.timestamp < type(uint256).max` is always true → anti-sniper branch taken; (b) `99 - normalTax` where normalTax=100 → underflow → revert.
4. **[Impact]**: All buy() calls for the target pair revert via two independent code paths. Sells still work if sellTax < 101. Token becomes permanently buy-frozen until ADMIN resets tax params. If DEFAULT_ADMIN_ROLE also lost (CH-2/H-23), permanently frozen.
5. **[Compounded]**: If attacker controls both EXECUTOR and ADMIN (e.g., via H-23 self-revoke chain), both parameters can be set in one attack wave, creating an entrenched buy DoS resistant to single-setter remediation.

### Severity Reassessment
- **Finding A original**: High (H-6)
- **Finding B original**: High (H-3)
- **Chain Severity**: **High** (HIGH + HIGH = HIGH per matrix, cannot exceed HIGH without Critical-tier impact; combined impact is buy freeze on all pairs, not fund loss)
- **Chain ID**: CH-4

---

## Chain Hypothesis CH-5: renounceOwnership Enables Unrecoverable Parameter Corruption

### Blocked Finding (A)
- **ID**: H-7, **Title**: fakeInitialVirtualLiq=0 / targetRealVirtual=0 — Division by Zero Blocks All New Launches
- **Original Severity**: High
- **Verdict**: CONFIRMED
- **Missing Precondition for unrecoverable version**: BondingConfig owner must NOT be able to re-set the parameter after the corrupt value is set. Normally H-7 is recoverable (admin resets to valid value).
- **Precondition Type**: ACCESS (owner must be accessible to fix it)

### Enabler Finding (B)
- **ID**: H-24, **Title**: OwnableUpgradeable.renounceOwnership() Unguarded — BondingV5 and BondingConfig Admin Permanently Frozen
- **Original Severity**: Medium
- **Verdict**: CONFIRMED
- **Postcondition Created**: BondingConfig.owner() = address(0); no account can call `setBondingCurveParams()` or any other onlyOwner setter on BondingConfig; parameter corruption is permanent

### Chain Match
- **Match Strength**: STRONG
- **Match Reasoning**: H-24's postcondition directly eliminates the recovery path for H-7. In isolation, H-7 is High severity but recoverable (admin just re-sets valid params). When H-24 has been triggered (owner renounced), ANY bad parameter set in BondingConfig — including fakeInitialVirtualLiq=0 or targetRealVirtual=0 — becomes permanent. The chain transforms H-7 from "recoverable High" to "unrecoverable High with permanent protocol damage."

### Combined Attack Sequence
1. **[Step from H-7 pre-condition]**: Admin (or attacker who controlled admin) calls `setBondingCurveParams(0, ...)` setting fakeInitialVirtualLiq=0. All new preLaunch() calls now revert with division-by-zero.
2. **[Step from H-24]**: Owner calls `renounceOwnership()` on BondingConfig (accidentally, "decentralization intent," or post-compromise). BondingConfig.owner = address(0).
3. **[State reached]**: fakeInitialVirtualLiq=0 persists permanently. No account can call `setBondingCurveParams()` to restore a valid value. No proxy upgrade mechanism confirmed to exist for BondingConfig.
4. **[Impact]**: All future token launches on this BondingV5 instance are permanently blocked with division-by-zero. Protocol new-launch functionality is permanently destroyed.

### Severity Reassessment
- **Finding A original**: High (H-7)
- **Finding B original**: Medium (H-24)
- **Chain Severity**: **High** (High + Medium = High per matrix; the unrecoverable dimension elevates within-tier but does not cross to Critical since external attacker cannot trigger this without admin complicity or owner compromise)
- **Upgrade reason**: Unrecoverability note added to H-7 recommendation — fix should include protecting renounceOwnership.
- **Chain ID**: CH-5

---

## Chain Hypothesis CH-6: "Basis Points" Comment Misleads Admin → Triggers Tax DoS

### Blocked Finding (A) — Documentation Trigger
- **ID**: H-43, **Title**: antiSniperBuyTaxStartValue Comment Declares "Basis Points" — Documentation Risk
- **Original Severity**: Informational
- **Verdict**: CONFIRMED
- **Postcondition Created**: Admin sets antiSniperBuyTaxStartValue=9900 (following "basis points" comment, intending 99%)
- **Precondition Type**: STATE — misconfiguration state enabled by misleading documentation

### Enabler Finding (B)
- **ID**: H-6 / H-16, **Title**: Global Tax Parameter Without Upper Bound + Sum Not Validated
- **Original Severity**: High (H-6) / Medium (H-16)
- **Verdict**: CONFIRMED
- **Postcondition Created**: antiSniperBuyTaxStartValue=9900 with any positive buyTax produces sum > 99. Router computes `99 - normalTax` where normalTax = buyTax; anti-sniper cap = 99 - normalTax, but the sniperTax = antiSniperBuyTaxStartValue - normalTax = 9900 - buyTax. When 9900 > 99, the anti-sniper computation overflows or produces a wildly incorrect value, triggering underflow revert on all buys.

### Chain Match
- **Match Strength**: MODERATE
- **Match Reasoning**: H-43 documents that a misleading comment will cause an admin to set the wrong value. H-6's missing upper bound validation means that value (9900) is accepted without error. H-16's missing sum validation means antiSniperBuyTaxStartValue + buyTax > 99 is not caught. The result is the same DoS as H-6 (all anti-sniper-window buys revert), but caused by documentation-driven misconfiguration rather than malicious input.

### Combined Attack Sequence
1. **[Step from H-43]**: Protocol admin reads `FFactoryV2.sol:27` comment "in basis points" and sets antiSniperBuyTaxStartValue=9900 (intending 99% ≈ 9900 bps).
2. **[Step from H-6]**: setTaxParams() accepts 9900 with no upper bound check. Factory stores antiSniperBuyTaxStartValue=9900.
3. **[Step from H-16]**: No validation that 9900 + buyTax (e.g., 2) = 9902 exceeds 99 cap. Value persists.
4. **[Impact]**: All buy() calls during anti-sniper window: `antiSniperTax = antiSniperBuyTaxStartValue - normalTax = 9900 - 2 = 9898`. Router tries `99 - normalTax (2) = 97` as cap, then tries `antiSniperTax (9898) > cap (97)`, applies cap. But the actual fee computation uses capped value against amountIn, triggering the underflow from EC-1/H-6. All anti-sniper-window buys revert.
5. **[Note]**: Even if the exact computation path varies, setting 9900 instead of 99 creates a value far outside the valid range for a percentage-based parameter, virtually guaranteed to cause operational failures.

### Severity Reassessment
- **Finding A original**: Informational (H-43)
- **Finding B original**: High (H-6) + Medium (H-16)
- **Chain Severity**: **High** (documentation-triggered misconfiguration that produces the H-6 DoS effect; severity follows impact not trigger)
- **Upgrade reason**: H-43 should be upgraded to Medium in isolation (the documentation error creates a direct path to High-severity DoS). As a chain, this is High because the impact path is identical to H-6.
- **Chain ID**: CH-6

---

## Chain Hypothesis CH-7: Donation Attack + AgentToken Transfer Tax Activates Graduation Loop

### Blocked Finding (A)
- **ID**: H-2, **Title**: Graduation Failure — Permanent Per-Token DoS With No Admin Recovery
- **Original Severity**: Critical
- **Verdict**: CONFIRMED (with external trigger dependency)
- **Missing Precondition**: Graduation call must fail mid-execution to activate H-2's permanent loop
- **Precondition Type**: EXTERNAL (AgentFactory behavior OR Uniswap V2 liquidity addition failing)

### Enabler Finding (B1)
- **ID**: EP-10 / TF-3, **Title**: AgentToken Transfer Tax Causes Graduation Accounting Mismatch
- **Original Severity**: Critical (EP-10)
- **Verdict**: CONFIRMED (found in findings_inventory.md line 26: EP-10 Critical, CONFIRMED)
- **Postcondition Created**: If AgentToken has transfer tax > 0, `safeTransfer(pair, agentToken, amount)` delivers fewer tokens than `amount`. The FRouterV3.addInitialLiquidity() or Uniswap V2's `addLiquidity()` receives fewer tokens than the router instructed. If Uniswap's minimum liquidity checks (amountAMin, amountBMin) are non-zero or if the discrepancy is large enough, addLiquidity() reverts.

### Enabler Finding (B2)
- **ID**: H-11, **Title**: Graduation Donation Attack — Inflation of AgentFactory Application Threshold
- **Original Severity**: Medium
- **Verdict**: CONFIRMED (economically irrational for VIRTUAL donation, but feasible for agent token donation)
- **Postcondition Created**: Agent token donation to FPairV2 pre-graduation shifts the pair's `balance()` reading. This causes the Uniswap pool initialization to use a distorted ratio. If the distortion is large enough, the addLiquidity() price ratio violates slippage checks.

### Chain Match
- **Match Strength**: MODERATE (requires AgentToken to have transfer tax > 0; not all tokens will)
- **Match Reasoning**: EP-10 (transfer tax reduces actual delivered amounts) + H-11 (donation distorts balance reads) combine to create a scenario where `addInitialLiquidity()` or Uniswap V2's `addLiquidity()` reverts. Since `_openTradingOnUniswap()` has no try/catch and graduation failure creates H-2's permanent loop, this combination can activate H-2 without any AgentFactory governance failure.

### Combined Attack Sequence
1. **[Setup — H-11 side]**: Attacker donates a small amount of agent tokens to FPairV2 immediately before a graduation-triggering buy (MEV sandwich). FPairV2.balance() now returns inflated amount.
2. **[Token property]**: AgentToken was deployed with a non-zero transfer tax (e.g., 1%). This is a legitimate token configuration.
3. **[Graduation-triggering buy]**: A user buys enough tokens to cross tokenGradThreshold. BondingV5.buy() calls _openTradingOnUniswap().
4. **[_openTradingOnUniswap execution]**: The function reads pair.balance() (inflated by donation) and pair.assetBalance() for Uniswap pool initialization amounts. It calls AgentFactory, which deploys the AgentToken. AgentToken's transfer tax applies when transferring agentTokenAmount to the Uniswap pair. Actual received amount = agentTokenAmount × (1 - taxRate).
5. **[Revert trigger]**: `IUniswapV2Router(uniRouter).addLiquidity()` receives fewer agent tokens than the call parameter specifies. If Uniswap's price impact check or minimum output check fails, addLiquidity() reverts. The entire _openTradingOnUniswap() reverts.
6. **[H-2 activation]**: tokenInfo.trading remains true. Every subsequent graduation-triggering buy re-enters _openTradingOnUniswap() and reverts again for the same reason (tax still present). Permanent graduation DoS on this token.
7. **[Impact]**: Token permanently stuck in graduation loop. No admin recovery (same as standalone H-2 postcondition).

### Severity Reassessment
- **Finding A original**: Critical (H-2)
- **Finding B original**: Critical (EP-10) + Medium (H-11)
- **Chain Severity**: **Critical** (Critical enabler + Critical consequence = Critical; this chain provides an additional activation path for H-2 that does NOT require any governance action — it can be triggered by a token with any non-zero transfer tax being donated against)
- **Chain ID**: CH-7

---

## Findings Status Update — Chain Severity Upgrades

| Hypothesis | Original Severity | Chain Involvement | Chain Severity | Status |
|------------|------------------|------------------|---------------|--------|
| H-2 (Graduation DoS) | Critical | CH-1 (consequence), CH-7 (consequence) | Critical | Confirmed Critical — now has 3 activation paths (CH-1/H-4, CH-7/EP-10+H-11, standalone EP-8) |
| H-4 (BONDING_ROLE Revocation) | High | CH-1 (enabler) | Chain severity = Critical | High standalone; note in report that it activates Critical chain CH-1 |
| H-43 (Documentation Risk) | Informational | CH-6 (enabler) | Chain severity = High | **UPGRADED**: H-43 severity should be raised to Low/Medium in isolation; as chain enabler it is High |
| H-23 (Admin Self-Revoke) | Medium | CH-2 (enabler), CH-5 companion | Chain severity = Critical | Medium standalone; enables Critical irrecoverability — escalate to High in chain context |
| H-8 (antiSniperTaxVault=0) | High | CH-3 (partial enabler) | Chain severity = High | Confirmed High — graduation DoS overlap is timing-dependent |
| H-6 (Tax DoS) | High | CH-4 (one side), CH-6 (consequence) | High | Confirmed High — reinforced by CH-4 dual-mechanism |
| H-3 (taxStartTime=MAX) | High | CH-4 (other side) | High | Confirmed High — independent from H-6 but compounds with it |
| H-24 (renounceOwnership) | Medium | CH-5 (enabler) | Chain severity = High | Medium standalone → High chain (enables unrecoverable H-7) |
| H-7 (Zero Param DoS) | High | CH-5 (consequence) | High | High — unrecoverable variant documented in chain |
| EP-10 (Transfer Tax Mismatch) | Critical | CH-7 (enabler) | Chain severity = Critical | Critical confirmed — chain adds new H-2 activation path |
| H-11 (Donation Attack) | Medium | CH-7 (supporting enabler) | Chain severity = Critical | Medium standalone — contributes to CH-7 |
| H-1 (EXECUTOR Drain) | Critical | CH-2 (consequence) | Critical | Critical — chain adds irrecoverability dimension |
| H-27 (EXECUTOR Self-Removal) | High | CH-2 (supporting enabler) | High | High — contributes to irrecoverability chain |

---

## Verification Priority Order

Based on chain severity and exploitability:

1. **CH-1 (Critical)**: H-4 → H-2 chain. HIGHEST PRIORITY. Independent governance event (BONDING_ROLE revocation by separate multisig) triggers permanent Critical DoS. Both components already CONFIRMED; chain confirmation is architectural — verify that a BONDING_ROLE revocation on AgentFactory has no pre-flight check in BondingV5.
2. **CH-7 (Critical)**: EP-10 + H-11 → H-2 chain. CRITICAL. No governance action needed — any token with transfer tax > 0 at graduation is vulnerable. Verify whether addLiquidity slippage checks can be triggered by tax-reduced amounts.
3. **CH-2 (Critical irrecoverability)**: H-23 + H-27 → H-1 compound. Verify that DEFAULT_ADMIN_ROLE self-revoke truly prevents EXECUTOR_ROLE revocation (OZ AccessControl mechanics).
4. **CH-6 (High)**: H-43 → H-6 documentation-driven DoS. Verify exact computation path when antiSniperBuyTaxStartValue=9900.
5. **CH-5 (High)**: H-24 → H-7 unrecoverable. Verify BondingConfig has no UUPS upgrade protection and renounceOwnership() is truly uncallable with a guard.
6. **CH-4 (High)**: H-6 + H-3 dual-block. Low new verification needed — both independently CONFIRMED; chain is compositional.
7. **CH-3 (High)**: H-8 + H-37 graduation-window overlap. Verify exact execution order in buy() — does H-8 revert before or after _openTradingOnUniswap() is entered.
