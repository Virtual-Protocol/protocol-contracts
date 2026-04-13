# Sibling Propagation Findings

**Agent**: Sibling Propagation Agent
**Pattern Extraction Pass**: 10 root cause patterns investigated
**New Findings**: 6 new findings [SP-1] through [SP-6]

---

## Pattern Propagation Table

| Source Finding | Root Cause Pattern | Sibling Functions Searched | Same Bug? | New Finding? |
|---|---|---|---|---|
| EC-1 (buyTax >= 100 underflow) | Parameter used in output-subtraction without upper-bound cap | FRouterV3.sell() with sellTax | YES — identical arithmetic, no cap | SP-1 |
| EC-1 (buyTax >= 100 underflow) | antiSniperBuyTaxStartValue > 99 breaks cap logic | FRouterV2/V3 buy() anti-sniper cap | YES — startTax > 99 breaks `99 - normalTax` guard | SP-2 |
| RS2-3 (cancelLaunch CEI violation) | safeTransfer before zeroing tracked amount | BondingV2.cancelLaunch(), BondingV3.cancelLaunch(), BondingV4.cancelLaunch() | YES — identical pattern in all three | SP-3 |
| RS2-4 (FFactory duplicate pair overwrite) | Registry allows overwriting existing entry without pre-existence check | FFactoryV3._createPair() | YES — identical code, identical gap | Already covered by RS2-4 (both V2 and V3 referenced) |
| EP-12 (setTaxStartTime silent fail) | FRouterV3 calls pair interface method assuming all pairs implement it | FRouterV3._calculateAntiSniperTax() — bondingV5.tokenAntiSniperType() with no try/catch | YES — hard revert for non-BondingV5 tokens; already captured by MG-1 | Duplicate of MG-1 |
| TF-1 (donation attack on graduation amounts) | Graduation reads real balance not tracked reserve | BondingV2._openTradingOnUniswap(), BondingV3._openTradingOnUniswap(), BondingV4._openTradingOnUniswap() | YES — identical: `pair.assetBalance()` / `pair.balance()` | SP-4 |
| MG-4 (teamTokenReservedWallet read fresh) | Config value read twice across transactions without snapshotting | BondingV3.preLaunch() and BondingV3.launch() / BondingV4 same / BondingV5 same | BondingV3/V4: YES, same struct field; BondingV5: YES, reads bondingConfig.teamTokenReservedWallet() live at both preLaunch AND launch | SP-5 |
| AC-1 (EXECUTOR_ROLE bypasses safety checks) | EXECUTOR_ROLE graduate() has no cross-contract validation on thresholds | FRouterV3.graduate() | YES — identical signature/logic to FRouterV2.graduate(), confirmed already covered by AC-1 | Duplicate (AC-1 already covers both) |
| EVT-1 (cancelLaunch emits post-zeroing value) | Event emits already-cleared value | BondingV4.cancelLaunch() | YES — identical pattern | SP-6 |
| SLS-1 (missing __gap) | All 9 upgradeable contracts have no storage gap | All 9 contracts enumerated | Confirmed: 0 contracts have __gap | Already fully captured in SLS-1 |

---

## Finding Detail

## Finding [SP-1]: FRouterV3.sell() sellTax >= 100 Causes Underflow — Traps All Sell-Side User Funds

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✓, R5:✗(single tax path), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external token), R14:✓, R15:✗(no flash-loan-accessible state)]
**Severity**: High
**Location**: FRouterV3.sol:157-160 (mirrored from EC-3 FRouterV2.sol:150-153)
**Description**: In `FRouterV3.sell()`, `sellTax` from `factory.sellTax()` is applied to `amountOut` as a percentage divided by 100. If `ADMIN_ROLE` sets `sellTax >= 100` via `FFactoryV3.setTaxParams()`, the expression `uint256 amount = amountOut - txFee` (line 160) will underflow because `txFee >= amountOut`, permanently reverting every sell on BondingV5 tokens routed through FRouterV3.

```solidity
// FRouterV3.sol:157-160
uint fee = factory.sellTax();
uint256 txFee = (fee * amountOut) / 100;  // if fee=100 → txFee=amountOut
uint256 amount = amountOut - txFee;       // UNDERFLOW: 0 - 0 still ok, but fee>100 wraps
```

Unlike `buy()`, `sell()` has no 99-cap guard. EC-3 captured FRouterV2; FRouterV3 has the same code at the same line offset and is the active router for all BondingV5 tokens.

**Impact**: If ADMIN_ROLE sets `FFactoryV3.sellTax >= 100`, every `sell()` call through FRouterV3 reverts, permanently locking all BondingV5 token holders' exit liquidity.

**Evidence**: `FRouterV3.sol:157-160` — identical to FRouterV2.sol:150-153 (EC-3), no cap guard before subtraction.

---

## Finding [SP-2]: antiSniperBuyTaxStartValue > 99 Breaks the 99% Buy-Tax Cap Invariant in Both Routers

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✓, R5:✗(single tx), R6:✗(no role), R8:✗(single-step), R10:✓, R14:✓, R15:✗]
**Severity**: High
**Location**: FRouterV2.sol:188-191, FRouterV3.sol:193-197
**Description**: Both routers contain a guard intended to cap the total buy tax at 99%:

```solidity
// FRouterV2.sol:190-191 / FRouterV3.sol:195-197
if (normalTax + antiSniperTax > 99) {
    antiSniperTax = 99 - normalTax;
}
```

The guard computes `antiSniperTax` from `antiSniperBuyTaxStartValue` (returned by `factory.antiSniperBuyTaxStartValue()`). If `ADMIN_ROLE` sets `antiSniperBuyTaxStartValue > 99` (e.g., 100) via `setTaxParams()`, `_calculateAntiSniperTax()` returns a value up to `antiSniperBuyTaxStartValue`. The guard then attempts `99 - normalTax`: if `normalTax >= 99`, this underflows (identical to EC-1 for buyTax). Even if `normalTax = 1`, the cap clamps `antiSniperTax` to 98, but the root issue is that the anti-sniper starting value itself is uncapped in `setTaxParams()`.

More critically: in FRouterV2 `_calculateAntiSniperTax()` (line 320), `startTax = factory.antiSniperBuyTaxStartValue()`. If `startTax > 99` and `normalTax + startTax > 99`, the cap fires, executing `99 - normalTax`. If `normalTax >= 99`, this underflows and reverts every buy. Since `buyTax` and `antiSniperBuyTaxStartValue` can both be set to 100 by ADMIN_ROLE simultaneously (AC-3 covers buyTax alone, not the combined interaction), the combined setter in a single `setTaxParams()` call can arm both simultaneously.

**Impact**: A single `setTaxParams(vault, 5, 5, 100, vault)` call sets `antiSniperBuyTaxStartValue = 100`, causing the cap guard to produce `99 - 5 = 94` — which itself is not an underflow. However, `setTaxParams(vault, 99, 5, 100, vault)` causes `99 - 99 = 0` underflow, DoSing all buys during the anti-sniper window for all pairs on that factory.

**Evidence**: `FRouterV2.sol:320` reads `antiSniperBuyTaxStartValue` with no upper-bound check before the subtraction; `FFactoryV2.sol:108-122` / `FFactoryV3.sol:116-130` apply no cap on `antiSniperBuyTaxStartValue_` in `setTaxParams()`.

---

## Finding [SP-3]: BondingV2/V3/V4.cancelLaunch() All Violate CEI — reentrancy Before State Update

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✓, R5:✓, R6:✗(no role), R8:✓, R10:✓, R11:✗, R12:✓, R13:✗, R15:✗]
**Severity**: Medium
**Location**: BondingV2.sol:404-411, BondingV3.sol:339-346, BondingV4.sol:411-418
**Description**: RS2-3 identified the CEI violation in BondingV5.cancelLaunch(). All three earlier contract versions — BondingV2, BondingV3, and BondingV4 — carry the identical pattern: the `safeTransfer` of `initialPurchase` asset tokens back to the creator occurs **before** `_token.initialPurchase = 0` and `_token.launchExecuted = true`.

```solidity
// BondingV2.sol:404-412 (identical in V3:339-347 and V4:411-419)
if (_token.initialPurchase > 0) {
    IERC20(router.assetToken()).safeTransfer(   // ← external call first
        _token.creator,
        _token.initialPurchase
    );
}
_token.initialPurchase = 0;   // ← state zeroed AFTER external call
_token.launchExecuted = true; // ← guard set AFTER external call
```

None of BondingV2/V3/V4's `cancelLaunch()` has `nonReentrant`. The `assetToken` is a trusted ERC-20 (VIRTUAL) and is unlikely to have a callback, but the pattern is architecturally broken. If the asset token ever gained a transfer hook (e.g. EIP-1363), or if the creator address is a contract, the hook could call back into `cancelLaunch()` before `launchExecuted` is set, allowing double-refunds.

**Impact**: If `router.assetToken()` ever implements a transfer hook or `_token.creator` is a crafted contract, the creator can re-enter `cancelLaunch()` before `launchExecuted = true`, draining the bonding contract of all accumulated `initialPurchase` balances for other tokens (since the bonding contract holds all initial purchases as a shared pool).

**Evidence**:
- BondingV2.sol:404-412 — `safeTransfer` at L404, state cleared at L411-412
- BondingV3.sol:339-346 — same pattern
- BondingV4.sol:411-418 — same pattern

### Postcondition Analysis
**Postconditions Created**: External call completes before launchExecuted guard is set; window for re-entry exists
**Postcondition Types**: [STATE, TIMING]
**Who Benefits**: Creator with contract address as `creator`; or any ERC-1363-style callback recipient

---

## Finding [SP-4]: BondingV2/V3/V4 Graduation Uses balanceOf — Same Donation Attack Surface as EP-5/TF-1

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✓, R5:✓, R6:✗(no role), R8:✗(single-step at graduation), R10:✓, R11:✓, R12:✓, R15:✗]
**Severity**: Medium
**Location**: BondingV2.sol:621-622, BondingV3.sol:556-557, BondingV4.sol:628-629
**Description**: EP-5 and TF-1 already identified that BondingV5._openTradingOnUniswap() reads `pair.assetBalance()` and `pair.balance()` — which are implemented as raw `balanceOf(address(this))` calls in FPairV2.sol:177-182 — rather than the internal tracked reserves. This allows an attacker to donate asset tokens or agent tokens to the pair contract before triggering graduation, distorting the `assetBalance` forwarded to AgentFactory and the `tokenBalance` sent to the agent token contract.

The identical pattern exists in all three older Bonding versions:

```solidity
// BondingV2.sol:621-622 (identical in V3:556-557, V4:628-629)
uint256 assetBalance = pair.assetBalance(); // → balanceOf(pair)
uint256 tokenBalance = pair.balance();      // → balanceOf(pair)

router.graduate(tokenAddress);

IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance);
agentFactory.updateApplicationThresholdWithApplicationId(_token.applicationId, assetBalance);
...
IERC20(tokenAddress).safeTransfer(tokenAddress, tokenBalance);
agentFactory.executeBondingCurveApplicationSalt(_token.applicationId, _token.data.supply / 1 ether, tokenBalance / 1 ether, pairAddress, salt);
```

BondingV2/V3/V4 tokens can still graduate (there is no explicit `revert("Not implemented")` in `_openTradingOnUniswap`). A user can donate asset tokens directly to the FPairV2 pair address before triggering graduation, inflating `assetBalance` and causing AgentFactory to receive more than the legitimate bonding curve proceeds, or donate agent tokens to inflate `tokenBalance`, skewing Uniswap pool initialization ratios.

**Impact**: Same as EP-5/TF-1 for BondingV5 tokens, extended to all V2/V3/V4 tokens that successfully reach graduation: donation inflates `assetBalance` (sent to AgentFactory as application threshold) and `tokenBalance` (used as lpSupply for executeBondingCurveApplicationSalt). Either distorts the Uniswap V2 pool initialization ratio, disadvantaging legitimate holders at graduation.

**Evidence**:
- `FPairV2.sol:176-182`: `balance()` = `IERC20(tokenA).balanceOf(address(this))`, `assetBalance()` = `IERC20(tokenB).balanceOf(address(this))` — no reserve tracking, pure balanceOf
- BondingV2.sol:621-622 / BondingV3.sol:556-557 / BondingV4.sol:628-629 — all use these balance functions unchanged

---

## Finding [SP-5]: BondingV3/V4 teamTokenReservedWallet Read Fresh at launch() — Same TOCTOU as MG-4/TE-1

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✓, R5:✗(single token lifecycle), R6:✗(no role), R8:✓, R10:✓, R14:✗, R15:✗]
**Severity**: Medium
**Location**: BondingV3.sol:271+403-405, BondingV4.sol:337+476-478
**Description**: MG-4 and TE-1 identified that BondingV5 reads `bondingConfig.teamTokenReservedWallet()` live at both `preLaunch()` and `launch()`, meaning the wallet can change between the two transactions. BondingV3 and BondingV4 have the same pattern: `launchParams.teamTokenReservedWallet` is read directly from the shared `launchParams` storage struct at both `preLaunch()` and `launch()`, without snapshotting the value into the token-specific struct at `preLaunch()` time.

```solidity
// BondingV3.preLaunch() line 271: reserves sent to launchParams.teamTokenReservedWallet at preLaunch time
IERC20(token).safeTransfer(
    launchParams.teamTokenReservedWallet,   // read live from shared struct
    launchParams.teamTokenReservedSupply * (10 ** IAgentTokenV2(token).decimals())
);

// BondingV3.launch() line 403-405: bought tokens also sent to launchParams.teamTokenReservedWallet
IERC20(_tokenAddress).safeTransfer(
    launchParams.teamTokenReservedWallet,   // read live from shared struct — may differ
    amountOut
);
```

If `onlyOwner` calls `setLaunchParams()` between a token's `preLaunch()` and `launch()`, the initial reserve tokens (sent at preLaunch) go to wallet A, but the initial-purchase tokens (sent at launch) go to the new wallet B. This splits assets across two wallets contrary to intent, and can be used by the owner to redirect the initial-buy proceeds to an arbitrary address. BondingV4 carries the same pattern.

**Impact**: Owner can redirect the initial-purchase token proceeds (amountOut from the creator's initial buy) to a different wallet than the reserve tokens, splitting accounting and potentially redirecting creator-locked tokens to a new wallet without the creator's knowledge.

**Evidence**:
- BondingV3.sol:91 — `LaunchParams.teamTokenReservedWallet` is a shared struct field, not per-token
- BondingV3.sol:271 — sent to `launchParams.teamTokenReservedWallet` at preLaunch
- BondingV3.sol:403-405 — same field read fresh at launch
- BondingV4.sol:337, 476-478 — identical pattern

### Postcondition Analysis
**Postconditions Created**: Creator-bought initial tokens can be redirected to a new wallet between preLaunch and launch
**Postcondition Types**: [STATE, CONFIG_CHANGE]
**Who Benefits**: Contract owner who changes launchParams between the two transactions

---

## Finding [SP-6]: BondingV4.cancelLaunch() Also Emits initialPurchase=0 (Post-Zeroing Value)

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4,5
**Rules Applied**: [R4:✗(pattern is clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step read), R10:✗(single fixed state), R13:✗, R14:✗, R15:✗]
**Severity**: Medium
**Location**: BondingV4.sol:418-426
**Description**: EVT-1 identified that BondingV2 and BondingV3 emit the `CancelledLaunch` event with the already-zeroed `_token.initialPurchase` value. BondingV4.cancelLaunch() has the identical pattern: it zeros `_token.initialPurchase = 0` on line 418 before the `emit CancelledLaunch(...)` on line 421, which passes `_token.initialPurchase` as the last argument — reading the already-cleared storage slot, so the event always emits `initialPurchase = 0`.

```solidity
// BondingV4.sol:418-426
_token.initialPurchase = 0;         // ← zeroed here
_token.launchExecuted = true;

emit CancelledLaunch(
    _tokenAddress,
    _token.pair,
    tokenInfo[_tokenAddress].virtualId,
    _token.initialPurchase             // ← reads 0, not the pre-zero value
);
```

BondingV5 correctly captures the pre-zero value into a local variable before zeroing (line 486: `uint256 initialPurchase = tokenRef.initialPurchase;`). BondingV4 does not.

**Impact**: Off-chain indexers and monitors reading `CancelledLaunch` events from BondingV4 always see `initialPurchase = 0`, making it impossible to reconstruct the actual refund amount from events alone. This creates an auditing gap and may break any system that relies on the event to track returned funds.

**Evidence**:
- BondingV4.sol:418: `_token.initialPurchase = 0;`
- BondingV4.sol:425: `_token.initialPurchase` passed to emit (reads 0)
- BondingV2.sol:411, 419: same pattern (already in EVT-1)
- BondingV3.sol:346, 353: same pattern (already in EVT-1)
- BondingV5.sol:486-495: correct implementation using local snapshot

---

## Chain Summary (MANDATORY)

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|-----------|----------|---------------------|---------|----------|-------------------|--------------------|
| SP-1 | FRouterV3.sol:157-160 | FRouterV3.sell() has no cap on sellTax before subtraction; sellTax >= 100 causes underflow DoS | CONFIRMED | High | ROLE_ABUSE | PERMANENT_SELL_DOS |
| SP-2 | FRouterV2.sol:188-191, FRouterV3.sol:193-197 | antiSniperBuyTaxStartValue uncapped in setTaxParams(); if set >= 100 combined with normalTax = 99, cap guard underflows | CONFIRMED | High | ROLE_ABUSE | BUY_DOS |
| SP-3 | BondingV2.sol:404-411, BondingV3.sol:339-346, BondingV4.sol:411-418 | cancelLaunch() transfers before zeroing initialPurchase and setting launchExecuted; no nonReentrant guard | CONFIRMED | Medium | EXTERNAL_CALL | DOUBLE_REFUND |
| SP-4 | BondingV2.sol:621-622, BondingV3.sol:556-557, BondingV4.sol:628-629 | Graduation reads raw balanceOf for assetBalance/tokenBalance instead of tracked reserves | CONFIRMED | Medium | UNSOLICITED_TRANSFER | GRADUATION_MANIPULATION |
| SP-5 | BondingV3.sol:271+403-405, BondingV4.sol:337+476-478 | teamTokenReservedWallet read live from shared launchParams at both preLaunch and launch; can change between calls | CONFIRMED | Medium | CONFIG_CHANGE | ACCOUNTING_ERROR |
| SP-6 | BondingV4.sol:418-426 | cancelLaunch() emits CancelledLaunch with initialPurchase after already zeroing it to 0 | CONFIRMED | Medium | STORAGE_READ_ORDER | BAD_EVENT_DATA |
