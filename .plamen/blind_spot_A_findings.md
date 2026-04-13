# Blind Spot Scanner A — Tokens & Parameters

**Agent**: Blind Spot Scanner A
**Date**: 2026-04-02
**Scope**: BondingV5.sol, FRouterV2.sol, FRouterV3.sol, FPairV2.sol, FFactoryV2.sol, FFactoryV3.sol, BondingConfig.sol, multicall3.sol

---

## Processing Protocol Results

### CHECK 1: External Token Coverage

**Enumerated tokens** (5 from Token Flow Matrix):
1. Asset Token ($VIRTUAL) — DONE
2. Agent Token (pre-grad) — DONE
3. Agent Token (post-grad) — DONE
4. LP Token (UniV2) — DONE
5. Tax (portion of Asset) — DONE

**Token × Dimension coverage table**:

| External Token | Analyzed by Agent? | Finding IDs | R11-D1: Transferability | R11-D2: Accounting | R11-D3: Op Blocking | R11-D4: Loop/Gas | R11-D5: Side Effects | Dimensions Covered |
|---|---|---|---|---|---|---|---|---|
| Asset Token ($VIRTUAL) | YES | TF-1, EP-5, EP-9, TF-5, TF-6 | ✓ (SafeERC20 throughout) | ✓ (virtual vs real reserve divergence) | ✓ (donation attack) | N/A (no loops) | ✓ (tax routing) | 4/5 |
| Agent Token (pre-grad) | YES | TF-2, TF-3, EP-10, TF-8 | ✓ | ✓ | ✓ | N/A | ✓ (transfer tax) | 4/5 |
| Agent Token (post-grad) | YES | EP-3, TF-8 | ✓ | PARTIAL | N/A | N/A | ✓ | 3/5 |
| LP Token (UniV2) | YES | EP-7, EP-11 | ✓ | N/A | ✓ | N/A | ✓ | 3/5 |
| Tax (portion of Asset) | PARTIAL | EP-4, EP-13, RS2-1 | ✓ | N/A | ✓ | N/A | ⚠ PARTIAL | 3/5 |

**CHECK 1 Coverage Gate**: 5/5 enumerated, 5/5 processed. No 0-finding transferable tokens found. No token has ≤2 of 5 applicable dimensions uncovered.
→ No new BLIND-A findings from CHECK 1.

---

### CHECK 1b: Unchecked ERC20 Transfer Return Values

**Enumerated call sites** (raw `.transfer`/`.transferFrom` without SafeERC20 in production contracts):

1. FRouterV2.sol — uses `SafeERC20.safeTransferFrom`, `SafeERC20.safeTransfer` throughout — DONE (N/A)
2. FRouterV3.sol — uses `SafeERC20.safeTransferFrom`, `SafeERC20.safeTransfer`, `forceApprove` — DONE (N/A)
3. BondingV5.sol — uses `SafeERC20.safeTransferFrom`, `SafeERC20.safeTransfer` — DONE (N/A)
4. FPairV2.sol — uses SafeERC20 — DONE (N/A)
5. FFactoryV2.sol / FFactoryV3.sol — no token transfers — DONE (N/A)
6. BondingConfig.sol — no token transfers — DONE (N/A)
7. multicall3.sol — uses `SafeERC20.safeTransfer`, `forceApprove` — DONE (N/A)

Raw `.transfer()`/`.transferFrom()` found ONLY in mock contracts (MockAgentVeToken.sol, MockUniswapV2Pair.sol) — out of production scope.

**Coverage Gate**: 7/7 enumerated, 7/7 processed.
→ No BLIND-A finding from CHECK 1b.

---

### CHECK 2: Governance-Changeable Parameter Coverage

**Enumerated parameters with setters (from constraint_variables.md)**:

1. BondingConfig.scheduledLaunchParams (normalLaunchFee, acfFee) — `setScheduledLaunchParams()` — **NOT analyzed** → BLIND SPOT
2. BondingConfig.feeTo — `setCommonParams()` — **NOT analyzed** → BLIND SPOT
3. BondingConfig.deployParams.tbaImplementation — `setDeployParams()` — **NOT analyzed** → BLIND SPOT
4. BondingConfig.teamTokenReservedWallet — `setTeamTokenReservedWallet()` — PARTIAL (TE-1, MG-4 cover staleness but NOT zero-address) → PARTIAL BLIND SPOT
5. FFactoryV2/V3.antiSniperTaxVault — `setTaxParams()` — **NOT analyzed** → BLIND SPOT
6. BondingConfig.fakeInitialVirtualLiq — `setBondingCurveParams()` — COVERED (EC-4)
7. BondingConfig.targetRealVirtual — `setBondingCurveParams()` — COVERED (EC-2)
8. FFactoryV2/V3.buyTax — `setTaxParams()` — COVERED (AC-3, EC-1)
9. FFactoryV2/V3.sellTax — `setTaxParams()` — COVERED (AC-3, EC-3)
10. FFactoryV2/V3.antiSniperBuyTaxStartValue — `setTaxParams()` — COVERED (AC-3, TE-6)
11. BondingV5.bondingConfig — `setBondingConfig()` — COVERED (AC-6)
12. FFactoryV2/V3.router — `setRouter()` — COVERED (AC-4, PC1-12)
13. BondingConfig.initialSupply — `setCommonParams()` — no impact path identified (affects future launches)
14. BondingConfig.startTimeDelay — `setScheduledLaunchParams()` — COVERED (TE-2)
15. BondingConfig.reserveSupplyParams — `setReserveSupplyParams()` — COVERED (validation present; EC-10 boundary)

**Items not yet analyzed**: 1, 2, 3, 4 (partial), 5 → 4+ new findings.

**Coverage Gate**: 15/15 enumerated, 15/15 processed (4+ gaps identified).

---

### CHECK 2b: Native Value in Loops

**Enumerated functions with `msg.value`**:
1. multicall3.aggregate() — payable, `onlyOwnerOrAdmin` — NO `msg.value` usage inside loop — DONE
2. multicall3.tryAggregate() — payable, `onlyOwnerOrAdmin` — NO `msg.value` usage — DONE
3. multicall3.tryBlockAndAggregate() — payable — delegates to tryAggregate — DONE
4. multicall3.blockAndAggregate() — payable — delegates — DONE
5. multicall3.aggregate3() — payable, NO `msg.value` inside loop — DONE
6. multicall3.aggregate3Value() — payable, uses `calli.value` PER call not `msg.value` — DONE

**Analysis of aggregate3Value**: Sends `calli.value` (per-element ETH from calldata) to each target in a loop. Uses `unchecked { valAccumulator += val; }` then validates `msg.value == valAccumulator` at END (not inside loop). This is correct behavior — the ETH is held by the contract from the payable call, then distributed. The end-check validates no excess. No double-spend risk. The `unchecked` overflow is theoretical (Type V civilization comment). The non-loop functions (aggregate, aggregate3) accept ETH via `payable` but have no ETH spending logic — caller ETH would be trapped, but `withdrawETH` exists. Already noted in PC1-4 (payable aggregate functions trap ETH).

**Coverage Gate**: 6/6 enumerated, 6/6 processed.
→ No new BLIND-A finding from CHECK 2b.

---

### CHECK 2c: Unbounded Return Data

**Enumerated low-level `.call(` sites**:
1. multicall3.aggregate() L105 — `call.target.call(call.callData)` — returnData unbounded — DONE
2. multicall3.tryAggregate() L128-130 — unbounded returnData — DONE
3. multicall3.aggregate3() L199-200 — unbounded returnData — DONE
4. multicall3.aggregate3Value() L255-256 — unbounded returnData — DONE
5. multicall3.withdrawETH() L520 — `to.call{value: amount}("")` — no returnData — DONE (N/A)

**Analysis**: All aggregate functions store unbounded return data from arbitrary targets. A malicious target could return a megabyte of data, causing large memory expansion and gas consumption for the caller. However: (a) all callers are `onlyOwnerOrAdmin` so the attacker must control an approved target AND be an admin, (b) gas is ultimately capped by block gas limit. This is a Low/Info gas griefing risk — already adjacent to PC1-7 (inline assembly struct-layout assumptions). Not a standalone new finding worthy of a BLIND-A slot given the access restriction.

**Coverage Gate**: 5/5 enumerated, 5/5 processed.
→ No new BLIND-A finding from CHECK 2c.

---

### CHECK 2g: Missing Native ETH Receiver

**Enumerated contracts designed to accept ETH**:
1. multicall3.sol — aggregate3Value() is payable and explicitly handles ETH; has `receive()` and `fallback() payable` — DONE (N/A: by design)
2. FRouterV2.sol — no payable functions; no receive()/fallback() — DONE (N/A: pure ERC20 protocol)
3. FRouterV3.sol — no payable functions; no receive()/fallback() — DONE (N/A)
4. BondingV5.sol — one `payable` function at L680 but review shows this is the `preLaunch` or `launch` function — DONE
5. FPairV2.sol — no payable — DONE (N/A)
6. FFactoryV2.sol / FFactoryV3.sol — no payable — DONE (N/A)
7. BondingConfig.sol — no payable — DONE (N/A)

**BondingV5.sol L680 payable function**: This is a legitimate function that operates on ERC20 tokens (not ETH). Any ETH sent with it would be trapped. But there is no `receive()` or `fallback()`, so plain ETH transfers to BondingV5 would revert. Only ETH sent WITH function calls would trap — a user error, not a protocol design gap.

**Coverage Gate**: 7/7 enumerated, 7/7 processed.
→ No new BLIND-A finding from CHECK 2g.

---

## Findings

---

## Finding [BLIND-A1]: `antiSniperTaxVault` Zero-Address Bricks All Buys During Anti-Sniper Window

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(N/A — no role involved) | ✗7(N/A — no multi-step state)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role — param config), R8:✗(single-step), R10:✓, R11:✓, R12:✓, R13:✗(not design), R14:✓, R15:✗(no flash loan), R16:✗(no oracle)]
**Severity**: High
**Location**: FFactoryV2.sol:108-122, FFactoryV3.sol:116-130, FRouterV2.sol:206-211, FRouterV3.sol:213-218

**Description**:
`FFactoryV2.setTaxParams()` and `FFactoryV3.setTaxParams()` enforce that `newVault_ != address(0)` for the `taxVault` parameter, but impose **no zero-address restriction on `antiSniperTaxVault_`**. If ADMIN_ROLE sets `antiSniperTaxVault` to `address(0)`, all subsequent buy() calls that incur anti-sniper tax (i.e., any buy within the active anti-sniper window) will attempt `safeTransferFrom(to, address(0), antiSniperTxFee)`, which reverts in standard ERC20 implementations.

```solidity
// FFactoryV2.sol:108-122 — setTaxParams()
function setTaxParams(
    address newVault_,
    uint256 buyTax_,
    uint256 sellTax_,
    uint256 antiSniperBuyTaxStartValue_,
    address antiSniperTaxVault_   // ← NO zero-address check
) public onlyRole(ADMIN_ROLE) {
    require(newVault_ != address(0), "Zero addresses are not allowed.");  // only taxVault is checked
    ...
    antiSniperTaxVault = antiSniperTaxVault_;  // stores address(0) silently
}

// FRouterV2.sol:206-211 — buy()
if (antiSniperTxFee > 0) {
    IERC20(assetToken).safeTransferFrom(
        to,
        factory.antiSniperTaxVault(),   // address(0) → revert
        antiSniperTxFee
    );
}
```

**Impact**:
- All buy transactions to any pre-graduation bonding pair within its anti-sniper window revert
- DoS persists until ADMIN_ROLE corrects the address (but the silent-setter issue from EVT-8 means this goes unnoticed without active monitoring)
- Any token launched while `antiSniperTaxVault = address(0)` is configured has its entire anti-sniper window bricked
- Combined with AC-7 (23 silent setters), this misconfiguration is indistinguishable from normal config changes

**Evidence**: FFactoryV2.sol:113 — `antiSniperTaxVault_` parameter has no `!= address(0)` check; FRouterV2.sol:207 — `factory.antiSniperTaxVault()` used directly in `safeTransferFrom` with no null guard.

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: All buy() calls revert during anti-sniper window across all active pairs using this factory
**Postcondition Types**: STATE
**Who Benefits**: Adversarial ADMIN_ROLE; indirect benefit to anyone seeking to DoS the launchpad

---

## Finding [BLIND-A2]: `setScheduledLaunchParams()` Accepts MAX_UINT Fees — Permanent DoS on All Scheduled and ACF Launches

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5 | ✗6(N/A) | ✗7(N/A)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external token), R12:✓, R13:✗(not design), R14:✓, R15:✗(no flash loan), R16:✗(no oracle)]
**Severity**: High
**Location**: BondingConfig.sol:240-244, BondingV5.sol:296-319

**Description**:
`BondingConfig.setScheduledLaunchParams()` accepts a `ScheduledLaunchParams` struct with no input validation on `normalLaunchFee` or `acfFee`. If the owner sets either to an astronomically large value (e.g., `type(uint256).max`), `calculateLaunchFee()` returns this value. In `BondingV5.preLaunch()` at L307, the check `if (purchaseAmount_ < launchFee) { revert InvalidInput(); }` then always reverts for any realistic `purchaseAmount_` — permanently bricking all scheduled launches and ACF launches.

```solidity
// BondingConfig.sol:240-244 — NO validation on fees
function setScheduledLaunchParams(
    ScheduledLaunchParams memory params_
) external onlyOwner {
    scheduledLaunchParams = params_;  // normalLaunchFee and acfFee stored without bounds check
    // No event emitted (flagged in EVT-5 separately)
}

// BondingV5.sol:302-308
uint256 launchFee = bondingConfig.calculateLaunchFee(isScheduledLaunch, needAcf_);
if (purchaseAmount_ < launchFee) {
    revert InvalidInput();  // always reverts if launchFee = MAX_UINT
}
```

**Impact**:
- All calls to `preLaunch()` with `isScheduledLaunch = true` OR `needAcf_ = true` revert permanently
- X_LAUNCH and ACP_SKILL mode launches are DoS'd (they require `needAcf_ = true` in typical flows)
- Affects all future token creation until the config is corrected
- Rule 10 (worst-state severity): If set to MAX_UINT by a compromised owner key, recovery requires a separate `setScheduledLaunchParams()` transaction; silent (no event per EVT-5) so detection is delayed

**Evidence**: BondingConfig.sol:240-244 — no `require` on `params_.normalLaunchFee` or `params_.acfFee`; BondingConfig.sol:351-363 — `calculateLaunchFee()` returns raw stored values without sanitization.

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: `preLaunch()` reverts for all scheduled/ACF launches
**Postcondition Types**: STATE
**Who Benefits**: Attacker with compromised owner key

---

## Finding [BLIND-A3]: `BondingConfig.setCommonParams()` Accepts `feeTo = address(0)` — DoS on All Paid Launches

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4 | ✗5(N/A) | ✗6(N/A)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external token), R12:✓, R13:✗(not design), R14:✓, R15:✗, R16:✗]
**Severity**: Medium
**Location**: BondingConfig.sol:165-172, BondingV5.sol:314-320

**Description**:
`BondingConfig.setCommonParams()` accepts `feeTo_` with no zero-address check. If `feeTo` is set to `address(0)`, any `preLaunch()` call where `launchFee > 0` (i.e., all scheduled and ACF launches) will attempt `IERC20(assetToken).safeTransferFrom(msg.sender, address(0), launchFee)`. Standard ERC20 implementations revert on transfers to `address(0)`, permanently bricking all paid launches.

```solidity
// BondingConfig.sol:165-172
function setCommonParams(uint256 initialSupply_, address feeTo_) external onlyOwner {
    initialSupply = initialSupply_;
    feeTo = feeTo_;             // ← NO zero-address check
    emit CommonParamsUpdated(initialSupply_, feeTo_);
}

// BondingV5.sol:314-320
if (launchFee > 0) {
    IERC20(assetToken).safeTransferFrom(
        msg.sender,
        bondingConfig.feeTo(),  // address(0) → ERC20 revert
        launchFee
    );
}
```

**Impact**:
- All `preLaunch()` calls with non-zero `launchFee` (scheduled launches, ACF launches) revert
- Immediate launches with no ACF fee are unaffected (launchFee = 0)
- The `CommonParamsUpdated` event still emits (unlike EVT-5/EVT-7 zero-event setters), so detection is faster — but the damage occurs between the misconfiguration and detection

**Evidence**: BondingConfig.sol:169 — `feeTo = feeTo_` with no `require(feeTo_ != address(0))` guard; BondingV5.sol:317 — `bondingConfig.feeTo()` used directly as ERC20 recipient.

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: All paid preLaunch() calls revert
**Postcondition Types**: STATE
**Who Benefits**: Attacker with compromised BondingConfig owner key

---

## Finding [BLIND-A4]: `BondingConfig.setDeployParams()` Accepts `tbaImplementation = address(0)` — Silently Corrupts All Token Creation

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4 | ✗5(N/A) | ✗6(N/A)
**Rules Applied**: [R4:✓, R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗, R12:✓, R13:✗, R14:✓, R15:✗, R16:✗]
**Severity**: Medium
**Location**: BondingConfig.sol:155-158, BondingV5.sol:328-352

**Description**:
`BondingConfig.setDeployParams()` stores a `DeployParams` struct containing `tbaImplementation` with no zero-address check. This address is passed directly to `agentFactory.createNewAgentTokenAndApplication()` as the TBA (Token Bound Account) implementation parameter. Setting `tbaImplementation = address(0)` will corrupt all subsequent token creation calls. The outcome depends on the AgentFactory implementation: it may revert (DoS), silently create tokens with no TBA functionality, or deploy tokens with a broken TBA pointing to a destructed or non-existent contract.

```solidity
// BondingConfig.sol:155-158
function setDeployParams(DeployParams memory params_) external onlyOwner {
    deployParams = params_;          // tbaImplementation stored without validation
    emit DeployParamsUpdated(params_);
}

// BondingV5.sol:347
configDeployParams.tbaImplementation,  // passed to agentFactory — may be address(0)
```

**Impact**:
- If AgentFactory reverts on zero `tbaImplementation`: all `preLaunch()` calls revert → total DoS
- If AgentFactory silently accepts: tokens are created with broken/absent TBA functionality, affecting all downstream agent operations
- `DeployParamsUpdated` event fires so the misconfiguration is traceable — but token creation is already broken until corrected
- Rule 4 (adversarial escalation): AgentFactory behavior with zero tbaImplementation is an external dependency with unverified behavior in this scope

**Evidence**: BondingConfig.sol:155 — `function setDeployParams(DeployParams memory params_)` has no `require(params_.tbaImplementation != address(0))` guard; BondingV5.sol:346-347 — `configDeployParams.tbaImplementation` passed to external call without null check.

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: All preLaunch() calls produce corrupted or DoS'd token creation
**Postcondition Types**: EXTERNAL (outcome depends on AgentFactory behavior)
**Who Benefits**: Attacker with compromised BondingConfig owner key

---

## Finding [BLIND-A5]: `BondingConfig.setTeamTokenReservedWallet(address(0))` Accepted — DoS on All X_LAUNCH/ACP_SKILL Launches With Reserved Tokens

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4 | ✗5(N/A) | ✗6(N/A)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗, R12:✓, R13:✗, R14:✓, R15:✗, R16:✗]
**Severity**: Medium
**Location**: BondingConfig.sol:250-253, BondingV5.sol:381-387

**Description**:
`BondingConfig.setTeamTokenReservedWallet()` accepts any address including `address(0)`. While existing findings TE-1 and MG-4 document the staleness risk (wallet changing between preLaunch and launch), neither covers the zero-address case. When `teamTokenReservedWallet = address(0)` and any token is launched with `totalReservedSupply > 0` (X_LAUNCH and ACP_SKILL modes always have reserved supply), `preLaunch()` attempts `IERC20(token).safeTransfer(address(0), totalReservedSupply)` which reverts in standard ERC20 — bricking the entire launch.

```solidity
// BondingConfig.sol:250-253
function setTeamTokenReservedWallet(address wallet_) external onlyOwner {
    teamTokenReservedWallet = wallet_;   // ← NO zero-address check
    emit TeamTokenReservedWalletUpdated(wallet_);
}

// BondingV5.sol:381-387
if (totalReservedSupply > 0) {
    IERC20(token).safeTransfer(
        bondingConfig.teamTokenReservedWallet(),  // address(0) → ERC20 revert
        totalReservedSupply * (10 ** IAgentTokenV2(token).decimals())
    );
}
```

**Impact**:
- All X_LAUNCH and ACP_SKILL `preLaunch()` calls revert during the transfer of reserved tokens to `address(0)`
- Normal immediate launches with zero `airdropBips` and no ACF may avoid this (`totalReservedSupply = 0`), but the dominant launch modes (X_LAUNCH, ACP_SKILL) are fully DoS'd
- `TeamTokenReservedWalletUpdated` event fires — but the DoS begins immediately after the setter is called

**Distinct from TE-1/MG-4**: Those findings describe the wallet changing to a *different valid address* between preLaunch and launch. This finding describes setting the wallet to `address(0)`, causing an immediate revert inside `preLaunch()` itself — a different code path and different fix.

**Evidence**: BondingConfig.sol:251 — no `require(wallet_ != address(0))` guard; BondingV5.sol:383-386 — zero-address recipient causes ERC20 revert.

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: All X_LAUNCH/ACP_SKILL preLaunch() calls revert
**Postcondition Types**: STATE
**Who Benefits**: Attacker with compromised BondingConfig owner key

---

## Chain Summary (MANDATORY)

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|---|---|---|---|---|---|---|
| BLIND-A1 | FFactoryV2.sol:108-122, FFactoryV3.sol:116-130, FRouterV2.sol:206-211 | `antiSniperTaxVault` setter has no zero-address check; zero address causes all anti-sniper buys to revert | CONFIRMED | High | ROLE_ABUSE | DOS_BUY |
| BLIND-A2 | BondingConfig.sol:240-244, BondingV5.sol:296-319 | `setScheduledLaunchParams()` accepts MAX_UINT fees; `preLaunch()` always reverts for scheduled/ACF launches | CONFIRMED | High | CONFIG_CHANGE | DOS_LAUNCH |
| BLIND-A3 | BondingConfig.sol:165-172, BondingV5.sol:314-320 | `setCommonParams()` accepts `feeTo = address(0)`; ERC20 transfer to zero-address reverts all paid launches | CONFIRMED | Medium | CONFIG_CHANGE | DOS_PAID_LAUNCH |
| BLIND-A4 | BondingConfig.sol:155-158, BondingV5.sol:328-352 | `setDeployParams()` accepts `tbaImplementation = address(0)`; corrupts or DoSes all token creation | CONFIRMED | Medium | CONFIG_CHANGE | CORRUPTED_TOKEN_CREATION |
| BLIND-A5 | BondingConfig.sol:250-253, BondingV5.sol:381-387 | `setTeamTokenReservedWallet(address(0))` accepted; ERC20 transfer to zero-address reverts all X_LAUNCH/ACP_SKILL launches | CONFIRMED | Medium | CONFIG_CHANGE | DOS_XLAUNCH_ACPSKILL |
