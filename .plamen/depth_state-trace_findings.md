# Depth State-Trace Findings

**Agent**: State Trace Depth Agent
**Domain**: Constraint enforcement, cross-function state mutations, cached parameters, initialization ordering, setter regression
**Date**: 2026-04-02

---

## Finding [DEPTH-ST-1]: Graduation Failure Creates Irrecoverable Permanent DoS — No Admin Recovery Path Exists

**Verdict**: CONFIRMED
**Step Execution**: 1,2,3,5 | 4(N/A) | 6,7
**Rules Applied**: [R4: (adversarial escalation applied), R5: (combinatorial across 4 AgentFactory calls), R8: (multi-step), R10: (worst-state at partial completion), R12: (enabler enumeration), R14: (no setter to fix)]
**Depth Evidence**: [BOUNDARY:AgentFactory paused after step 2 of 4 → worst state], [TRACE:_openTradingOnUniswap→revert at L731/737/748 → trading still true, buy() still calls _buy(), every subsequent buy reverts at graduation check], [VARIATION:AgentFactory pause/unpause→no recovery because state changes in steps 1-2 already committed]
**Severity**: Critical
**Location**: BondingV5.sol:703-772

**Description**:
`_openTradingOnUniswap()` performs 4 sequential external calls to AgentFactory (L727-756):
1. `router.graduate(tokenAddress_)` — drains pair (transfers all tokens + assets to BondingV5)
2. `IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance)` — sends VIRTUAL to AgentFactory
3. `agentFactory.updateApplicationThresholdWithApplicationId(...)` — updates application threshold
4. `agentFactory.removeBlacklistAddress(...)` — removes Uniswap LP blacklist
5. `IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)` — self-transfer of agent tokens
6. `agentFactory.executeBondingCurveApplicationSalt(...)` — finalizes graduation

If ANY call from step 3 onward reverts (AgentFactory paused, role revoked from BondingV5, or factory upgraded), the entire `_buy()` transaction reverts. But critically:

- `tokenInfo[token].trading` remains `true` (set to `false` only at L770, after all 4 calls)
- `tokenInfo[token].tradingOnUniswap` remains `false` (set to `true` only at L771)
- The graduation condition at L664-669 will STILL trigger on every subsequent buy because `newReserveA <= gradThreshold` remains true (the reserve hasn't changed — the entire buy reverted)
- Every future `buy()` call triggers `_openTradingOnUniswap()` which reverts again — **infinite revert loop**

**Worst-case boundary analysis**: If AgentFactory is paused after `router.graduate()` executes but before the rest completes, in a hypothetical non-atomic scenario the pair would be drained (all tokens and VIRTUAL moved to BondingV5) but graduation would not complete. However, since the entire `_buy()` is atomic (single transaction), the revert rolls back `router.graduate()` too. The pair retains its funds. The permanent DoS is that no buy can ever succeed — each buy hits the graduation threshold check, calls `_openTradingOnUniswap()`, which reverts.

**Recovery paths analyzed**:
- `sell()` at L581-618: does NOT check graduation condition, so users CAN sell. But selling increases reserve0 (moves away from graduation), and once sold, any buy triggers the loop again. Users can only exit via sell(), losing the graduation opportunity.
- `cancelLaunch()` at L462: requires `!launchExecuted`, but the token is already launched (`launchExecuted = true`). Cannot cancel.
- `setBondingConfig()` at L857: Owner can change config, but `tokenGradThreshold[tokenAddress]` is already set at preLaunch (L393) and never updated. No setter exists for per-token gradThreshold.
- No `emergencyGraduate()` or `skipGraduation()` function exists.
- No way to move `trading = false` without completing `_openTradingOnUniswap()`.

[BOUNDARY:tokenGradThreshold has no setter → owner cannot raise threshold to bypass graduation loop]
[TRACE:buy()→_buy()→L664 newReserveA<=gradThreshold→_openTradingOnUniswap()→revert at agentFactory call→entire buy reverts→next buy repeats]

**Impact**: Permanent DoS on ALL trading for the affected token. User VIRTUAL locked in FPairV2 can only be recovered via sell() (if users have agent tokens to sell back). No admin recovery without contract migration/upgrade. If the BondingV5 proxy is upgraded, all per-token state must be migrated. Estimated impact: ALL user funds deposited into the bonding curve for that token are effectively trapped in a degraded state (sell-only market with no graduation possible).

**Precondition Analysis**:
**Precondition**: AgentFactory must fail/revert during the graduation call sequence
**Precondition Type**: EXTERNAL
**Why This Blocks Under Normal Operation**: AgentFactory is a protocol-owned contract that normally functions correctly. However, AgentFactory upgrades, pauses, role revocations, or bugs all create this scenario. The 4 sequential calls create 4 separate failure points.

**Postcondition Analysis**:
**Postconditions Created**: Token permanently stuck in trading=true, tradingOnUniswap=false, every buy reverts
**Postcondition Types**: STATE
**Who Benefits**: Attacker who wants to DoS a specific token launch; competitor protocols; anyone who shorted the token

---

## Finding [DEPTH-ST-2]: cancelLaunch() CEI Violation — Reentrancy Window Before State Update

**Verdict**: PARTIAL
**Step Execution**: 1,2,3,4,5,6
**Rules Applied**: [R4: (adversarial escalation — checked VIRTUAL token callbacks), R8: (multi-step: transfer then state update), R11: (external token involved)]
**Depth Evidence**: [TRACE:cancelLaunch()→L480 safeTransfer(VIRTUAL)→callback?→L487-489 state updates not yet committed], [VARIATION:VIRTUAL=standard ERC20→no callback; VIRTUAL=ERC777/upgradeable→callback possible]
**Severity**: Medium (downgraded from High due to precondition analysis)
**Location**: BondingV5.sol:462-497

**Description**:
In `cancelLaunch()`, the sequence is:
```solidity
// L479-484: External call FIRST
if (tokenRef.initialPurchase > 0) {
    IERC20(router.assetToken()).safeTransfer(
        tokenRef.creator,
        tokenRef.initialPurchase
    );
}
// L486-489: State updates AFTER
uint256 initialPurchase = tokenRef.initialPurchase;
tokenRef.initialPurchase = 0;
tokenRef.trading = false;
tokenRef.launchExecuted = true;
```

This violates Checks-Effects-Interactions (CEI). During the `safeTransfer` at L480, if the asset token (VIRTUAL) has any callback mechanism (ERC-777 `tokensReceived`, upgradeable proxy with added hooks, or fee-on-transfer with rebalancing), the creator's receiving contract could re-enter BondingV5.

**Re-entrancy path analysis**:
1. Creator calls `cancelLaunch(tokenAddress)`
2. At L480, VIRTUAL is transferred to creator. If creator is a contract with a `receive()`/`fallback()` or ERC-777 hook:
3. Creator re-enters `cancelLaunch(tokenAddress)` — at this point `initialPurchase > 0` still (not zeroed yet) and `launchExecuted` still `false`
4. Second `cancelLaunch` executes the same transfer again — double refund
5. Both calls then zero `initialPurchase` and set `launchExecuted = true`

**Mitigation assessment**:
- BondingV5 does NOT have `nonReentrant` on `cancelLaunch()` (only on `preLaunch`, `launch`, `buy` — verified at L165, L500, L675)
- However, the production VIRTUAL token ($VIRTUAL on Base) is a standard ERC-20 without ERC-777 hooks or transfer callbacks
- VIRTUAL is behind a proxy (upgradeable), so future upgrades COULD add callback functionality
- The reentrancy guard from OZ `ReentrancyGuardUpgradeable` is NOT applied to `cancelLaunch()`

[TRACE:cancelLaunch()→safeTransfer at L480→if VIRTUAL has callback→re-enter cancelLaunch()→launchExecuted still false→initialPurchase still >0→double transfer]
[BOUNDARY:nonReentrant NOT on cancelLaunch() → guard does not protect this path]

**Impact**: If VIRTUAL token is ever upgraded to include transfer callbacks (or if BondingV5 is deployed on another chain with a different asset token that has callbacks), an attacker could drain their `initialPurchase` multiple times. Current production risk is LOW because VIRTUAL is standard ERC-20, but the code defect is real and exploitable under foreseeable conditions (VIRTUAL proxy upgrade, or multi-chain deployment with different asset token).

**Precondition Analysis**:
**Missing Precondition**: Asset token must have transfer callbacks (ERC-777, upgradeable with hooks)
**Precondition Type**: EXTERNAL
**Why This Blocks Currently**: Production VIRTUAL on Base is standard ERC-20 without callbacks. However, it is behind a proxy.

---

## Finding [DEPTH-ST-3]: FFactoryV2/V3 CREATOR_ROLE and ADMIN_ROLE Not Granted in initialize() — Requires Separate Transaction

**Verdict**: CONFIRMED (by design, not a vulnerability per se)
**Step Execution**: 1,2,3,5
**Rules Applied**: [R10: (worst-state — factory deployed but roles not yet granted)]
**Depth Evidence**: [TRACE:FFactoryV3.initialize()→grants only DEFAULT_ADMIN_ROLE to msg.sender at L59→no CREATOR_ROLE or ADMIN_ROLE granted], [TRACE:deployLaunchpadv5_1.ts L184→grants ADMIN_ROLE to deployer→L189 setRouter()→L194 grants ADMIN_ROLE to admin], [TRACE:deployLaunchpadv5_3.ts L359-360→grants CREATOR_ROLE to BondingV5]
**Severity**: Low (downgraded from High — operational, not a code vulnerability)
**Location**: FFactoryV2.sol:42-58, FFactoryV3.sol:50-66

**Description**:
`FFactoryV2.initialize()` and `FFactoryV3.initialize()` only grant `DEFAULT_ADMIN_ROLE` to `msg.sender` (L51/L59):
```solidity
function initialize(...) external initializer {
    __AccessControl_init();
    __ReentrancyGuard_init();
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    // ... set tax params, but NO ADMIN_ROLE or CREATOR_ROLE granted
}
```

This means immediately after deployment:
- `createPair()` is uncallable (requires `CREATOR_ROLE`)
- `setTaxParams()` is uncallable (requires `ADMIN_ROLE`)
- `setRouter()` is uncallable (requires `ADMIN_ROLE`)
- Only `DEFAULT_ADMIN_ROLE` holder (deployer) can grant roles

**However**, the deployment scripts (deployLaunchpadv5_1.ts L180-200, deployLaunchpadv5_3.ts L358-361) explicitly handle this:
1. Step 1 script grants ADMIN_ROLE to deployer, calls setRouter(), then grants ADMIN_ROLE and DEFAULT_ADMIN_ROLE to admin
2. Step 3 script grants CREATOR_ROLE to BondingV5

The e2e test (e2e_test.ts L187-198) verifies both roles are present before proceeding.

**Why this is Low, not High**: This is a standard OZ AccessControl deployment pattern — `DEFAULT_ADMIN_ROLE` is the role admin for all other roles, so the deployer CAN grant them. The factory is non-functional between `initialize()` and the role-granting transactions, but this window is only during deployment (same deployer, sequential transactions). There is no vulnerability IF the deployment script completes normally.

**Risk**: If deployment is interrupted between step 1 and step 3 (factory deployed but roles not granted), the factory remains in a permanently non-functional state until someone with DEFAULT_ADMIN_ROLE completes the role grants. The deployer address IS the DEFAULT_ADMIN_ROLE holder, so recovery is always possible.

[TRACE:initialize()→only DEFAULT_ADMIN_ROLE→factory unusable until step 3 grants CREATOR_ROLE to BondingV5]

**Impact**: Operational deployment risk. If the multi-step deployment is interrupted, the factory is non-functional but recoverable by the deployer.

---

## Finding [DEPTH-ST-4]: setRouter(address(0)) Creates Permanent Factory DoS — No Zero-Address Guard

**Verdict**: CONFIRMED
**Step Execution**: 1,2,3,5
**Rules Applied**: [R14: (setter regression — can set below required operational threshold)]
**Depth Evidence**: [BOUNDARY:router=address(0)→_createPair L68 require(router != address(0)) reverts→all createPair calls fail], [TRACE:setRouter(address(0))→router=0→createPair→revert "No router"→permanent DoS until admin calls setRouter again]
**Severity**: Medium
**Location**: FFactoryV2.sol:124-126, FFactoryV3.sol:132-134

**Description**:
```solidity
function setRouter(address router_) public onlyRole(ADMIN_ROLE) {
    router = router_;
}
```

No zero-address check. If `ADMIN_ROLE` calls `setRouter(address(0))`:
- `_createPair()` at L68 has `require(router != address(0), "No router")` — all future pair creation reverts
- Existing pairs still function (their `router` is set immutably in the FPairV2 constructor)
- Recovery: ADMIN_ROLE can call `setRouter(validAddress)` to fix

[BOUNDARY:router=address(0)→_createPair reverts at L68→new tokens cannot be launched]
[TRACE:setRouter(0)→factory.router=0→BondingV5.preLaunch()→factory.createPair()→revert→no new tokens]

**Impact**: All new token launches fail until router is re-set. Existing pairs and trading are unaffected. This is a recoverable admin misconfiguration, not a permanent DoS. The ADMIN_ROLE can immediately fix it.

**Precondition Analysis**:
**Precondition**: ADMIN_ROLE must call setRouter(address(0)) — accidental misconfiguration
**Precondition Type**: ACCESS
**Why This Blocks**: Requires admin to make a specific mistake

---

## Finding [DEPTH-ST-5]: EP-14 Confirmed — 4 Sequential AgentFactory Calls Each Require Different Roles

**Verdict**: CONFIRMED
**Step Execution**: 1,2,3,5
**Rules Applied**: [R5: (combinatorial — 4 calls × multiple roles), R8: (multi-step cached dependency)]
**Depth Evidence**: [TRACE:_openTradingOnUniswap L727→router.graduate() requires EXECUTOR_ROLE on FRouterV3→L731 agentFactory.updateApplicationThresholdWithApplicationId() requires BONDING_ROLE on AgentFactory→L737 agentFactory.removeBlacklistAddress() requires BONDING_ROLE→L748 agentFactory.executeBondingCurveApplicationSalt() requires BONDING_ROLE]
**Severity**: High
**Location**: BondingV5.sol:727-756

**Description**:
The graduation sequence requires BondingV5 to hold:
1. `EXECUTOR_ROLE` on FRouterV3 (for `router.graduate()` at L721)
2. Sufficient VIRTUAL balance to call `safeTransfer` to agentFactory (L727-729)
3. `BONDING_ROLE` on AgentFactory (for L731 `updateApplicationThresholdWithApplicationId`, L737 `removeBlacklistAddress`, L748 `executeBondingCurveApplicationSalt`)

From deployment script (deployLaunchpadv5_3.ts L367-374):
- FRouterV3.EXECUTOR_ROLE is granted to BondingV5
- AgentFactoryV7.BONDING_ROLE is granted to BondingV5

If ANY of these roles is revoked from BondingV5 (by DEFAULT_ADMIN_ROLE on the respective contract), graduation permanently fails for ALL tokens on this BondingV5 instance, creating the DoS described in DEPTH-ST-1.

[BOUNDARY:BONDING_ROLE revoked from BondingV5 on AgentFactory→ALL 3 agentFactory calls revert→every token at graduation threshold enters permanent DoS]
[TRACE:admin revokes BONDING_ROLE→next buy at grad threshold→_openTradingOnUniswap→agentFactory.updateApplicationThresholdWithApplicationId() reverts with AccessControl error→buy reverts→infinite loop]

**Impact**: Single role revocation by AgentFactory admin bricks ALL active tokens on BondingV5 that are approaching graduation. The blast radius is not per-token but per-BondingV5-deployment (all tokens). Combined with DEPTH-ST-1, this creates a systemic DoS vector through a single admin action on AgentFactory.

---

## Finding [DEPTH-ST-6]: EXECUTOR_ROLE Can Set taxStartTime to type(uint256).max — Permanent 99% Tax

**Verdict**: CONFIRMED
**Step Execution**: 1,2,3,5
**Rules Applied**: [R8: (stored external state — taxStartTime cached), R10: (worst-state)]
**Depth Evidence**: [BOUNDARY:taxStartTime=type(uint256).max→block.timestamp < taxStartTime always true→_calculateAntiSniperTax returns startTax (99%)→all buys taxed 99% forever], [TRACE:FPairV2.setTaxStartTime L198-206→require _taxStartTime >= startTime→if startTime is in the past, type(uint256).max passes the check→taxStartTime=MAX→FRouterV3._calculateAntiSniperTax L306 block.timestamp < taxStartTime→return startTax (99%)]
**Severity**: High
**Location**: FPairV2.sol:198-206, FRouterV3.sol:344-355, FRouterV2.sol:358-369

**Description**:
`FPairV2.setTaxStartTime()`:
```solidity
function setTaxStartTime(uint256 _taxStartTime) public onlyRouter {
    require(_taxStartTime >= startTime, "Tax start time must be greater than startTime");
    taxStartTime = _taxStartTime;
}
```

The ONLY validation is `_taxStartTime >= startTime`. For any live token, `startTime` is in the past. So any value from `startTime` to `type(uint256).max` is accepted.

FRouterV3._calculateAntiSniperTax (L304-308):
```solidity
if (block.timestamp < taxStartTime) {
    return startTax; // typically 99%
}
```

If taxStartTime = type(uint256).max, `block.timestamp < taxStartTime` is ALWAYS true. Every buy pays 99% anti-sniper tax. The tax cap at L194-197 ensures `normalTax + antiSniperTax <= 99`, so total tax = 99%.

**User recourse analysis**:
- `sell()` does NOT have anti-sniper tax (only normal sell tax). Users can sell but not buy.
- Users who already hold tokens can sell at normal tax rate.
- New users cannot buy at any reasonable price (99% goes to tax).
- Graduation becomes impossible (buy amounts after 99% tax are too small to move reserve below gradThreshold).

FRouterV3.setTaxStartTime is callable by any EXECUTOR_ROLE holder:
```solidity
function setTaxStartTime(address pairAddress, uint256 _taxStartTime) public onlyRole(EXECUTOR_ROLE) {
```

EXECUTOR_ROLE is held by BondingV5 AND beOpsWallet (per deployment script L226-229).

[BOUNDARY:taxStartTime=type(uint256).max→99% tax on all buys indefinitely]
[VARIATION:taxStartTime=block.timestamp+365days→99% tax for 1 year until it expires]

**Impact**: EXECUTOR_ROLE (beOpsWallet) can freeze any token's buy market by setting 99% permanent tax. Users' existing tokens can only be sold (not bought), and the token can never graduate. This is a privileged action but has disproportionate impact — one parameter change permanently cripples a token.

---

## Finding [DEPTH-ST-7]: teamTokenReservedWallet Race Condition Between preLaunch and launch

**Verdict**: CONFIRMED
**Step Execution**: 1,2,3,5
**Rules Applied**: [R8: (cached parameter read at two different times), R14: (setter regression)]
**Depth Evidence**: [TRACE:preLaunch L382-387→reads bondingConfig.teamTokenReservedWallet()→sends reserved tokens to wallet_A; launch L554-556→reads bondingConfig.teamTokenReservedWallet()→sends initial buy tokens to wallet_B (different if changed)], [VARIATION:wallet changes from A→B between preLaunch and launch→reserved tokens at A, initial buy tokens at B→split distribution]
**Severity**: Medium
**Location**: BondingV5.sol:382-387, 554-556, BondingConfig.sol:250-253

**Description**:
`_preLaunch()` at L382-387:
```solidity
if (totalReservedSupply > 0) {
    IERC20(token).safeTransfer(
        bondingConfig.teamTokenReservedWallet(), // reads LIVE value
        totalReservedSupply * (10 ** IAgentTokenV2(token).decimals())
    );
}
```

`launch()` at L554-556:
```solidity
IERC20(tokenAddress_).safeTransfer(
    bondingConfig.teamTokenReservedWallet(), // reads LIVE value again
    amountOut
);
```

If `BondingConfig.setTeamTokenReservedWallet()` is called between preLaunch and launch:
- Reserved tokens (airdrop + ACF) go to wallet_A
- Creator's initial buy tokens go to wallet_B
- Backend distribution logic that expects ALL tokens at one wallet breaks

**Economic impact**: The wallet change itself is an admin action (onlyOwner on BondingConfig). The impact is operational: if wallet_A is decommissioned after the change, the reserved tokens at wallet_A may become inaccessible. The protocol's off-chain token distribution breaks.

[TRACE:preLaunch→wallet_A receives reserved supply→admin changes wallet→launch→wallet_B receives initial buy→split state]

**Impact**: Token distribution accounting breaks for the affected token. Reserved tokens and initial buy tokens end up at different wallets. Requires admin misconfiguration or intentional wallet rotation during active launches.

---

## Finding [DEPTH-ST-8]: Deprecated Storage Slots in FRouterV2 — Slot Positions Verified

**Verdict**: CONFIRMED (informational refinement of MG-2)
**Step Execution**: 1,2,3,5
**Rules Applied**: [R14: (storage layout constraint coherence)]
**Depth Evidence**: [TRACE:FRouterV2 storage layout→slot 0: Initializable._initialized+_initializing (1 byte each), slot 1-50: AccessControlUpgradeable._roles + __gap[49], slot 51-100: ReentrancyGuardUpgradeable._status + __gap[49], slot 101: factory, slot 102: assetToken, slot 103: taxManager (DEPRECATED), slot 104: antiSniperTaxManager (DEPRECATED), slot 105: bondingV2, slot 106: bondingV4]
**Severity**: Medium
**Location**: FRouterV2.sol:40-42, 59

**Description**:
FRouterV2 inherits: Initializable (2 slots: _initialized + _initializing packed), AccessControlUpgradeable (1 slot _roles + 49 __gap), ReentrancyGuardUpgradeable (1 slot _status + 49 __gap).

Storage layout (0-indexed):
- Slot 0: `_initialized` (uint8) + `_initializing` (bool) — packed by OZ v5.x
- Slots 1-50: `_roles` mapping (slot 1) + `__gap[49]` from AccessControlUpgradeable
- Slots 51-100: `_status` (slot 51) + `__gap[49]` from ReentrancyGuardUpgradeable
- Slot 101: `factory` (address)
- Slot 102: `assetToken` (address)
- Slot 103: `taxManager` (address) — **DEPRECATED, must not be removed**
- Slot 104: `antiSniperTaxManager` (address) — **DEPRECATED, must not be removed**
- Slot 105: `bondingV2` (IBondingV2ForRouter)
- Slot 106: `bondingV4` (IBondingV4ForRouter)

If a future upgrade removes the deprecated `taxManager` and `antiSniperTaxManager` declarations:
- `bondingV2` would shift from slot 105 to slot 103
- `bondingV4` would shift from slot 106 to slot 104
- Both would read incorrect data — `bondingV2` would read the old `taxManager` value, `bondingV4` would read the old `antiSniperTaxManager` value

[TRACE:upgrade removes deprecated slots→bondingV2 reads slot 103 (old taxManager address)→isProject60days() called on wrong address→unpredictable behavior]

**Impact**: Future proxy upgrades of FRouterV2 must preserve the deprecated slot declarations. Removing them causes storage corruption. The current code is correct (slots are declared). This is a maintenance hazard, not an active vulnerability.

---

## Finding [DEPTH-ST-9]: FRouterV3._calculateAntiSniperTax Reverts for Non-BondingV5 Tokens (Confirmed Hard DoS)

**Verdict**: CONFIRMED (confirms MG-1)
**Step Execution**: 1,2,3,5
**Rules Applied**: [R8: (cached reference — bondingV5 address)]
**Depth Evidence**: [TRACE:FRouterV3._calculateAntiSniperTax L293→bondingV5.tokenAntiSniperType(tokenAddress)→BondingV5.tokenAntiSniperType L793-797→if tokenInfo[token_].creator == address(0) revert InvalidTokenStatus()→revert propagates to FRouterV3→buy() reverts]
**Severity**: Medium
**Location**: FRouterV3.sol:293, BondingV5.sol:793-798

**Description**:
FRouterV3._calculateAntiSniperTax (L293):
```solidity
uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);
```

BondingV5.tokenAntiSniperType (L793-797):
```solidity
function tokenAntiSniperType(address token_) external view returns (uint8) {
    if (tokenInfo[token_].creator == address(0)) {
        revert InvalidTokenStatus();
    }
    return tokenLaunchParams[token_].antiSniperTaxType;
}
```

This call has NO try/catch. If any token NOT created by BondingV5 is registered in FFactoryV3 (misconfiguration, admin error, or future V6 bonding contract sharing the same factory), ALL buys for that token permanently revert.

FRouterV2 handles this more gracefully by using try/catch for its BondingV4 check (L332-339).

[TRACE:non-V5 token registered in FFactoryV3→user buy()→BondingV5._buy()→FRouterV3.buy()→_calculateAntiSniperTax()→bondingV5.tokenAntiSniperType() reverts→entire buy fails]

**Impact**: Any non-BondingV5 token that somehow gets a pair in FFactoryV3 becomes permanently untradeable through FRouterV3. This is unlikely in normal operation but creates a brittle assumption that FFactoryV3 ONLY contains V5 tokens.

---

## Finding [DEPTH-ST-10]: BondingV2/V3/V4 cancelLaunch() Does Not Set trading=false — Cancelled Tokens Have Inconsistent State

**Verdict**: CONFIRMED (Low severity — latent inconsistency, no exploitable path found)
**Step Execution**: 1,2,3,5
**Rules Applied**: [R10: (worst-state analysis)]
**Depth Evidence**: [TRACE:BondingV2.cancelLaunch()→sets launchExecuted=true, initialPurchase=0→does NOT set trading=false], [VARIATION:cancelled V2 token state→trading=true, launchExecuted=true→buy() at L590-592 requires trading=true AND launchExecuted=true→BOTH true→buy() would proceed past guards], [TRACE:buy()→_buy()→router.buy()→pair.swap()→requires block.timestamp >= startTime→if past startTime, swap succeeds]
**Severity**: Low
**Location**: BondingV2.sol:387-420, BondingV3.sol:322-353, BondingV4.sol:394-425

**Description**:
In BondingV2/V3/V4 `cancelLaunch()`:
```solidity
_token.initialPurchase = 0;
_token.launchExecuted = true;
// NOTE: trading is NOT set to false
```

After cancellation, the token has: `trading = true`, `launchExecuted = true`. The `buy()` function's guards at L590-592:
```solidity
if (!tokenInfo[tokenAddress_].trading) revert; // passes — trading is true
if (!tokenInfo[tokenAddress_].launchExecuted) revert; // passes — launchExecuted is true
```

However, `buy()` also calls `_buy()` which calls `router.buy()` which calls `pair.swap()`. The pair's `swap()` requires `block.timestamp >= startTime`. For cancelled tokens, the pair still exists with its startTime. If startTime is in the past, swaps would technically be allowed.

BUT: the pair still has the original liquidity (cancel doesn't drain the pair). Users COULD technically buy from a cancelled token's pair in V2/V3/V4.

In BondingV5, this is fixed — `cancelLaunch()` at L488 explicitly sets `tokenRef.trading = false`.

[TRACE:BondingV2 cancel→trading=true→buy() passes guards→swap on pair→tokens flow→but token is "cancelled"]

**Impact**: Cancelled tokens in BondingV2/V3/V4 remain technically tradeable. Since V2/V3 have `revert("Not implemented")` in preLaunch (so no new tokens can be created), and V4's preLaunch also reverts, this only affects tokens that were already created on these deprecated contracts. Low practical impact but a state inconsistency.

---

## Finding [DEPTH-ST-11]: Combination — CEI Violation (RS2-3) + Token Lock (TF-2) = Potential Double-Refund Before Lock Recording

**Verdict**: PARTIAL (theoretical, requires callback-bearing asset token)
**Step Execution**: 1,2,3,4,5
**Rules Applied**: [R4: (adversarial escalation), R15: (flash loan not applicable — creator-only function)]
**Depth Evidence**: [TRACE:cancelLaunch→safeTransfer(VIRTUAL) at L480→if callback→re-enter cancelLaunch→initialPurchase still >0→second transfer→both calls then zero initialPurchase and set launchExecuted=true→but tokens in pair remain locked (no drain)], [BOUNDARY:double-refund amount = 2 × initialPurchase, limited to BondingV5's VIRTUAL balance]
**Severity**: Medium (same root cause as DEPTH-ST-2, combination does not escalate)
**Location**: BondingV5.sol:462-497

**Description**:
Combining RS2-3 (CEI violation in cancelLaunch) with TF-2 (agent tokens locked in pair after cancel):

If cancelLaunch is re-entered, the attacker gets double their initialPurchase refund. The agent tokens in the FPairV2 remain locked in both scenarios (cancel doesn't drain the pair). So the combination doesn't create a new attack vector beyond the double-refund — the token lock is unchanged whether cancelLaunch runs once or twice.

The maximum extractable amount is `2 * initialPurchase`, bounded by BondingV5's VIRTUAL balance. Since BondingV5 holds `initialPurchase` amounts from ALL pending tokens, a large enough initialPurchase could drain other tokens' escrowed funds.

[BOUNDARY:BondingV5 holds sum of all pending initialPurchase amounts→double-refund drains from this pool→other creators' refunds may fail]

**Impact**: Same as DEPTH-ST-2 but with the additional insight that the double-refund drains from a shared pool (BondingV5's VIRTUAL balance), potentially affecting other creators' ability to cancel their launches.

---

## Finding [DEPTH-ST-12]: Combination — EP-8 (DoS) + MG-3 (setBondingConfig) = Config Change Cannot Fix DoS

**Verdict**: CONFIRMED
**Step Execution**: 1,2,3,5
**Rules Applied**: [R5: (combinatorial), R14: (setter regression — no setter for tokenGradThreshold)]
**Depth Evidence**: [TRACE:EP-8 DoS active→owner calls setBondingConfig(newConfig)→tokenGradThreshold[token] at L662 reads from mapping (set at preLaunch)→unchanged→DoS persists], [BOUNDARY:no function exists to update tokenGradThreshold[token] post-preLaunch→even config swap cannot fix]
**Severity**: Critical (same as EP-8 — config change does not help)
**Location**: BondingV5.sol:662, 110, 857-859

**Description**:
When EP-8 DoS is active (graduation reverts), an admin might try to work around it by changing BondingConfig to set a different gradThreshold calculation. However:

```solidity
// L662: uses per-token stored threshold, NOT live config
uint256 gradThreshold = tokenGradThreshold[tokenAddress_];
```

`tokenGradThreshold[tokenAddress_]` was set at preLaunch time (L390-393) and NEVER updated. No setter exists. Changing BondingConfig only affects future tokens, not the stuck one.

This confirms that the DoS from EP-8 has NO admin recovery path through configuration changes.

---

## Second Opinion: REFUTED Findings

### MG-5: REFUTED Stands — All 9 Proxy Implementations Call _disableInitializers()

Verified via grep: All 9 contracts that inherit Initializable have `_disableInitializers()` in their constructors:
- BondingV2.sol:129, BondingV3.sol:125, BondingV4.sol:145, BondingV5.sol:147
- BondingConfig.sol:128
- FFactoryV2.sol:39, FFactoryV3.sol:47
- FRouterV2.sol:63, FRouterV3.sol:70

FPairV2 does NOT inherit Initializable (uses constructor, not proxy pattern) — correct.

**Second opinion verdict**: REFUTED confirmed. No reinitializer vulnerability.

### MG-7: REFUTED Stands — V5 Is Separate Deployment

BondingV5.sol has completely different storage layout from V2/V3/V4:
- V2-V4: `_feeTo, factory(FFactoryV2), router(FRouterV2), initialSupply, fee, K(constant), assetRate, gradThreshold, maxTx, agentFactory, ...`
- V5: `factory(IFFactoryV2Minimal), router(IFRouterV3Minimal), agentFactory(IAgentFactoryV7Minimal), bondingConfig(BondingConfig), tokenInfo(mapping), ...`

Deployment scripts confirm separate proxies. No upgrade path from V4 to V5 exists in the deployment scripts.

**Second opinion verdict**: REFUTED confirmed. V5 is a separate proxy deployment.

---

## Write Completeness — Semantic Invariant Gap Verification

### `_pool.lastUpdated` not updated in `syncAfterDrain()`
**Verified**: Real gap but no exploitable impact. `_pool.lastUpdated` in FPairV2 is written on every `swap()` and `mint()` but NOT in `syncAfterDrain()`. However, `lastUpdated` is never READ by any contract — it is only emitted in the Pool struct. The `tokenInfo[token].data.lastUpdated` in BondingV5 (different variable) IS read for the 24h volume gate but has no connection to the FPairV2 pool's lastUpdated. Dead storage in FPairV2 — confirms TF-7.

### `tokenInfo[token].trading` NOT set false in BondingV2/V3/V4 cancelLaunch()
**Verified**: Real gap, analyzed in DEPTH-ST-10. The V2/V3 contracts have `revert("Not implemented")` in preLaunch, so no new tokens can be affected. V4 also reverts in preLaunch. Only tokens already created on these deprecated contracts are affected.

### `tokenInfo[token].data.lastUpdated` only updated on NEXT trade after 24h
**Verified**: The code at BondingV5.sol L654-659:
```solidity
uint256 duration = block.timestamp - tokenInfo[tokenAddress_].data.lastUpdated;
if (duration > 86400) {
    tokenInfo[tokenAddress_].data.lastUpdated = block.timestamp;
}
```
This updates `lastUpdated` but does NOT update `volume24H`. The `volume24H` field is initialized to 0 at preLaunch (L437) and NEVER written again. This is dead code — volume24H tracking is incomplete/abandoned.

---

## Callback Selective Revert Analysis

### BondingV5.cancelLaunch() L480 safeTransfer to creator
[TRACE:cancelLaunch()→safeTransfer(VIRTUAL) to tokenRef.creator→outcome=initialPurchase amount visible before callback→revert resets=YES (no state committed yet)→retry=YES (re-enter cancelLaunch for double refund)]

### BondingV5._openTradingOnUniswap L746 self-transfer
[TRACE:_openTradingOnUniswap()→IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)→callback to agent token contract→outcome=graduation in progress visible→revert resets=YES (entire graduation reverts)→retry=NO (would re-trigger same graduation path)]

### BondingV5.launch() L554 transfer to teamTokenReservedWallet
[TRACE:launch()→safeTransfer(agentToken) to bondingConfig.teamTokenReservedWallet()→callback to wallet→outcome=initial buy tokens visible→revert resets=YES→retry=NO (nonReentrant on launch)]

### FRouterV3.buy() L204 safeTransferFrom to pair
[TRACE:buy()→safeTransferFrom(VIRTUAL) from buyer to pair→callback to buyer→outcome=amount transferred visible→revert resets=YES→retry=NO (nonReentrant on buy)]

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|------------|----------|--------------------:|---------|----------|-------------------|-------------------|
| DEPTH-ST-1 | BondingV5.sol:703-772 | AgentFactory failure mid-graduation bricks token permanently — no admin recovery path | CONFIRMED | Critical | EXTERNAL | PERMANENT_DOS |
| DEPTH-ST-2 | BondingV5.sol:462-497 | cancelLaunch() CEI violation: safeTransfer before state update, no nonReentrant | PARTIAL | Medium | EXTERNAL (callback-bearing token) | DOUBLE_REFUND |
| DEPTH-ST-3 | FFactoryV2.sol:42-58, FFactoryV3.sol:50-66 | CREATOR_ROLE/ADMIN_ROLE not in initialize() — standard OZ pattern, handled by deployment scripts | CONFIRMED (by design) | Low | DEPLOYMENT_INTERRUPTION | FACTORY_NONFUNCTIONAL |
| DEPTH-ST-4 | FFactoryV2.sol:124-126, FFactoryV3.sol:132-134 | setRouter(address(0)) not blocked — recoverable admin DoS on new pair creation | CONFIRMED | Medium | ACCESS (admin misconfig) | NEW_PAIR_DOS |
| DEPTH-ST-5 | BondingV5.sol:727-756 | 4 sequential AgentFactory calls require BONDING_ROLE — single role revocation bricks ALL tokens | CONFIRMED | High | ROLE_REVOCATION | SYSTEMIC_DOS |
| DEPTH-ST-6 | FPairV2.sol:198-206, FRouterV3.sol:344-355 | setTaxStartTime accepts type(uint256).max — permanent 99% tax on buys | CONFIRMED | High | ACCESS (EXECUTOR_ROLE) | TAX_MANIPULATION |
| DEPTH-ST-7 | BondingV5.sol:382-387, 554-556 | teamTokenReservedWallet read live at preLaunch and launch — can diverge | CONFIRMED | Medium | CONFIG_CHANGE | ACCOUNTING_SPLIT |
| DEPTH-ST-8 | FRouterV2.sol:40-42 | Deprecated storage slots at 103-104 must be preserved in upgrades | CONFIRMED | Medium | UPGRADE_RISK | STORAGE_CORRUPTION |
| DEPTH-ST-9 | FRouterV3.sol:293, BondingV5.sol:793-798 | tokenAntiSniperType() reverts for non-V5 tokens — hard DoS without try/catch | CONFIRMED | Medium | MISCONFIGURATION | BUY_DOS |
| DEPTH-ST-10 | BondingV2-V4 cancelLaunch() | cancelled tokens retain trading=true — latent state inconsistency | CONFIRMED | Low | DESIGN | INCONSISTENT_STATE |
| DEPTH-ST-11 | BondingV5.sol:462-497 | Combination: CEI + shared escrow = double-refund drains other creators' escrowed funds | PARTIAL | Medium | EXTERNAL (callback) | SHARED_POOL_DRAIN |
| DEPTH-ST-12 | BondingV5.sol:662, 857-859 | Combination: EP-8 DoS + no tokenGradThreshold setter = config change cannot fix DoS | CONFIRMED | Critical | EXTERNAL | UNRECOVERABLE_DOS |

SCOPE: Write ONLY to assigned output file. Do NOT read or write other agents' output files. Do NOT proceed to subsequent pipeline phases (chain analysis, verification, report). Return findings and stop.
