# Depth External Dependencies Findings

**Agent:** Depth External Dependencies Agent
**Date:** 2026-04-02
**Domain:** External Dependencies — cross-chain timing, MEV, external call side effects, external protocol behavior, oracle manipulation
**Scope:** contracts/launchpadv2/ (BondingV5, FRouterV2, FRouterV3, FPairV2, FFactoryV2/V3, multicall3, BondingConfig)

---

## Finding [DE-1]: drainUniV2Pool Founder Approval Gap — No Protocol Flow Creates veToken Approval

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(single entity) | ✓6,7
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no semi-trusted role — EXECUTOR is trusted for this function), R8:✓, R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition), R15:✗(no flash-loan-accessible state), R16:✗(no oracle)]
**Depth Evidence**: [TRACE:drainUniV2Pool() → L465 gets agentFactory → L466 calls removeLpLiquidity(veToken, recipient, veTokenAmount, 0, 0, deadline) → AgentFactoryV7.sol:557 onlyRole(REMOVE_LIQUIDITY_ROLE) → L558 calls veToken.removeLpLiquidity() → requires founder approval of factory for veToken spend → NO protocol flow creates this approval], [BOUNDARY:veTokenAmount=founder.balanceOf(veToken)=1M tokens → factory.transferFrom(founder, ..., 1M) requires founder.approve(factory, >= 1M) → this approval NEVER exists on-chain unless created off-chain]
**Severity**: High
**Location**: FRouterV3.sol:466, FRouterV2.sol:480, AgentFactoryV7.sol:557-559

**Description**: `drainUniV2Pool()` reads `IERC20(veToken).balanceOf(founder)` at L458/472 and passes this full amount to `agentFactory.removeLpLiquidity()`. Internally, `removeLpLiquidity` calls `IAgentVeTokenV2(veToken).removeLpLiquidity(...)`, which needs to transfer the founder's veTokens. This requires the founder to have pre-approved the AgentFactory contract for veToken spend.

No protocol function in the entire LaunchpadV2 codebase creates this approval. There is no `approve()` call on veToken anywhere in BondingV5, FRouterV2, FRouterV3, or any deployment script. The approval must come from an off-chain transaction by the founder EOA.

**Impact**: 
- `drainUniV2Pool()` will **always revert** for any Project60days token unless the founder has manually approved the AgentFactory for veToken spend via a separate off-chain transaction.
- This is an operational gap: the EXECUTOR_ROLE (beOpsWallet) cannot drain graduated Project60days pools without coordinating with the founder EOA, which may be a different entity.
- If the founder becomes unreachable, the liquidity is permanently locked in the Uniswap V2 pool.

**Evidence**:
```solidity
// FRouterV3.sol:456-473
IAgentVeTokenV2 veTokenContract = IAgentVeTokenV2(veToken);
address founder = veTokenContract.founder();
uint256 veTokenAmount = IERC20(veToken).balanceOf(founder);
require(veTokenAmount > 0, "No liquidity to drain");
address agentFactory = bondingV5.agentFactory();
IAgentFactoryV7(agentFactory).removeLpLiquidity(
    veToken, recipient, veTokenAmount, 0, 0, deadline
);
// AgentFactoryV7.sol:550-559
function removeLpLiquidity(...) public onlyRole(REMOVE_LIQUIDITY_ROLE) {
    IAgentVeTokenV2(veToken).removeLpLiquidity(
        _uniswapRouter, recipient, veTokenAmount, amountAMin, amountBMin, deadline
    );
}
// veToken.removeLpLiquidity internally does transferFrom(founder, ..., veTokenAmount)
// → requires founder.approve(agentFactory, veTokenAmount) → NEVER set by protocol
```

### Postcondition Analysis
**Postconditions Created**: drainUniV2Pool is non-functional without off-chain coordination
**Postcondition Types**: [EXTERNAL]
**Who Benefits**: No one directly benefits; this is a functional gap

---

## Finding [DE-2]: AgentFactory.createNewAgentTokenAndApplication Reverts on Failure — Return Value Check is Defense-in-Depth Only

**Verdict**: PARTIAL (downgraded from EP-1/EP-2/EP-3)
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✓, R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition)]
**Depth Evidence**: [TRACE:createNewAgentTokenAndApplication() → AgentFactoryV7.sol:466 `whenNotPaused` modifier → if paused, reverts with "Pausable: paused" → BondingV5._preLaunch reverts entirely → no state change], [TRACE:AgentFactoryV7.sol:475 `_createNewAgentToken()` → deploys via CREATE2 → if collision: reverts; if factory paused: reverts; if invalid params: reverts with require → all failure modes revert, none return address(0)], [VARIATION:factory paused=true → revert("Pausable: paused"), factory paused=false + valid params → returns (valid address, valid id)]
**Severity**: Medium (defense-in-depth — return value check would be best practice but factory reverts on failure)
**Location**: BondingV5.sol:331-352, 366-371, 748-756

**Description**: EP-1, EP-2, EP-3 flagged missing return value validation on three AgentFactory calls. Deep analysis of AgentFactoryV7 reveals that:

1. `createNewAgentTokenAndApplication()` (L453-501): Protected by `whenNotPaused`, `onlyRole(BONDING_ROLE)`, `noReentrant`. Uses `_createNewAgentToken()` which deploys via CREATE2 — deployment failures (collision, out-of-gas, invalid params) all cause reverts. The function does NOT have a code path that returns `(address(0), 0)` without reverting.

2. `factory.createPair()` (FFactoryV3.sol:96-103): Protected by `onlyRole(CREATOR_ROLE)`, `nonReentrant`. Creates via `new FPairV2(...)`. Solidity `new` keyword reverts on failure. No path returns `address(0)`.

3. `executeBondingCurveApplicationSalt()` (L510-532): Protected by `onlyRole(BONDING_ROLE)`, `noReentrant`. Calls `_executeApplication()` which has internal requires. If the application doesn't exist or is already executed, it reverts. The return value comes from `IAgentNft(nft).virtualInfo(application.virtualId).token` — if the NFT mint failed, the prior `_executeApplication` would have reverted.

**Impact**: The missing return value checks are a code quality issue (defense-in-depth), not an exploitable vulnerability. All three external contracts revert on failure rather than returning zero addresses. However, if AgentFactory is ever upgraded to a version that returns (address(0), 0) instead of reverting, the lack of checks would become critical.

**Evidence**:
```solidity
// AgentFactoryV7.sol:453-501 — all failure paths revert
function createNewAgentTokenAndApplication(...)
    public whenNotPaused onlyRole(BONDING_ROLE) noReentrant returns (address, uint256)
{
    require(cores.length > 0, "Cores must be provided");  // reverts
    address token = _createNewAgentToken(...);  // CREATE2, reverts on failure
    // ... sets up application ...
    return (token, id);  // token is always valid if we reach here
}
```

### Precondition Analysis
**Missing Precondition**: Future AgentFactory upgrade could change revert-on-failure behavior
**Precondition Type**: EXTERNAL
**Why This Blocks**: Current factory implementation always reverts on failure; address(0) return is unreachable

---

## Finding [DE-3]: Graduation Flow — 4 Sequential AgentFactory Calls All Require BONDING_ROLE, Single Role Revocation Bricks Graduation

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✓, R10:✓, R11:✗(no external tokens), R12:✓, R15:✗(no flash-loan-accessible state)]
**Depth Evidence**: [TRACE:_openTradingOnUniswap() → L727 agentFactory.safeTransfer(assetBalance) → L731 agentFactory.updateApplicationThresholdWithApplicationId(onlyRole(BONDING_ROLE)) → L737 agentFactory.removeBlacklistAddress(onlyRole(BONDING_ROLE)) → L748 agentFactory.executeBondingCurveApplicationSalt(onlyRole(BONDING_ROLE)) → if BONDING_ROLE revoked between L727 and L731: L731 reverts, assetBalance already transferred to agentFactory, pair already drained by router.graduate()], [BOUNDARY:BONDING_ROLE revoked after router.graduate() at L721 but before L731 → assetBalance (real VIRTUAL from all users' buys) stranded in AgentFactory with no recovery path from BondingV5], [TRACE:router.graduate() at L721 → FRouterV3.graduate() → transfers ALL assetBalance and tokenBalance from pair to msg.sender (BondingV5) → pair is now empty → L727 transfers assetBalance from BondingV5 to agentFactory → if L731 reverts → VIRTUAL is in agentFactory, agent tokens are in BondingV5 at L746 → pair is drained, pool marked for graduation but `trading` still true, `tradingOnUniswap` still false → subsequent buys still route to drained pair → getAmountsOut returns 0 or reverts on division by zero (k=0 after syncAfterDrain → but syncAfterDrain is NOT called in graduate path, only in drainPrivatePool) → actually pair reserves are NOT updated by graduate() → virtual reserves still show old values → getAmountsOut returns non-zero → user sends VIRTUAL → pair.transferTo sends from pair's token balance (now 0) → REVERT → permanent DoS]

**Severity**: Critical
**Location**: BondingV5.sol:703-772

**Description**: The graduation flow in `_openTradingOnUniswap()` makes 4 sequential calls that each require `BONDING_ROLE` on AgentFactoryV7:

| Step | Line | Call | Role Required | Failure Impact |
|------|------|------|---------------|----------------|
| 1 | L721 | `router.graduate(tokenAddress_)` | EXECUTOR_ROLE on FRouterV3 | Drains pair completely |
| 2 | L727-728 | `IERC20.safeTransfer(agentFactory, assetBalance)` | None (ERC20 transfer) | Sends all VIRTUAL to factory |
| 3 | L731-733 | `agentFactory.updateApplicationThresholdWithApplicationId()` | BONDING_ROLE | Sets withdrawable amount |
| 4 | L737-739 | `agentFactory.removeBlacklistAddress()` | BONDING_ROLE | Unblocks UniV2 pool |
| 5 | L746 | `IERC20.safeTransfer(tokenAddress_, tokenBalance)` | None (ERC20 transfer) | Self-transfer of agent tokens |
| 6 | L748-756 | `agentFactory.executeBondingCurveApplicationSalt()` | BONDING_ROLE | Finalizes graduation |

If BONDING_ROLE is revoked from BondingV5 mid-graduation (race condition with admin revoking role) OR if AgentFactory is upgraded/paused between steps:
- Step 1 succeeds: pair is drained, all real VIRTUAL + agent tokens now in BondingV5
- Step 2 succeeds: VIRTUAL transferred to AgentFactory
- Steps 3-6 revert: the entire transaction reverts (atomicity saves us here in a single tx)

However, the critical scenario is **AgentFactory being paused** — `createNewAgentTokenAndApplication` has `whenNotPaused` but the graduation functions (`updateApplicationThresholdWithApplicationId`, `removeBlacklistAddress`, `executeBondingCurveApplicationSalt`) do NOT have `whenNotPaused`. They only check `onlyRole(BONDING_ROLE)`. So if the AgentFactory admin revokes BONDING_ROLE from BondingV5 (intentionally or as part of a migration), ALL in-flight tokens are bricked:
- Every subsequent `buy()` triggers `_openTradingOnUniswap()` which reverts at L731
- Since `tokenRef.trading` is still `true`, every buy call reaches the graduation check
- The graduation check passes (reserve <= gradThreshold) but the function reverts
- Users cannot sell either if the token has reached graduation reserve levels (insufficient reserves)
- Result: **permanent DoS** with user VIRTUAL locked in the pair

**Impact**: Any administrative action on AgentFactory that removes BONDING_ROLE from BondingV5 permanently bricks ALL tokens at or near graduation threshold. User funds (VIRTUAL deposits from buys) become permanently locked. The only recovery would require a BondingV5 upgrade or AgentFactory role restoration.

**Evidence**:
```solidity
// BondingV5.sol:703-772 — _openTradingOnUniswap
function _openTradingOnUniswap(address tokenAddress_) private {
    // ...
    router.graduate(tokenAddress_);  // drains pair to BondingV5
    
    IERC20(router.assetToken()).safeTransfer(address(agentFactory), assetBalance);  // sends VIRTUAL to factory
    
    agentFactory.updateApplicationThresholdWithApplicationId(  // BONDING_ROLE required
        tokenRef.applicationId, assetBalance
    );
    agentFactory.removeBlacklistAddress(  // BONDING_ROLE required
        tokenAddress_, IAgentTokenV2(tokenAddress_).liquidityPools()[0]
    );
    // ... more BONDING_ROLE calls ...
}
```

Note: The atomicity of the EVM transaction means partial graduation cannot occur within a single tx. The real risk is BONDING_ROLE revocation making ALL graduation attempts revert permanently.

### Postcondition Analysis
**Postconditions Created**: Permanent trading DoS for all tokens at graduation threshold
**Postcondition Types**: [STATE, BALANCE]
**Who Benefits**: No one — this is a systemic failure mode

---

## Finding [DE-4]: Graduation Donation Attack — Attacker Can Inflate Uniswap Pool Initialization Ratio

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✓, R12:✗(no dangerous precondition), R15:✓]
**Depth Evidence**: [TRACE:attacker sends 1000 VIRTUAL directly to FPairV2 → assetBalance() = real_user_deposits + 1000 → graduation triggers → L718 reads assetBalance = inflated → L727 safeTransfer(agentFactory, inflated_assetBalance) → agentFactory gets extra 1000 VIRTUAL → L731 updateApplicationThresholdWithApplicationId(inflated) → excess VIRTUAL locked in agentFactory as application threshold → attacker loses donated VIRTUAL permanently], [BOUNDARY:donation=0 → normal graduation; donation=assetBalance → 2x VIRTUAL sent to factory → application threshold doubled → locked but not stolen], [VARIATION:donation to agent token side → pair.balance() inflated → L746 safeTransfer(tokenAddress_, inflated_tokenBalance) → more agent tokens sent to token contract itself → these tokens go to executeBondingCurveApplicationSalt as lpSupply → Uniswap pool gets extra agent tokens → initial price on Uniswap lower than expected → attacker could buy cheap immediately after graduation]

**Severity**: Medium
**Location**: BondingV5.sol:718-719, 727-729, 746-756

**Description**: The graduation function reads real balances via `pairContract.assetBalance()` and `pairContract.balance()` (L718-719), which return `IERC20(tokenB).balanceOf(address(this))` and `IERC20(tokenA).balanceOf(address(this))`. An attacker can donate tokens directly to the FPairV2 contract before a graduation-triggering buy.

**Attack scenario (agent token donation):**
1. Attacker monitors mempool for a buy that will trigger graduation (token reserve dropping below gradThreshold)
2. Attacker frontruns the graduation-triggering buy by sending X agent tokens directly to the FPairV2 address
3. Graduation triggers: `tokenBalance = pair.balance()` now includes donated tokens
4. L746: `IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)` sends inflated amount to token contract
5. L748-756: `executeBondingCurveApplicationSalt(... lpSupply = tokenBalance / 1 ether ...)` creates Uniswap pool with inflated token supply
6. Result: More tokens in Uniswap pool = lower initial price = attacker buys cheap on Uniswap immediately after graduation

**Attack scenario (VIRTUAL donation):**
1. Attacker donates VIRTUAL directly to FPairV2
2. Graduation reads `assetBalance = real + donated`
3. All VIRTUAL (including donated) goes to AgentFactory as application threshold
4. Result: Donated VIRTUAL locked in AgentFactory — no profit to attacker, just griefing

The agent token donation attack is more interesting because it distorts the Uniswap pool initialization ratio, allowing the attacker to buy at a discount post-graduation.

**Economic analysis:**
- Agent token donation of 10% of tokenBalance → Uniswap pool has 10% more tokens but same VIRTUAL → price is ~10% lower
- Attacker buys at this discount, then sells at market price as arbitrageurs correct the price
- Cost: the donated agent tokens (attacker must have bought them on bonding curve)
- Profit: discount on Uniswap purchases minus cost of donated tokens minus gas
- [BOUNDARY: donated_amount=0.1*tokenBalance → ~9% price discount on Uniswap initial listing → profitable if graduation Uniswap trading volume > donated_amount within first few blocks]

**Impact**: Manipulation of post-graduation Uniswap initial price. The profit depends on trading volume in the first blocks after graduation. Given MEV infrastructure on Base, this is a realistic attack for popular tokens.

**Evidence**:
```solidity
// BondingV5.sol:718-719 — reads real balances
uint256 assetBalance = pairContract.assetBalance();  // IERC20(tokenB).balanceOf(pair)
uint256 tokenBalance = pairContract.balance();        // IERC20(tokenA).balanceOf(pair)

// FPairV2.sol:176-181 — balance uses balanceOf, NOT reserves
function balance() public view returns (uint256) {
    return IERC20(tokenA).balanceOf(address(this));
}
function assetBalance() public view returns (uint256) {
    return IERC20(tokenB).balanceOf(address(this));
}
```

### Postcondition Analysis
**Postconditions Created**: Distorted Uniswap V2 initialization price ratio
**Postcondition Types**: [BALANCE, STATE]
**Who Benefits**: Attacker profits from arbitrage on mispriced Uniswap pool

---

## Finding [DE-5]: FRouterV3._calculateAntiSniperTax Reverts for Non-BondingV5 Tokens — Hard DoS

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition)]
**Depth Evidence**: [TRACE:FRouterV3._calculateAntiSniperTax(pair) → L289 tokenAddress=pair.tokenA() → L293 bondingV5.tokenAntiSniperType(tokenAddress) → BondingV5.sol:793 if(tokenInfo[token_].creator==address(0)) revert InvalidTokenStatus() → for any token NOT created by BondingV5: creator is address(0) → REVERT → buy() reverts for ALL non-V5 tokens routed through FRouterV3], [VARIATION:token created by BondingV5 → creator != address(0) → returns antiSniperTaxType → works; token created by BondingV2/V3/V4 → tokenInfo is empty → reverts]

**Severity**: Medium
**Location**: FRouterV3.sol:293, BondingV5.sol:793-798

**Description**: FRouterV3's `_calculateAntiSniperTax()` at L293 calls `bondingV5.tokenAntiSniperType(tokenAddress)`. In BondingV5.sol:793-798, `tokenAntiSniperType()` reverts with `InvalidTokenStatus()` if the token was not created by BondingV5 (i.e., `tokenInfo[token_].creator == address(0)`).

This means if any token pair created by BondingV2/V3/V4 is registered in FFactoryV3 (or if FRouterV3's `bondingV5` reference points to a BondingV5 instance that doesn't know about the token), all buy operations will revert.

The deployment scripts show FRouterV3 has EXECUTOR_ROLE granted to beOpsWallet(s) in addition to BondingV5. If beOpsWallet calls `buy()` directly on FRouterV3 for a non-V5 token, it reverts.

**Impact**: Hard DoS on buy operations for any non-BondingV5 token routed through FRouterV3. This is a migration/operational risk — if tokens from older bonding versions are ever traded through FRouterV3, all buys fail. The sell path also calls `getAmountsOut` but does not call `_calculateAntiSniperTax`, so sells would work.

**Evidence**:
```solidity
// FRouterV3.sol:293 — no try/catch around this call
uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);

// BondingV5.sol:793-798 — reverts for unknown tokens
function tokenAntiSniperType(address token_) external view returns (uint8) {
    if (tokenInfo[token_].creator == address(0)) {
        revert InvalidTokenStatus();
    }
    return tokenLaunchParams[token_].antiSniperTaxType;
}
```

### Precondition Analysis
**Missing Precondition**: Non-V5 token pair must be registered in FFactoryV3
**Precondition Type**: STATE
**Why This Blocks**: Under normal operation, FFactoryV3 only has V5 token pairs. Risk materializes only if pairs are migrated or beOpsWallet misroutes a token.

---

## Finding [DE-6]: setTaxStartTime Silent Failure for Old Pair Contracts — Wrong Anti-Sniper Window

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✓, R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition)]
**Depth Evidence**: [TRACE:FRouterV3.setTaxStartTime(pair, timestamp) → L350 try pair.setTaxStartTime(_taxStartTime) {} catch {} → if pair lacks setTaxStartTime function → catch silently → taxStartTime remains 0 → _getTaxStartTime() at L327 reads pair.startTime() as fallback → if startTime was set at preLaunch but launch happens later → anti-sniper window starts from startTime NOT from launch time → window already partially expired], [VARIATION:startTime=T, launch happens at T+30min → taxStartTime should be T+30min → but old pair: taxStartTime=0 → fallback to startTime=T → 30min of anti-sniper already "elapsed" → for 60s window: window fully expired before launch → zero anti-sniper tax from first buy]

**Severity**: Medium
**Location**: FRouterV3.sol:344-355, FRouterV2.sol:358-369

**Description**: Both FRouterV2 and FRouterV3 use try/catch around `pair.setTaxStartTime()` for backward compatibility. If the pair contract is an older version that doesn't have `setTaxStartTime`, the call silently fails.

For FRouterV3, `_getTaxStartTime()` (L326-338) falls back to `pair.startTime()` when `taxStartTime == 0`. For scheduled launches where `launch()` happens significantly after `startTime`, this means the anti-sniper window starts from pair creation time instead of launch time.

With a 60-second anti-sniper window: if `launch()` happens even 60 seconds after `startTime`, the entire anti-sniper window has already expired by the time the first buy occurs.

**Impact**: Old pair contracts (created before the `setTaxStartTime` feature was added to FPairV2) will have zero or reduced anti-sniper tax on the first buys, even if anti-sniper tax was intended. This allows snipers to buy at launch with no penalty.

However, current FPairV2 in scope DOES have `setTaxStartTime()` — so this affects only pairs created by older factory versions. Operational risk exists if FRouterV3 is used with pairs from FFactoryV2.

**Evidence**:
```solidity
// FRouterV3.sol:344-355
function setTaxStartTime(address pairAddress, uint256 _taxStartTime) public onlyRole(EXECUTOR_ROLE) {
    IFPairV2 pair = IFPairV2(pairAddress);
    try pair.setTaxStartTime(_taxStartTime) {} catch {
        // Old pair contract doesn't have setTaxStartTime function
    }
}

// FRouterV3.sol:326-338 — fallback to startTime
function _getTaxStartTime(IFPairV2 pair) private view returns (uint256) {
    uint256 finalTaxStartTime = pair.startTime();  // fallback
    try pair.taxStartTime() returns (uint256 _taxStartTime) {
        if (_taxStartTime > 0) { finalTaxStartTime = _taxStartTime; }
    } catch {}
    return finalTaxStartTime;
}
```

---

## Finding [DE-7]: Graduation DAO Salt Controlled by Graduating Buyer — Frontrunner Controls DAO Contract Address

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✓, R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition)]
**Depth Evidence**: [TRACE:_openTradingOnUniswap() → L748-756 executeBondingCurveApplicationSalt(... salt=keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress_))) → msg.sender = graduating buyer (whoever calls buy() that triggers graduation) → salt is deterministic given msg.sender + block.timestamp + tokenAddress → attacker can precompute salt and pre-deploy a contract at the CREATE2 address], [VARIATION:msg.sender=attacker vs msg.sender=normalUser → different salt → different DAO address → attacker controls which DAO address is used], [BOUNDARY:attacker precomputes CREATE2 address for their salt → deploys malicious contract at that address before graduation → graduation creates DAO at same address → CREATE2 collision? → actually AgentFactory creates DAO via CREATE2 with salt in _executeApplication → if address already has code → CREATE2 reverts → so attacker pre-deploying BLOCKS graduation → DoS vector]

**Severity**: Medium
**Location**: BondingV5.sol:748-756

**Description**: The graduation salt passed to `executeBondingCurveApplicationSalt()` is `keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress_))`. Since `msg.sender` is the buyer whose transaction triggers graduation, an attacker can:

1. **Monitor**: Watch for tokens approaching graduation threshold
2. **Frontrun**: Submit a buy that triggers graduation, controlling `msg.sender` in the salt
3. **Influence**: The DAO address created via CREATE2 depends on this salt

**Two attack vectors:**

A) **DAO address prediction and pre-deployment (DoS)**: Attacker precomputes the CREATE2 address for their salt and pre-deploys a contract at that address. When graduation tries to CREATE2 the DAO at the same address, it reverts (CREATE2 cannot deploy to an address with existing code). This permanently bricks graduation for that token — a DoS vector that chains with EP-8.

B) **Salt influence (low impact)**: Even without pre-deployment, the attacker controls which DAO address is generated. If the DAO address has governance power, the attacker could select a salt that produces a "favorable" address (no practical impact with random CREATE2 unless there's address-based access control).

Vector A is the more concerning one and chains directly with EP-8 (permanent pool DoS).

**Impact**: An attacker can permanently brick graduation for any token by pre-deploying a contract at the predicted DAO CREATE2 address, causing graduation to always revert. This is a targeted DoS attack with permanent effect on the specific token.

**Evidence**:
```solidity
// BondingV5.sol:748-756
address agentToken = agentFactory.executeBondingCurveApplicationSalt(
    tokenRef.applicationId,
    tokenRef.data.supply / 1 ether,
    tokenBalance / 1 ether,
    pairAddress,
    keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress_))
    //                         ^^^^^^^^^^^ controlled by attacker
);
```

### Postcondition Analysis
**Postconditions Created**: Permanent graduation DoS for targeted token
**Postcondition Types**: [STATE]
**Who Benefits**: Attacker who wants to prevent a specific token from graduating (competitor, short seller)

---

## Finding [DE-8]: Base Sequencer Timestamp — 60s Anti-Sniper Window Has Limited Manipulation Surface

**Verdict**: PARTIAL (downgraded from TE-3)
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition), R16:✗(no oracle)]
**Depth Evidence**: [VARIATION:timestamp skew=0s → anti-sniper tax=99*(60-elapsed)/60; timestamp skew=1s → tax off by 1.65%; timestamp skew=5s → tax off by 8.25%; timestamp skew=12s → tax off by 19.8%], [BOUNDARY:elapsed=58s, tax should be 99*(60-58)/60=3.3% → with +2s manipulation: elapsed=60s, tax=0% → attacker avoids 3.3% tax → on 100 VIRTUAL buy, saves 3.3 VIRTUAL]

**Severity**: Low
**Location**: FRouterV3.sol:310-318

**Description**: Base (OP Stack) uses a centralized sequencer that posts L2 blocks with timestamps. The sequencer has limited ability to set `block.timestamp`:
- L2 blocks must have timestamps >= parent timestamp
- The sequencer batches transactions and sets block timestamps
- In practice, Base sequencer timestamps are within ~1-2 seconds of real time
- Validators on L1 cannot manipulate L2 block timestamps — only the sequencer can

The 60-second anti-sniper window at L310-318 computes `startTax * (duration - timeElapsed) / duration`. With a 60s duration and 99% start tax, each second reduces tax by 1.65%. A +2s timestamp manipulation could save ~3.3% tax.

However, the sequencer is operated by Coinbase (Base's operator) and has no economic incentive to manipulate timestamps for individual token launches. The risk is theoretical — a compromised sequencer could affect anti-sniper tax, but this is equivalent to assuming the entire Base chain is compromised.

**Impact**: Minimal in practice. The Base sequencer timestamp manipulation window is ~1-2s, not the 12s suggested for Ethereum mainnet validators. The maximum tax reduction from realistic manipulation is ~3.3%, which is economically insignificant compared to the 99% starting tax.

---

## Finding [DE-9]: veToken Interface Spoofing in drainUniV2Pool — Mitigated by EXECUTOR_ROLE but No On-Chain Registry Check

**Verdict**: CONFIRMED (mitigated)
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✓, R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition)]
**Depth Evidence**: [TRACE:drainUniV2Pool(agentToken, veToken, recipient, deadline) → L441 lpPair=IAgentVeTokenV2(veToken).assetToken() → L442-448 checks pair.token0/token1 match agentToken and assetToken → L456-458 reads founder and balance from veToken → L465-472 calls agentFactory.removeLpLiquidity(veToken, ...) → veToken is CALLER-SUPPLIED, not registry-validated → attacker-controlled contract implementing IAgentVeTokenV2 could return crafted values], [VARIATION:veToken=real → founder=real, lpPair=real UniV2 pair → works correctly; veToken=attacker contract → assetToken() returns real lpPair address → token0/token1 check passes → founder() returns attacker address → balanceOf(attacker) returns attacker's LP balance → removeLpLiquidity called with attacker's veToken → but AgentFactory.removeLpLiquidity calls veToken.removeLpLiquidity internally → if veToken is fake, it could do anything]

**Severity**: Low (mitigated by EXECUTOR_ROLE trust + REMOVE_LIQUIDITY_ROLE on factory)
**Location**: FRouterV3.sol:422-476, FRouterV2.sol:436-490

**Description**: `drainUniV2Pool()` accepts a caller-supplied `veToken` address. The function verifies that the veToken's LP pair contains the expected tokens (L446-453), but does NOT verify that the veToken is a legitimate AgentVeToken from the protocol's registry.

An attacker who has EXECUTOR_ROLE (compromised beOpsWallet) could pass a malicious contract as `veToken` that:
1. Returns the correct `assetToken()` (LP pair) to pass validation
2. Returns an attacker-controlled `founder()` 
3. Has arbitrary `balanceOf` returning any amount

However, `agentFactory.removeLpLiquidity()` internally calls `IAgentVeTokenV2(veToken).removeLpLiquidity(...)`. If the veToken is a malicious contract, it controls the removeLpLiquidity logic — but this is constrained by:
- The actual Uniswap V2 pair requires LP tokens to burn
- The malicious veToken would need to somehow hold real LP tokens
- AgentFactory has `REMOVE_LIQUIDITY_ROLE` check, limiting callers

The attack requires EXECUTOR_ROLE compromise, which is already a trusted-actor scenario.

**Impact**: In the compromised EXECUTOR_ROLE scenario, a spoofed veToken provides no additional capability beyond what AC-1 (direct graduate() drain) and AC-8 (approval() drain) already provide. The veToken spoofing is redundant with existing EXECUTOR_ROLE abuse vectors.

---

## Finding [DE-10]: Sandwich Attack Surface on FRouter Buy/Sell — No amountOutMin at Protocol Level

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5,6,7
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition), R15:✗(no flash-loan-accessible state)]
**Depth Evidence**: [TRACE:BondingV5.buy(amountIn, token, amountOutMin, deadline) → L641 router.buy(amountIn, token, buyer, isInitialPurchase) → FRouterV3.buy() L221 amountOut=getAmountsOut() → L223 pair.transferTo(to, amountOut) → amountOut is computed from current reserves → BondingV5._buy() L649 checks amount0Out >= amountOutMin → slippage protection EXISTS at BondingV5 level], [TRACE:FRouterV3.buy() L174-228 → no amountOutMin parameter → but BondingV5._buy() L649 checks after router returns → sandwich attacker frontruns: buy large → price moves → victim's buy gets less amountOut → BondingV5 checks amountOutMin → if victim set amountOutMin correctly, sandwich fails → if amountOutMin=0 → victim gets sandwiched]

**Severity**: Low (design-level — slippage protection exists but at BondingV5 level, not router level)
**Location**: FRouterV3.sol:174-228, BondingV5.sol:649

**Description**: FRouterV3's `buy()` function does not accept an `amountOutMin` parameter — it computes and returns the output amount. However, BondingV5's `_buy()` at L649 checks `amount0Out >= amountOutMin_` after the router call returns.

This means slippage protection exists at the BondingV5 level (user specifies `amountOutMin_` when calling `BondingV5.buy()`). The sandwich attack surface depends on:
1. Users setting `amountOutMin_ = 0` (common in frontends that default to 0)
2. MEV bots on Base monitoring the BondingV5 buy transactions

**MEV on Base**: Base uses a centralized sequencer (Coinbase). Currently, Base does not have a public mempool — transactions go directly to the sequencer. This significantly reduces MEV attack surface compared to Ethereum mainnet. However, the sequencer operator (Coinbase) could theoretically extract MEV, and as Base decentralizes, MEV will become more prevalent.

**Graduation frontrunning**: Graduation is NOT independently profitable to frontrun because:
1. Graduation is triggered atomically within a buy transaction
2. The graduating buyer gets tokens at the bonding curve price
3. Post-graduation trading happens on Uniswap V2, not through FRouter
4. An attacker cannot "frontrun graduation" because graduation and the triggering buy are in the same transaction

**Impact**: Low in the current Base environment due to centralized sequencer. Slippage protection exists at BondingV5 level. The main risk is users/frontends setting `amountOutMin=0`.

---

## Finding [DE-11]: Multicall3 aggregate3Value() — No ETH Drain via Delegatecall but Arbitrary Call Execution by Admins

**Verdict**: CONFIRMED (by design — admin-controlled)
**Step Execution**: ✓1,2,3,5
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓]
**Depth Evidence**: [TRACE:aggregate3Value() L239-291 → L255 calli.target.call{value:val}(calli.callData) → uses .call NOT .delegatecall → no storage manipulation → target contract executes in its own context → caller is Multicall3 → if Multicall3 holds ETH: aggregate3Value sends msg.value to calls → L290 require(msg.value == valAccumulator) → total value sent must match → but ETH sent TO Multicall3 outside of aggregate3Value is NOT protected → anyone can send ETH to Multicall3 → admin can drain via aggregate3Value with target=attacker and value=Multicall3.balance]

**Severity**: Low
**Location**: multicall3.sol:239-291

**Description**: `aggregate3Value()` uses `.call{value: val}` (not `.delegatecall`), so there is no storage manipulation or code execution in Multicall3's context. The function checks `msg.value == valAccumulator` at L290, preventing callers from overspending.

However, if ETH is sent to Multicall3 directly (no receive/fallback function visible, but some Solidity versions accept ETH via payable functions), the admin/owner can drain it via a call with `value: contract.balance`.

The real risk is that `aggregate3()` and `aggregate3Value()` allow admins to execute **arbitrary external calls** from the Multicall3 address. If Multicall3 holds any token approvals or has any roles, admins can leverage those. In this protocol, Multicall3 does not hold roles on FFactory/FRouter/BondingV5, so the arbitrary call capability is limited to external interactions.

The `approveToken()` function (PC1-6) allows admins to set arbitrary ERC20 approvals from Multicall3, which could drain any tokens accidentally sent to Multicall3.

**Impact**: Low — Multicall3 is an admin utility contract. Its permissions are intentionally broad for operational flexibility. The ETH/token drain risk applies only to funds accidentally sent to Multicall3.

---

## CALLBACK SELECTIVE REVERT ANALYSIS

| Function | External Target | Outcome Visible Before Callback? | Revert Resets? | Retry Possible? |
|----------|----------------|----------------------------------|----------------|-----------------|
| BondingV5._preLaunch() → agentFactory.createNewAgentTokenAndApplication() | AgentFactory (trusted) | YES (token address determined) | YES (atomic) | NO (single tx) |
| BondingV5._openTradingOnUniswap() → agentFactory.executeBondingCurveApplicationSalt() | AgentFactory (trusted) | YES (graduation amount) | YES (atomic) | NO (buy reverts → DoS) |
| FRouterV3.buy() → IAgentTaxForRouter.depositTax() | AgentTaxV2 (trusted) | YES (tax amount) | YES (atomic) | NO (buy reverts) |
| FRouterV3.drainUniV2Pool() → agentFactory.removeLpLiquidity() | AgentFactory (trusted) | YES (veToken amount) | YES (atomic) | YES (can retry) |

[TRACE:buy() → FRouterV3.buy() → L210 depositTax(tokenAddress, normalTxFee) → callback to AgentTaxV2 → outcome=tax amount → revert resets=YES → retry=NO (buy fails for user) → but AgentTaxV2 is trusted, no selective revert incentive]

No callback selective revert vulnerabilities found. All external call targets are trusted protocol contracts, not user-controlled addresses. The bonding curve pair (FPairV2) only accepts calls from the router (`onlyRouter`), so there is no user-facing callback during trading.

---

## PART 2: COMBINATION DISCOVERY

### Combination 1: EP-7 (founder approval gap) + AC-1 (EXECUTOR graduate())
If EXECUTOR (beOpsWallet) calls `drainUniV2Pool()` without founder pre-approval:
- L466 `agentFactory.removeLpLiquidity()` reverts
- Entire transaction reverts
- No partial drain occurs
- [TRACE: drainUniV2Pool → removeLpLiquidity → veToken.removeLpLiquidity → transferFrom(founder, ...) → revert "ERC20: insufficient allowance"]
**Result**: Clean revert, no state corruption. AC-1's graduate() drain is a separate vector that doesn't involve drainUniV2Pool.

### Combination 2: EP-8 (graduation DoS) + EP-1/EP-2/EP-3 (return value non-validation)
As shown in DE-2, AgentFactory always reverts on failure — it does not return zero addresses. So return value non-validation cannot cause state corruption. The EP-8 DoS scenario comes from AgentFactory being paused or role-revoked, not from it returning bad values.
**Result**: No additional attack vector. EP-8 stands on its own.

### Combination 3: RS3-3 (DAO salt control) + EP-14 (sequential AgentFactory calls)
If attacker controls DAO address (by controlling the graduating buy's msg.sender):
- They can precompute the CREATE2 DAO address
- If they pre-deploy at that address → graduation reverts at executeBondingCurveApplicationSalt
- This chains with EP-14: the first 3 calls succeed but the 4th (executeBondingCurveApplicationSalt) reverts
- Due to EVM atomicity, the entire _openTradingOnUniswap() reverts
- But since graduation check still passes on subsequent buys, every future buy also reverts
- **Result**: PERMANENT DoS for the specific token — chains DE-7 + EP-8 + EP-14 into a targeted attack
- **Severity**: High (attacker can permanently brick any specific token at low cost)

[CROSS-DOMAIN-DEP: token-flow — graduation trigger condition in _buy() has no escape hatch; if _openTradingOnUniswap always reverts, token is permanently stuck]

---

## PART 3: SECOND OPINION ON REFUTED

### TF-8 (CONTESTED — production AgentToken behavior)

Evidence from external_production_behavior.md:
- MockAgentToken has NO transfer tax, NO blacklist enforcement beyond manual mapping, NO valid caller restrictions
- Real AgentToken has: blacklist, tax-on-transfer, swap threshold, valid caller checks
- The self-transfer at BondingV5.sol:746 (`IERC20(tokenAddress_).safeTransfer(tokenAddress_, tokenBalance)`) sends agent tokens TO the agent token contract itself

Three possible outcomes:
1. **Token rejects self-transfer**: If AgentToken has a check preventing transfers to itself → revert → graduation permanently bricked (chains with EP-8)
2. **Token applies transfer tax**: Tax reduces delivered amount → `lpSupply` in `executeBondingCurveApplicationSalt` is inflated vs actual tokens → Uniswap pool under-collateralized (chains with TF-3/EP-10)
3. **Token auto-swaps on receipt**: If accumulated taxes trigger auto-swap → unexpected Uniswap interaction → could interfere with graduation flow

Without access to production AgentToken source, verdict remains **CONTESTED**. However, the mock contract analysis confirms that tests completely mask this behavior. The production risk is real and unverifiable from the codebase alone.

**Recommendation**: Verdict stays CONTESTED until production AgentToken source is reviewed. The self-transfer pattern at L746 should be replaced with a direct mechanism that doesn't require sending tokens to the token contract itself.

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|------------|----------|---------------------|---------|----------|-------------------|--------------------|
| DE-1 | FRouterV3.sol:466, FRouterV2.sol:480 | No protocol flow creates founder veToken approval for drainUniV2Pool | CONFIRMED | High | MISSING_APPROVAL | FUNCTION_NOOP |
| DE-2 | BondingV5.sol:331-352, 748-756 | AgentFactory reverts on failure — return value check is defense-in-depth only | PARTIAL | Medium | EXTERNAL_FAILURE | DEFENSE_IN_DEPTH |
| DE-3 | BondingV5.sol:703-772 | 4 sequential BONDING_ROLE calls at graduation — role revocation bricks all | CONFIRMED | Critical | ROLE_REVOCATION | PERMANENT_DOS |
| DE-4 | BondingV5.sol:718-719 | Graduation reads balanceOf (includes donations) — distorts Uniswap initialization | CONFIRMED | Medium | UNSOLICITED_TRANSFER | POOL_RATIO_DISTORTION |
| DE-5 | FRouterV3.sol:293, BondingV5.sol:793-798 | tokenAntiSniperType reverts for non-V5 tokens — hard DoS on buy | CONFIRMED | Medium | MISCONFIGURATION | DOS |
| DE-6 | FRouterV3.sol:344-355 | setTaxStartTime silent failure for old pairs — wrong anti-sniper window | CONFIRMED | Medium | SILENT_FAILURE | WRONG_TAX_WINDOW |
| DE-7 | BondingV5.sol:748-756 | Graduation salt controlled by msg.sender — CREATE2 address pre-deployment DoS | CONFIRMED | Medium | UNSOLICITED | GRADUATION_DOS |
| DE-8 | FRouterV3.sol:310-318 | Base sequencer timestamp has ~1-2s manipulation window — limited anti-sniper impact | PARTIAL | Low | EXTERNAL | TAX_BYPASS |
| DE-9 | FRouterV3.sol:422-476 | veToken interface spoofing — mitigated by EXECUTOR_ROLE trust boundary | CONFIRMED | Low | INTERFACE_SPOOF | MITIGATED |
| DE-10 | FRouterV3.sol:174-228, BondingV5.sol:649 | No amountOutMin at router level — BondingV5 level check exists | CONFIRMED | Low | DESIGN | MITIGATED |
| DE-11 | multicall3.sol:239-291 | aggregate3Value uses .call not .delegatecall — admin-only arbitrary calls | CONFIRMED | Low | ACCESS | ADMIN_ONLY |
