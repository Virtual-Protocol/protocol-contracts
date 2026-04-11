# Depth External Dependencies — Iteration 3 (DA Final Pass)

**Agent:** DA Depth External Dependencies Agent — Iteration 3
**Date:** 2026-04-03
**Domain:** External dependencies — drainUniV2Pool veToken spoofing, graduation role dependency
**Input findings investigated:** EP-11, EP-14
**Source:** depth_iter3_findings.md

---

## DA Analysis: EP-11

**Prior Path (iter1 + iter2):**
- Iter1: Found drainUniV2Pool accepts arbitrary veToken; noted EXECUTOR_ROLE gate. Stopped at role check.
- Iter2: Confirmed beOpsWallet EOA holds EXECUTOR_ROLE on FRouterV3 and can call drainUniV2Pool directly. Confirmed LP pair validation is binding (immutable token0/token1 on Uniswap V2 pair). Confirmed malicious veToken cannot affect real LP tokens. Left unresolved: is EP-11 independent of AC-1/AC-8 or duplicative?

**New Path Explored:**
Iter1 and iter2 both approached EP-11 from the **attack path** angle (what can a malicious caller do?). Neither iteration examined EP-11 from the **duplicate distinction** angle: precisely which harm does EP-11 describe that AC-1 and AC-8 do NOT already describe?

Examined:
1. The exact chain of operations in drainUniV2Pool versus graduate() (AC-1) and approval() (AC-8)
2. Whether the "veToken spoofing" label describes a new harm or is simply a different invocation of the same EXECUTOR_ROLE drain
3. Whether EP-11's "wrong pool drain" postcondition is already captured in AC-1's "TOTAL_LOSS" or AC-8's "TOKEN_DRAINAGE"

**New Evidence:**

[TRACE:AC-1 harm — FRouterV3.graduate(tokenAddress) → L232 `IFPairV2(pair).transferAsset(msg.sender, assetBalance)` + L233 `IFPairV2(pair).transferTo(msg.sender, tokenBalance)` → drains the BONDING CURVE private pair (pre-graduation pool). Recipient is hardcoded to msg.sender (BondingV5 or beOpsWallet). No third-party recipient parameter.]

[TRACE:AC-8 harm — FRouterV3.approval(pair, asset, spender, amount) → L249 `IFPairV2(pair).approval(spender, asset, amount)` → sets ERC20 approval on the pair contract. Does NOT transfer funds; it enables a subsequent transferFrom by the spender. Two-step drain.]

[TRACE:EP-11 harm — FRouterV3.drainUniV2Pool(agentToken, veToken, recipient, deadline) → drains the POST-GRADUATION Uniswap V2 pool, not the bonding curve pool. Recipient is an UNRESTRICTED parameter (L426 `address recipient`). The founder's ENTIRE veToken balance is removed from the Uniswap pool and sent to the caller-specified recipient. The recipient can be any address — including addresses not affiliated with the protocol.]

**Distinctness verdict for EP-11 vs AC-1/AC-8:**

| Dimension | AC-1 | AC-8 | EP-11 |
|-----------|------|------|-------|
| Target pool | Pre-graduation bonding curve pair | Pre-graduation bonding curve pair (via approval) | POST-GRADUATION Uniswap V2 LP |
| Recipient control | Hardcoded: msg.sender | Hardcoded: spender (must be specified) | Fully unrestricted: any address |
| Requires founder approval | No | No | Yes (founder must pre-approve factory for veToken spend, per EP-7) |
| Token type drained | FPairV2 internal asset/token | FPairV2 approved ERC20 | Uniswap V2 LP tokens (veToken) |
| Additional precondition | isProject60days | None | isProject60days + EP-7's founder pre-approval |

EP-11 targets a **different pool** (Uniswap V2 post-graduation vs bonding curve) and a **different token type** (LP tokens vs raw ERC20) with a **different recipient model** (unrestricted vs msg.sender). The harm is DISTINCT: AC-1 drains the bonding curve pool; EP-11 drains the graduated Uniswap pool. These are INDEPENDENT findings.

**On the "veToken spoofing" label specifically:**

The iter1 label ("interface spoofing") was misleading. The real finding in EP-11 is not about spoofing — the LP pair validation (immutable token0/token1) adequately blocks fake LP attacks as confirmed by iter2. The actual finding is:

**The `recipient` parameter in drainUniV2Pool() has no restriction.** An EXECUTOR_ROLE holder (beOpsWallet EOA) can drain ALL of a Project60days founder's post-graduation Uniswap LP position to any arbitrary address, without any on-chain constraint on who the recipient is. This is NOT the same as AC-1 (which targets the pre-graduation pool and hardcodes msg.sender as recipient) and NOT the same as AC-8 (which targets pair approvals, not LP removal).

**Precondition for EP-11's harm (the real version):**
- Token must be isProject60days: TRUE (required by drainUniV2Pool)
- Founder must have pre-approved AgentFactory for veToken: per EP-7, this is an assumed precondition, not enforced on-chain
- Caller holds EXECUTOR_ROLE: beOpsWallet EOA confirmed to hold this role on FRouterV3

Given EP-7's already-confirmed finding that founder pre-approval is not enforced, EP-11's practical exploitability depends on EP-7's precondition being met (i.e., founder DID pre-approve). If they did not, drainUniV2Pool reverts inside AgentFactory. But if the founder approved (the expected operational path), beOpsWallet can drain to any recipient.

**INVARIANT CONSISTENCY CHECK:**
- EXECUTOR_ROLE is SEMI_TRUSTED per protocol context
- beOpsWallet EOA holding EXECUTOR_ROLE is stated design
- drainUniV2Pool's documented purpose IS to drain founder liquidity for Project60days tokens
- The unrestricted `recipient` parameter is a design choice — but it allows beOpsWallet to redirect funds to a third party, which exceeds the bounded interpretation of "drain liquidity for protocol operations"
- Per the Assumption Dependency Audit (findings_inventory.md): EXECUTOR_ROLE acting beyond bounded operations is NOT downgraded (only FULLY_TRUSTED actors get -1 tier). EP-11 stays Medium.

**Final Verdict for EP-11:** CONFIRMED as INDEPENDENT FINDING at Medium severity. The veToken spoofing label was misleading — the real finding is the unrestricted `recipient` parameter enabling beOpsWallet to redirect ALL post-graduation Uniswap LP liquidity to any address. This is distinct from AC-1 (pre-graduation pool, hardcoded msg.sender) and AC-8 (pair approval, not LP removal).

**Confidence:** INCREASE

**Disposition:** INDEPENDENT FINDING — not a duplicate of AC-1 or AC-8. Title should be updated from "Interface Spoofing in drainUniV2Pool" to "drainUniV2Pool Unrestricted Recipient Enables EXECUTOR_ROLE to Redirect Graduated LP to Arbitrary Address."

---

## Finding [EP-11-R]: drainUniV2Pool Unrestricted Recipient Enables Redirection of Graduated Uniswap LP

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A — single entity, single call) | ✗6(trust scope defined)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✓, R8:✗(single-step), R10:✓, R11:✗(no external unsolicited tokens), R12:✗(no dangerous precondition enabler chain — EP-7 covers the approval dependency), R13:✓(by-design drain but user harm is third-party redirection, not return), R15:✗(no flash loan), R16:✗(no oracle)]
**Depth Evidence**:
- [TRACE:drainUniV2Pool(agentToken, veToken, recipient, deadline) → L427 onlyRole(EXECUTOR_ROLE) → beOpsWallet EOA confirmed holder → L435 isProject60days check → L441 veToken.assetToken() = lpPair → L443-451 token0/token1 validation (binding, immutable on Uniswap V2) → L456-458 founder = veToken.founder(), veTokenAmount = IERC20(veToken).balanceOf(founder) → L466-473 agentFactory.removeLpLiquidity(veToken, recipient, veTokenAmount, 0, 0, deadline) → recipient receives ALL founder Uniswap LP → recipient is UNCONSTRAINED]
- [VARIATION:recipient = arbitrary EOA controlled by beOpsWallet → founder's entire Uniswap LP position drained to third party → founder loses all Uniswap liquidity permanently]
- [BOUNDARY:veTokenAmount = full founder balance → 0 amountAMin, 0 amountBMin → no slippage protection → MEV sandwich possible in the same block if recipient is a DEX-aware attacker who received the LP tokens]

**Severity**: Medium
**Location**: FRouterV2.sol:436-489, FRouterV3.sol:422-476 — drainUniV2Pool() `recipient` parameter (L439 in V2, L425 in V3)

**Description**: Both `FRouterV2.drainUniV2Pool()` and `FRouterV3.drainUniV2Pool()` accept an unrestricted `recipient` parameter. The function removes ALL of the founder's Uniswap V2 LP position (the founder's full veToken balance) and sends the resulting tokens to the caller-specified `recipient`. There is no constraint that the recipient must be the founder, the protocol treasury, or any protocol-controlled address.

beOpsWallet EOA holds EXECUTOR_ROLE on FRouterV3 and can call this function directly. For any Project60days token where the founder has pre-approved the AgentFactory for veToken spend (the expected operational path), beOpsWallet can drain the ENTIRE graduated Uniswap LP position to any address it specifies.

This is distinct from AC-1 (which targets the pre-graduation bonding curve pair with msg.sender hardcoded as recipient) and AC-8 (which sets pair ERC20 approvals, not LP removal). EP-11 targets the post-graduation Uniswap pool specifically and provides unrestricted third-party recipient control.

**Impact**: 
- beOpsWallet (SEMI_TRUSTED) can redirect a Project60days founder's entire post-graduation Uniswap LP liquidity to any address
- Founder loses full Uniswap LP position permanently, with zero on-chain recourse
- amountAMin and amountBMin are both 0, meaning the LP removal is also vulnerable to MEV sandwich attacks at the moment of execution
- Combines with EP-7 (founder pre-approval assumed but not enforced): if founder was properly guided through approval flow, this attack path is fully exploitable by beOpsWallet

**Evidence**:
```solidity
// FRouterV3.sol:422-476
function drainUniV2Pool(
    address agentToken,
    address veToken,
    address recipient,   // ← unrestricted: any address accepted
    uint256 deadline
) public onlyRole(EXECUTOR_ROLE) nonReentrant {
    // ...isProject60days check, LP pair validation...
    address founder = veTokenContract.founder();
    uint256 veTokenAmount = IERC20(veToken).balanceOf(founder);
    require(veTokenAmount > 0, "No liquidity to drain");

    IAgentFactoryV7(agentFactory).removeLpLiquidity(
        veToken,
        recipient,   // ← founder LP sent to unconstrained recipient
        veTokenAmount,
        0,           // amountAMin: 0 — no slippage protection
        0,           // amountBMin: 0 — no slippage protection
        deadline
    );
}
```

### Postcondition Analysis
**Postconditions Created**: Founder's Uniswap LP position fully drained to arbitrary recipient; Uniswap pool may be emptied or significantly depleted
**Postcondition Types**: [BALANCE, EXTERNAL]
**Who Benefits**: beOpsWallet-designated recipient (could be beOpsWallet itself or a third party)

---

## DA Analysis: EP-14

**Prior Path (iter1 + iter2):**
- Iter1: Identified 4+ sequential AgentFactory calls in graduation requiring BONDING_ROLE. Did not enumerate specific roles per call.
- Iter2: Enumerated roles: EXECUTOR_ROLE on FRouterV3 (L721) + BONDING_ROLE on AgentFactoryV7 (L731, L737, L748). Confirmed within-tx sandwich is impossible. Recommended merge with DE-3 (= EP-8 in the inventory). Left unresolved: is EP-14 truly distinct from EP-8, or are they the same root cause reached via different triggers?

**New Path Explored:**
Neither iter1 nor iter2 directly compared the CODE PATHS that cause DoS in EP-8 vs EP-14. Iter2 concluded "merge with DE-3" but did not examine what DE-3 / EP-8 actually says vs what EP-14 adds. The inventory (findings_inventory.md line 227) explicitly notes: "EP-8 | R8: Multi-step graduation operation → staleness check | COMPLIANT — EP-14 captures role dependency staleness." This implies EP-14 was intentionally kept SEPARATE at inventory creation time to capture a distinct mechanism.

**Code examination of EP-8 vs EP-14 triggers:**

[TRACE:EP-8 root cause — "Graduation Failure Creates Permanent Pool DoS" → BondingV5.sol:664-670 AND 703-772 → the trigger is ANY failure in _openTradingOnUniswap() → including: AgentFactory paused/upgraded, executeBondingCurveApplicationSalt reverting, agentFactory.removeLpLiquidity failing, etc. EP-8 describes the CONSEQUENCE (permanent DoS once graduation fails) not the specific trigger mechanism. The Chain Summary for EP-8: "AgentFactory failure mid-graduation bricks pool permanently; every buy reverts | EXTERNAL_DEPENDENCY | PERMANENT_DOS"]

[TRACE:EP-14 root cause — "AgentFactory Role Dependency for Multi-Step Graduation" → BondingV5.sol:727-756 → the trigger is specifically: (a) EXECUTOR_ROLE on FRouterV3 revoked from BondingV5, OR (b) BONDING_ROLE on AgentFactoryV7 revoked from BondingV5 → these are TWO specific role revocation triggers that cause EP-8's general DoS to activate. Chain Summary for EP-14: "4 sequential AgentFactory calls at graduation; any role revocation bricks graduation | ROLE_REVOCATION | PERMANENT_DOS"]

**Structural relationship:**

```
EP-14 trigger mechanism: ADMIN/Owner revokes EXECUTOR_ROLE or BONDING_ROLE from BondingV5
          ↓
_openTradingOnUniswap() fails at L721 (router.graduate() reverts) OR L731/737/748 (agentFactory calls revert)
          ↓
EP-8 consequence: permanent DoS — every subsequent buy triggers graduation check, every buy reverts
```

EP-14 IS a specific ENABLER of EP-8's general DoS. But the question is: **does EP-8 already document role revocation as a trigger, or does EP-14 add that specific trigger?**

[TRACE:EP-8 description in inventory — "AgentFactory failure mid-graduation bricks pool permanently; every buy reverts" — the phrase "AgentFactory failure" is generic. It covers: contract paused, contract upgraded (breaking interface), external dependency unavailable, AND role revocation. EP-8 does NOT enumerate role revocation as a specific named trigger — it uses the catch-all "AgentFactory failure."]

[TRACE:EP-14 description in inventory — "4 sequential AgentFactory calls at graduation; any role revocation bricks graduation" — EP-14 specifically names ROLE_REVOCATION as the precondition type. It identifies that BondingV5 must hold EXECUTOR_ROLE on FRouterV3 AND BONDING_ROLE on AgentFactoryV7 as simultaneous ongoing role grants for graduation to succeed.]

**Distinct root cause test (per chain analysis grouping rules):**
- Same fix required? EP-8 fix: protect graduation state on failure / make graduation retriable. EP-14 fix: document or enforce that role grants cannot be revoked while tokens are in graduation-eligible state (trading=true). These require DIFFERENT code changes — EP-8 is about consequence containment; EP-14 is about precondition protection (ensuring role invariants hold at graduation time).
- Same vulnerability class? EP-8 = external dependency failure creates irreversible state. EP-14 = implicit role dependency creates admin-triggered DoS. Different classes.

**Severity re-evaluation for EP-14 standalone:**

EP-14's trigger requires: Owner (FULLY_TRUSTED) or ADMIN_ROLE (FULLY_TRUSTED) to revoke BONDING_ROLE from BondingV5. Per the report template and trust model: "Attack path requires fully-trusted actor to act maliciously → −1 tier." Original High → drops to Medium.

HOWEVER: the inventory Assumption Dependency Audit (line 259) already tagged EP-14 as: "External (AgentFactory role change) | N/A | (none) | High | High." The "N/A" in the Within-Bounds column and "(none)" for tag suggests the inventory did NOT apply the TRUSTED-ACTOR downgrade to EP-14. The actor for role revocation on AgentFactoryV7 is whoever holds DEFAULT_ADMIN_ROLE on AgentFactoryV7 — which may be a DIFFERENT multisig than BondingV5's owner. If the AgentFactory has a separate admin from BondingV5's FULLY_TRUSTED owner, then EP-14's trigger is an EXTERNAL governance action (not the protocol's own fully-trusted actor acting against interest), keeping it at High.

This cross-contract admin independence is the key: BondingV5 CANNOT control whether AgentFactory's admin revokes BONDING_ROLE. It is an EXTERNAL dependency on a role grant that BondingV5 assumes will persist for its entire operational lifetime.

[TRACE:BondingV5.sol has no function to verify or restore BONDING_ROLE on AgentFactory → BondingV5 is a passive dependent → AgentFactory admin's decision to revoke BONDING_ROLE is not an "attack" by BondingV5's own trusted actor — it is an operational risk from a SEPARATE contract's admin]

This makes EP-14 a genuine EXTERNAL DEPENDENCY risk (same category as EP-8), not a trusted-actor malice scenario. High severity stands.

**Final determination on EP-14 vs EP-8:**

EP-14 is NOT a DUPLICATE of EP-8. They share the same consequence (permanent graduation DoS) but have:
- Different triggers: EP-8 = any AgentFactory operational failure; EP-14 = specifically, role grants becoming stale or revoked
- Different precondition types: EP-8 = EXTERNAL_DEPENDENCY (contract failure); EP-14 = ROLE_REVOCATION (governance action on a separate contract)
- Different fixes: EP-8 = make graduation state recoverable; EP-14 = snapshot or verify role grants at graduation initiation, or add a role-check function before graduation-triggering buys

EP-14 provides ADDITIONAL CONTEXT to EP-8 (it identifies the specific role mechanism that creates the dependency), but it is a DISTINCT root cause with a distinct fix strategy.

**Conclusion:** EP-14 is CONFIRMED as INDEPENDENT FINDING at High severity (the role dependency is an external governance risk, not a FULLY_TRUSTED actor attack). It should NOT be absorbed into EP-8; instead, it should chain-reference EP-8 as the consequence.

**Confidence:** INCREASE

**Disposition:** INDEPENDENT FINDING — distinct from EP-8. EP-14 is a distinct root cause (implicit role grant dependency, cross-contract governance) that ENABLES EP-8's DoS but requires a different fix. Report as separate finding with cross-reference to EP-8.

---

## Finding [EP-14-R]: Graduation Role Dependency on External AgentFactory — Role Grant Revocation Creates Permanent DoS

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A — single entity, graduation is one-way) | ✗6(role analysis done)
**Rules Applied**: [R4:✗(evidence clear — no CONTESTED ambiguity), R5:✗(single execution path), R6:✓, R8:✓, R10:✓, R11:✗(no external tokens), R12:✓(dangerous precondition: role grant revocation enables DoS → R12 applied: enumerated all paths to role loss), R13:✗(not design-related), R15:✗(no flash loan), R16:✗(no oracle)]
**Depth Evidence**:
- [TRACE:_openTradingOnUniswap() L721 → router.graduate(tokenAddress_) → FRouterV3.graduate() onlyRole(EXECUTOR_ROLE) → BondingV5 must hold EXECUTOR_ROLE on FRouterV3 at this exact moment → if revoked → revert → entire graduation tx reverts → pair NOT drained (atomicity) → BUT trading=true remains, tradingOnUniswap=false → every subsequent buy hits graduation threshold → _openTradingOnUniswap() called again → same revert → permanent DoS]
- [TRACE:_openTradingOnUniswap() L731 → agentFactory.updateApplicationThresholdWithApplicationId() → onlyRole(BONDING_ROLE) on AgentFactoryV7 → BondingV5 must hold BONDING_ROLE on AgentFactoryV7 → if revoked → revert → same permanent DoS path]
- [TRACE:_openTradingOnUniswap() L737 → agentFactory.removeBlacklistAddress() → onlyRole(BONDING_ROLE) → same dependency]
- [TRACE:_openTradingOnUniswap() L748 → agentFactory.executeBondingCurveApplicationSalt() → onlyRole(BONDING_ROLE) → same dependency]
- [VARIATION:AgentFactory admin (separate governance from BondingV5 owner) revokes BONDING_ROLE from BondingV5 → BondingV5 has NO function to detect this, NO function to restore it, NO fallback path → all tokens at graduation threshold are permanently bricked]
- [BOUNDARY:EXECUTOR_ROLE on FRouterV3 OR BONDING_ROLE on AgentFactoryV7 — revocation of EITHER is sufficient to trigger DoS — TWO independent role grant failure points, both required for graduation to succeed]

**Severity**: High
**Location**: BondingV5.sol:721, 731-734, 737-740, 748-756 (graduation role call sites); FRouterV3.sol:232 (EXECUTOR_ROLE gate); AgentFactoryV7 (BONDING_ROLE gate — external)

**Description**: `BondingV5._openTradingOnUniswap()` requires BondingV5 to simultaneously hold two role grants at the exact moment of graduation: (1) `EXECUTOR_ROLE` on `FRouterV3`, used at L721 for `router.graduate()`; and (2) `BONDING_ROLE` on `AgentFactoryV7`, used at L731, L737, and L748 for three sequential AgentFactory calls.

BondingV5 has no function to verify these role grants before graduation is attempted, no fallback if either role is missing, and no ability to restore the roles (they are granted by the respective contracts' admins, which may be independent governance addresses). If either role is revoked — even by AgentFactory's own admin through normal governance operations — then:

1. The graduation-triggering buy() call reverts at the first missing-role check inside `_openTradingOnUniswap()`
2. The pair is NOT drained (EVM atomicity preserves all token balances)
3. `tokenRef.trading` remains `true`, `tokenRef.tradingOnUniswap` remains `false`
4. The token is permanently stuck: the graduation threshold is still met, so every subsequent buy attempts graduation again, reverts again, creating permanent DoS for the token

This finding is distinct from EP-8 (which documents the general consequence of any graduation failure). EP-14 identifies the specific role dependency mechanism and its trigger: an external governance action on AgentFactoryV7 is sufficient to permanently brick any BondingV5 token at the graduation threshold.

**Impact**:
- Any token where graduation is pending (reserve threshold met but not yet graduated) can be permanently bricked if AgentFactory's admin revokes BONDING_ROLE from BondingV5
- All user funds (VIRTUAL tokens in the bonding curve pair) are locked permanently — not at risk of theft, but non-recoverable without an upgrade
- beOpsWallet cannot fix this by calling graduation directly — graduation ONLY goes through BondingV5._buy() → _openTradingOnUniswap()
- Recovery requires: (a) restoring the role grants, or (b) a BondingV5 upgrade adding a standalone graduation path
- Related to EP-8 (same DoS consequence, different trigger). See also EP-8 for consequence detail.

**Evidence**:
```solidity
// BondingV5.sol:703-772 — _openTradingOnUniswap()
function _openTradingOnUniswap(address tokenAddress_) private {
    // ...
    router.graduate(tokenAddress_);                                    // L721: requires EXECUTOR_ROLE on FRouterV3
    // ...
    agentFactory.updateApplicationThresholdWithApplicationId(          // L731: requires BONDING_ROLE on AgentFactoryV7
        tokenRef.applicationId, assetBalance
    );
    agentFactory.removeBlacklistAddress(                               // L737: requires BONDING_ROLE
        tokenAddress_,
        IAgentTokenV2(tokenAddress_).liquidityPools()[0]
    );
    // ...
    address agentToken = agentFactory.executeBondingCurveApplicationSalt( // L748: requires BONDING_ROLE
        tokenRef.applicationId, ...
    );
    // ^ BondingV5 has no pre-flight role check, no fallback, no role restoration
}
```

### Precondition Analysis (role dependency mechanism)
**Missing Precondition**: BondingV5 must hold EXECUTOR_ROLE on FRouterV3 AND BONDING_ROLE on AgentFactoryV7 continuously throughout the protocol's operational lifetime
**Precondition Type**: ACCESS (role grant on external contracts)
**Why This Blocks**: Role revocation on either external contract by its own admin is sufficient to brick graduation for all pending tokens — BondingV5 cannot detect or recover from this

### Postcondition Analysis
**Postconditions Created**: Permanent graduation DoS for all tokens at the graduation threshold; user VIRTUAL permanently locked in bonding curve pairs
**Postcondition Types**: [STATE, BALANCE]
**Who Benefits**: Nobody (this is an operational hazard, not an extractable exploit)

---

## Summary of DA Iteration 3 Outcomes

| Finding | Prior Verdict | DA-3 Verdict | Change | Key New Evidence |
|---------|--------------|------------|--------|-----------------|
| EP-11 | PARTIAL (0.67) — "veToken spoofing mitigated; unrestricted recipient within trust scope" | CONFIRMED as INDEPENDENT FINDING — unrestricted recipient is a distinct drain path vs AC-1/AC-8 | INCREASE confidence | Pool target (Uniswap V2 post-graduation) is different from AC-1 (bonding curve); recipient is unrestricted vs AC-1's hardcoded msg.sender; EXECUTOR_ROLE drain of Uniswap LP exceeds bounded operations → not TRUSTED-ACTOR downgrade |
| EP-14 | PARTIAL (0.67) — "Medium / merge with DE-3 (EP-8)" | CONFIRMED as INDEPENDENT FINDING at High — distinct root cause, distinct fix, distinct trigger mechanism | INCREASE confidence | EP-8 = any AgentFactory failure (consequence); EP-14 = specifically role grant revocation (trigger + precondition). Different fix strategies. External governance actor (AgentFactory admin ≠ BondingV5 owner) means not TRUSTED-ACTOR downgrade. |

**Final dispositions:**
- EP-11: CONFIRMED, Medium, INDEPENDENT FINDING. Title: "drainUniV2Pool Unrestricted Recipient Enables EXECUTOR_ROLE to Redirect Graduated LP to Arbitrary Address."
- EP-14: CONFIRMED, High, INDEPENDENT FINDING. Title: "Graduation Role Dependency on External AgentFactory — Role Grant Revocation Creates Permanent DoS." Cross-reference: EP-8 (same DoS consequence, different trigger). Different fix required.
