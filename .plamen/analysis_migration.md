# Migration & Version Compatibility Analysis

**Agent**: B3 - Migration Analysis
**Scope**: contracts/launchpadv2/ (BondingV2-V5, FRouterV2-V3, FFactoryV2-V3, BondingConfig)
**Step Execution**: checkmark1,2,3,3b,3c,4a,4b,4c,4d,4e,4f,5,6

---

## Step 1: Token Transitions

This protocol does NOT migrate token types (no old ERC20 replaced by new ERC20). Instead, the migration involves **contract logic versions** serving the same underlying asset tokens (VIRTUAL as assetToken, agent tokens as bonding curve tokens). The "transition" is:

| Old Contract | New Contract | Migration Path | Bidirectional? |
|---|---|---|---|
| BondingV2 | BondingV5 | No migration function; V2 pairs remain on V2, new pairs on V5 | No |
| BondingV3 | BondingV5 | No migration function; V3 pairs remain on V3, new pairs on V5 | No |
| BondingV4 | BondingV5 | No migration function; V4 pairs remain on V4, new pairs on V5 | No |
| FRouterV2 | FRouterV3 | Separate deployment; V2 serves V2/V3/V4 bonding, V3 serves V5 | No |
| FFactoryV2 | FFactoryV3 | Separate deployment; V2 creates pairs for V2/V3/V4, V3 for V5 | No |

**Key observation**: There is NO migration of existing positions. V2/V3/V4 pairs with active funds remain serviced by V2-era contracts indefinitely.

## Step 2: Interface Compatibility

| External Call | Caller Expects | Callee Provides | Match? |
|---|---|---|---|
| BondingV2.buy() -> FRouterV2.buy() | (uint256, uint256) | (uint256, uint256) | YES |
| BondingV5.buy() -> FRouterV3.buy() | (uint256, uint256) | (uint256, uint256) | YES |
| FRouterV3._calculateAntiSniperTax() -> bondingV5.tokenAntiSniperType() | uint8 | uint8 (or revert) | PARTIAL - see [MG-1] |
| BondingV5._preLaunch() -> bondingConfig.calculateBondingCurveSupply() | uint256 | uint256 | YES |
| BondingV5.launch() -> bondingConfig.teamTokenReservedWallet() | address | address | YES - but can change mid-flight, see [MG-4] |

## Step 3: Token Flow Paths

| Function | User Provides | Protocol Tracks | External Expects | Mismatch? |
|---|---|---|---|---|
| BondingV2.buy() | VIRTUAL (assetToken) | tokenInfo[token] in V2 | FRouterV2 (VIRTUAL) | No |
| BondingV5.buy() | VIRTUAL (assetToken) | tokenInfo[token] in V5 | FRouterV3 (VIRTUAL) | No |
| BondingV2.sell() | agentToken | tokenInfo[token] in V2 | FRouterV2 (agentToken) | No |
| BondingV5.sell() | agentToken | tokenInfo[token] in V5 | FRouterV3 (agentToken) | No |
| BondingV5._preLaunch() | VIRTUAL | bondingConfig state | BondingConfig (reads params) | No - but config can change, see [MG-3] |

### Step 3b: External Side Effect Token Compatibility

| External Call | Pre-Migration Side Effect | Post-Migration Side Effect | Logic Handles Both? | Mismatch? |
|---|---|---|---|---|
| FRouterV2.sell() tax -> factory.taxVault() | Direct transfer to taxVault | Direct transfer to taxVault | YES | No |
| FRouterV3.sell() tax -> IAgentTaxForRouter.depositTax() | N/A (new) | Routed through depositTax with attribution | N/A | No - new flow only for V5 tokens |
| FRouterV3.buy() tax -> IAgentTaxForRouter.depositTax() | N/A (new) | Routed through depositTax with attribution | N/A | No |

V3 router uses `depositTax()` for on-chain attribution whereas V2 router does direct transfer. These are separate deployments so no conflict.

### Step 3c: Pre-Upgrade Balance Inventory

| Asset Type | How It Arrived | Post-Upgrade Logic Handles? | Exit Path Post-Upgrade? |
|---|---|---|---|
| VIRTUAL in BondingV2 contract | initialPurchase deposits (pre-launch) | YES - launch()/cancelLaunch() still work | launch() or cancelLaunch() |
| VIRTUAL in FPairV2 (V2 factory) | buy() deposits from users | YES - sell()/graduate() via FRouterV2 | sell() via BondingV2 or graduation |
| AgentTokens in FPairV2 | addInitialLiquidity | YES - buy()/graduate() via FRouterV2 | buy() via BondingV2 or graduation |
| VIRTUAL in BondingV5 contract | initialPurchase deposits | YES - launch()/cancelLaunch() | launch() or cancelLaunch() |
| AgentTokens in FPairV2 (V3 factory) | addInitialLiquidity via V5 | YES - buy()/graduate() via FRouterV3 | buy() via BondingV5 or graduation |

---

## Step 4: Stranded Asset Analysis

### 4a: Asset Inventory by Era

| Asset | V2/V3/V4 Entry Path | V5 Entry Path | V2/V3/V4 Exit Path | V5 Exit Path |
|---|---|---|---|---|
| VIRTUAL (initialPurchase) | preLaunch() [REVERTS] | preLaunch() | launch()/cancelLaunch() | launch()/cancelLaunch() |
| VIRTUAL (in pair) | buy() deposits | buy() deposits | sell()/graduate() | sell()/graduate() |
| AgentTokens (in pair) | addInitialLiquidity() | addInitialLiquidity() | buy()/graduate() | buy()/graduate() |
| AgentTokens (reserved) | Sent to teamTokenReservedWallet | Sent to bondingConfig.teamTokenReservedWallet() | N/A (already transferred out) | N/A |

### 4b: Cross-Era Path Matrix

| Asset Era | State Condition | Available Exit Paths | Works? | Reason |
|---|---|---|---|---|
| V2 VIRTUAL (pre-launch deposit) | V2 still deployed | cancelLaunch() / launch() | YES | V2 buy/sell/launch/cancel still function |
| V2 pair VIRTUAL | Active trading | sell() via BondingV2 -> FRouterV2 | YES | FRouterV2 remains operational |
| V2 pair VIRTUAL | FRouterV2 proxy upgraded | sell() via BondingV2 -> FRouterV2 | DEPENDS | See [MG-2] - depends on upgrade preserving interface |
| V4 pair VIRTUAL | V4 still deployed, active | sell() via BondingV4 -> FRouterV2 | YES | Same as V2 |
| V5 pair VIRTUAL | BondingConfig swapped | sell() via BondingV5 -> FRouterV3 | YES | sell() does not read BondingConfig |
| V5 pair (pre-grad) | BondingConfig.gradThreshold changes | graduation via _buy() | PARTIAL | See [MG-3] - per-token threshold is frozen at creation, so existing tokens unaffected |

### 4c: Recovery Function Inventory

| Function | Who Can Call | What Assets Can Recover | Limitations |
|---|---|---|---|
| BondingV2.cancelLaunch() | Token creator only | initialPurchase VIRTUAL | Only pre-launch, not launched tokens |
| BondingV5.cancelLaunch() | Token creator only | initialPurchase VIRTUAL | Only pre-launch tokens |
| FRouterV2.drainPrivatePool() | EXECUTOR_ROLE | All pair assets | Only for isProject60days tokens |
| FRouterV3.drainPrivatePool() | EXECUTOR_ROLE | All pair assets | Only for isProject60days tokens (via BondingV5) |
| FRouterV2.drainUniV2Pool() | EXECUTOR_ROLE | Graduated LP liquidity | Only for isProject60days tokens |
| No general sweep/rescue | N/A | N/A | No emergency withdrawal for arbitrary ERC20 sent to contracts |

**Gap**: There is no general `emergencyWithdraw()` or `sweep()` function on any bonding contract. If tokens are accidentally sent to BondingV2/V5, they are permanently stranded unless the token is isProject60days.

### 4d: Worst-Case Scenarios

**Scenario 1: V2 Pair Active + FRouterV2 Proxy Upgrade**
```
State: User holds agentTokens purchased via BondingV2.buy() on a live V2 pair
Event: FRouterV2 proxy implementation is upgraded
Question: Can user still sell via BondingV2.sell()?
Trace: BondingV2.sell() -> router.sell() -> FRouterV2(proxy).sell()
  - FRouterV2 is behind a proxy (Initializable + AccessControlUpgradeable)
  - If new implementation preserves EXECUTOR_ROLE grants and sell() interface: SUCCESS
  - If new implementation changes storage layout or removes sell(): STRANDED
Result: CONDITIONAL on upgrade preserving interface and role grants
```

**Scenario 2: BondingConfig Swap During Active V5 Bonding Curve**
```
State: Token T created via BondingV5._preLaunch() with gradThreshold stored in tokenGradThreshold[T]
Event: Owner calls BondingV5.setBondingConfig(newConfig)
Question: Does existing token T's graduation behavior change?
Trace: BondingV5._buy() reads tokenGradThreshold[tokenAddress_] (line 662)
  - This is a per-token mapping set at creation time (line 393)
  - NOT read from BondingConfig at buy/sell time
Result: SUCCESS - existing tokens are NOT affected by config swap for gradThreshold
  However: launch() reads bondingConfig.teamTokenReservedWallet() at execution time (line 557)
  So the teamTokenReservedWallet CAN change between preLaunch and launch. See [MG-4]
```

**Scenario 3: FRouterV3 Anti-Sniper Tax for Non-V5 Token**
```
State: A token was created by BondingV4 and somehow its pair is registered in FFactoryV3
  (or FRouterV3.bondingV5.tokenAntiSniperType() is called for a non-V5 token)
Event: FRouterV3._calculateAntiSniperTax() is called during a buy
Trace: FRouterV3._calculateAntiSniperTax() (line 293):
  uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);
  -> BondingV5.tokenAntiSniperType() checks tokenInfo[token_].creator == address(0) -> reverts
Result: BUY REVERTS - complete DoS. See [MG-1]
```

### 4e: Step 4 Completion Checklist

- [x] 4a: ALL assets inventoried with entry/exit paths per era
- [x] 4b: Cross-era path matrix completed for all state combinations
- [x] 4c: Recovery functions enumerated with limitations
- [x] 4d: All three worst-case scenarios modeled with code traces
- [x] For EVERY stranding possibility: recovery path exists OR finding created

**Step Execution Output**: checkmark4a,4b,4c,4d,4e

---

## Findings

---

## Finding [MG-1]: FRouterV3 Anti-Sniper Tax Reverts for Non-BondingV5 Tokens (Hard DoS)

**Verdict**: CONFIRMED
**Step Execution**: checkmark1,2,3,4,5
**Severity**: Medium
**Location**: FRouterV3.sol:293, BondingV5.sol:793-798

**Token Transition**:
- Old: Tokens created by BondingV2/V3/V4 (registered in their own tokenInfo mappings)
- New: Tokens created by BondingV5 (registered in BondingV5.tokenInfo)
- Mismatch Point: FRouterV3._calculateAntiSniperTax() unconditionally calls bondingV5.tokenAntiSniperType() which reverts for tokens not in BondingV5's registry

**Description**: FRouterV3._calculateAntiSniperTax() at line 293 calls `bondingV5.tokenAntiSniperType(tokenAddress)` without a try/catch. In BondingV5.tokenAntiSniperType() (line 793-798), if `tokenInfo[token_].creator == address(0)`, it reverts with `InvalidTokenStatus()`. Any token not created through BondingV5 will have creator == address(0) in BondingV5's mapping.

If a non-V5 token's pair somehow ends up being queried through FRouterV3 (e.g., manual EXECUTOR_ROLE call, or if FFactoryV3's router is misconfigured), all buy() calls will revert because _calculateAntiSniperTax is called unconditionally for non-initial purchases.

**Impact**: Complete DoS on buy operations for any non-V5 token routed through FRouterV3. Users cannot purchase tokens, and if the bonding curve is near graduation threshold, existing holders cannot trigger graduation either.

**Evidence**:
```solidity
// FRouterV3.sol:293 - no try/catch
uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);

// BondingV5.sol:793-798 - reverts for unknown tokens
function tokenAntiSniperType(address token_) external view returns (uint8) {
    if (tokenInfo[token_].creator == address(0)) {
        revert InvalidTokenStatus();
    }
    return tokenLaunchParams[token_].antiSniperTaxType;
}
```

**Mitigating factors**: In normal operation, V5 tokens use FFactoryV3 (separate factory) and V2/V3/V4 tokens use FFactoryV2. The factories are separate deployments, so cross-contamination requires misconfiguration. However, the FRouterV3 comment at line 277-280 explicitly mentions "BondingV4 X_LAUNCH tokens" and "Legacy tokens" suggesting it was designed to handle older tokens, yet it lacks the fallback logic that FRouterV2 has.

### Postcondition Analysis
**Postconditions Created**: Buy transactions revert; tokens stuck in bonding curve
**Postcondition Types**: DOS, STRANDED_ASSETS

---

## Finding [MG-2]: FRouterV2 Deprecated Storage Slots (taxManager, antiSniperTaxManager) Must Be Preserved on Proxy Upgrade

**Verdict**: CONFIRMED
**Step Execution**: checkmark1,2,3,4
**Severity**: Medium
**Location**: FRouterV2.sol:40-41

**Description**: FRouterV2 declares two deprecated storage fields at specific slots:

```solidity
address public taxManager; // deprecated - slot after assetToken
address public antiSniperTaxManager; // deprecated - slot after taxManager
```

These occupy storage slots 4 and 5 (approximately, after Initializable gap, AccessControl gap, ReentrancyGuard gap, factory, assetToken). The field `bondingV2` follows at slot 6, and `bondingV4` was added later.

If FRouterV2's proxy implementation is ever upgraded to a new contract that does NOT declare these fields in the same slot positions, the `bondingV2` and `bondingV4` references (and any subsequent fields) will be read from the wrong storage slots. This would cause:
1. `bondingV2` to read the old `antiSniperTaxManager` value (wrong address)
2. `bondingV4` to read from a shifted slot
3. All `drainPrivatePool()` and `drainUniV2Pool()` calls to fail or target wrong contracts
4. `_calculateAntiSniperTax()` X_LAUNCH checks to read wrong bondingV4 address

**Impact**: If FRouterV2 is upgraded without preserving deprecated slot layout, all active V2/V3/V4 pairs would have broken drain functions and potentially broken anti-sniper tax calculations. Users in V2-era pairs could be unable to exit positions if the upgrade breaks sell() flow.

**Evidence**: The fields are declared sequentially:
```solidity
FFactoryV2 public factory;          // slot N
address public assetToken;           // slot N+1
address public taxManager;           // slot N+2 (deprecated)
address public antiSniperTaxManager; // slot N+3 (deprecated)
IBondingV2ForRouter public bondingV2; // slot N+4
// ... later added:
IBondingV4ForRouter public bondingV4; // slot N+5
```

The deprecated fields are still settable via `setTaxManager()` and `setAntiSniperTaxManager()` (both ADMIN_ROLE gated). The commented-out code blocks in buy/sell reference them, confirming they were once active.

### Postcondition Analysis
**Postconditions Created**: Storage corruption on upgrade; wrong contract references
**Postcondition Types**: STORAGE_CORRUPTION, DOS

---

## Finding [MG-3]: setBondingConfig() Mid-Launch - Graduation Threshold Safe, But Fee/Supply Parameters Affect New Launches

**Verdict**: PARTIAL
**Step Execution**: checkmark1,2,3,4
**Severity**: Low
**Location**: BondingV5.sol:857-859, BondingV5.sol:390-393

**Description**: The owner can call `BondingV5.setBondingConfig(newConfig)` at any time. Analysis of impact on existing tokens:

1. **gradThreshold**: SAFE. Per-token graduation threshold is stored in `tokenGradThreshold[token]` mapping at creation time (line 393) and read from this mapping in `_buy()` (line 662). Config swap does NOT retroactively change existing tokens' thresholds.

2. **teamTokenReservedWallet**: UNSAFE between preLaunch and launch. See [MG-4].

3. **initialSupply, fakeInitialVirtualLiq, targetRealVirtual**: Only affect NEW token launches (read during _preLaunch). Safe for existing tokens.

4. **Fees**: `calculateLaunchFee()` is only called during `_preLaunch()`. Safe for already-launched tokens.

**Impact**: The concern about "90% funded bonding curve suddenly graduates or can never graduate" is REFUTED for existing tokens. Per-token threshold freezing at creation effectively isolates active curves from config changes. However, if `setBondingConfig()` points to a malicious contract, new preLaunches could have zero gradThreshold (instant graduation) or MAX_UINT (never graduates).

### Precondition Analysis (PARTIAL)
**Missing Precondition**: Only owner can call setBondingConfig; requires malicious/compromised owner
**Precondition Type**: ACCESS

---

## Finding [MG-4]: teamTokenReservedWallet Can Change Between preLaunch() and launch() - Creator's Initial Purchase Tokens Sent to Different Wallet

**Verdict**: CONFIRMED
**Step Execution**: checkmark1,2,3,4
**Severity**: Medium
**Location**: BondingV5.sol:554-558, BondingConfig.sol:250-253

**Description**: In BondingV5, the `teamTokenReservedWallet` is read from `bondingConfig` at two different times:

1. During `_preLaunch()` (line 383-387): Reserved tokens (airdrop + ACF supply) are sent to `bondingConfig.teamTokenReservedWallet()`.
2. During `launch()` (line 554-558): Creator's `initialPurchase` bought tokens are sent to `bondingConfig.teamTokenReservedWallet()`.

Between these two calls, the owner can:
- Call `bondingConfig.setTeamTokenReservedWallet(newWallet)` to change the destination
- Call `bondingV5.setBondingConfig(newConfigContract)` to swap the entire config (which may have a different wallet)

This means the reserved supply and the initial purchase tokens could end up in DIFFERENT wallets, breaking the backend's assumption that they arrive at the same destination for splitting.

**Impact**: Token creator's initialPurchase tokens go to a wallet different from where the reserved supply was sent. The backend "splitting" logic (mentioned in comments) would fail because it expects both at the same wallet. This is an admin-trust issue but could affect token creators who have no control over the wallet change timing.

**Evidence**:
```solidity
// _preLaunch() - reads wallet at time T1
IERC20(token).safeTransfer(
    bondingConfig.teamTokenReservedWallet(), // wallet A at time T1
    totalReservedSupply * (10 ** IAgentTokenV2(token).decimals())
);

// launch() - reads wallet at time T2 (could be different)
IERC20(tokenAddress_).safeTransfer(
    bondingConfig.teamTokenReservedWallet(), // wallet B at time T2?
    amountOut
);
```

Contrast with BondingV2 which reads `launchParams.teamTokenReservedWallet` (a storage variable on the bonding contract itself, not an external contract).

### Postcondition Analysis
**Postconditions Created**: Split token destinations; backend accounting failure
**Postcondition Types**: ACCOUNTING_ERROR

---

## Finding [MG-5]: BondingConfig.initialize() Uses `initializer` - No Reinitializer Attack on Deployed Proxy

**Verdict**: REFUTED
**Step Execution**: checkmark1,2,3
**Severity**: Info
**Location**: BondingConfig.sol:138-149

**Description**: BondingConfig.initialize() uses the `initializer` modifier (not `reinitializer(N)`). The constructor calls `_disableInitializers()` which prevents initialization on the implementation contract. On the proxy, `initializer` can only be called once due to OpenZeppelin's Initializable pattern.

There is no `reinitializer` usage anywhere in BondingConfig, so there is no reinitializer attack surface. The `initializer` modifier sets the initialized version to 1 and cannot be called again.

**However**: If BondingConfig is deployed as a standalone contract (not behind a proxy), the constructor's `_disableInitializers()` prevents `initialize()` from ever being called. If deployed behind a proxy, initialization is one-time only. Both paths are safe.

### Precondition Analysis (REFUTED)
**Missing Precondition**: OpenZeppelin's Initializable correctly prevents re-initialization
**Precondition Type**: STATE

---

## Finding [MG-6]: V2/V3/V4 Bonding Contracts Have No General Asset Recovery - Pre-Launch Deposits Can Only Exit via cancelLaunch()

**Verdict**: CONFIRMED
**Step Execution**: checkmark1,2,3,4a,4b,4c
**Severity**: Low
**Location**: BondingV2.sol (entire contract), BondingV3.sol, BondingV4.sol

**Description**: BondingV2/V3/V4 have `_preLaunch()` that always reverts with "Not implemented", meaning no NEW pairs can be created. However, pairs that were created before the deprecation still hold funds and have active trading.

For these existing pairs:
- **buy()**: Still works (checks `tokenInfo[token].trading` and `launchExecuted`)
- **sell()**: Still works (same checks)
- **launch()**: Still works for pre-launched but not-yet-launched tokens
- **cancelLaunch()**: Still works for pre-launched, not-yet-launched tokens
- **_openTradingOnUniswap()** (graduation): Still works when gradThreshold is met

There is NO `emergencyWithdraw()`, `sweep()`, or `rescueTokens()` function on any V2/V3/V4 bonding contract. If a token's bonding curve is in a state where:
1. It has been launched (`launchExecuted = true`)
2. It has NOT graduated (`trading = true`, `tradingOnUniswap = false`)
3. All users have sold, leaving dust amounts in the pair that can never trigger graduation

Then that dust is permanently stranded in the pair contract. The only recovery path is `drainPrivatePool()` on FRouterV2, which is restricted to `isProject60days` tokens only.

**Impact**: Small amounts of VIRTUAL and agentTokens can be permanently locked in pairs that will never graduate. For non-Project60days tokens, there is no admin recovery mechanism.

### Postcondition Analysis
**Postconditions Created**: Permanently locked dust in bonding curve pairs
**Postcondition Types**: STRANDED_ASSETS

---

## Finding [MG-7]: BondingV2/V5 Storage Layout Discontinuity - V5 Is a Completely New Deployment, Not a Proxy Upgrade of V2

**Verdict**: REFUTED (as a bug) / CONFIRMED (as architectural observation)
**Step Execution**: checkmark1,2,3,4
**Severity**: Info
**Location**: BondingV2.sol, BondingV5.sol

**Description**: BondingV5 is NOT a proxy upgrade of BondingV2. They are separate proxy deployments. Storage layout comparison:

**BondingV2 storage layout** (after OZ gaps):
```
slot: _feeTo (address)
slot: factory (FFactoryV2)
slot: router (FRouterV2)
slot: initialSupply (uint256)
slot: fee (uint256)
slot: assetRate (uint256)
slot: gradThreshold (uint256)
slot: maxTx (uint256)
slot: agentFactory (address)
slot: _deployParams (DeployParams struct)
slot: tokenInfo (mapping)
slot: tokenInfos (address[])
slot: launchParams (LaunchParams struct)
slot: isProject60days (mapping)
slot: project60daysLaunchFee (uint256)
```

**BondingV5 storage layout** (after OZ gaps):
```
slot: factory (IFFactoryV2Minimal)
slot: router (IFRouterV3Minimal)
slot: agentFactory (IAgentFactoryV7Minimal)
slot: bondingConfig (BondingConfig)
slot: tokenInfo (mapping)  -- uses BondingConfig.Token, NOT BondingV2.Token
slot: tokenInfos (address[])
slot: tokenLaunchParams (mapping)
slot: tokenGradThreshold (mapping)
slot: isFeeDelegation (mapping)
```

These are completely different layouts. V5 drops `_feeTo`, `fee`, `K`, `assetRate`, `gradThreshold`, `maxTx`, `_deployParams`, `launchParams`, `isProject60days`, `project60daysLaunchFee` and adds `bondingConfig`, `tokenLaunchParams`, `tokenGradThreshold`, `isFeeDelegation`.

**Impact**: Since V5 is a separate proxy, there is no storage collision risk. However, this means V2 and V5 have completely independent token registries. A token created on V2 does NOT exist in V5's tokenInfo and vice versa. This is by design but reinforces that cross-version queries (like FRouterV3 calling bondingV5.tokenAntiSniperType for a V4 token) will fail.

---

## Finding [MG-8]: BondingV5 Contract Size Exceeds EIP-170 Limit (28,310 > 24,576 bytes)

**Verdict**: CONFIRMED
**Step Execution**: checkmark1
**Severity**: Medium
**Location**: BondingV5.sol (entire contract)

**Description**: As noted in the protocol context, BondingV5 is 28,310 bytes, exceeding the EIP-170 limit of 24,576 bytes. This requires the Solidity optimizer to be enabled with aggressive settings to deploy on mainnet. The contract already uses minimal interfaces (IFFactoryV2Minimal, IFRouterV3Minimal, IAgentFactoryV7Minimal) to reduce size, suggesting this is a known issue being actively managed.

**Impact**: If optimizer settings change or new features are added, the contract may become undeployable. This is a deployment risk, not a runtime security issue. However, if the contract is already deployed behind a proxy and needs to be upgraded with a larger implementation, the upgrade would fail.

---

## Step 4f: User-Blocks-Admin Scenarios

| Admin/Migration Function | Precondition Required | User Action That Blocks It | Timing Window | Severity |
|---|---|---|---|---|
| BondingV5.setBondingConfig() | None (onlyOwner) | None - owner can always call | N/A | N/A |
| FRouterV2.drainPrivatePool() | isProject60days(token) = true | None - user cannot change this flag | N/A | N/A |
| BondingV2.cancelLaunch() | !launchExecuted | Any user calling launch() first | Between pair.startTime() and admin action | Low |

No significant user-blocks-admin scenarios found. Admin functions have no user-controllable preconditions that could create permanent blocking.

---

## Step 5: External Call Token Verification

| External Contract | Function | Protocol Sends | Contract Expects | Match? |
|---|---|---|---|---|
| IFPairV2 | swap/transferAsset/transferTo | VIRTUAL / agentToken | Same | YES |
| IAgentFactoryV7Minimal | createNewAgentTokenAndApplication | encoded params | Same interface | YES |
| IAgentFactoryV7Minimal | executeBondingCurveApplicationSalt | applicationId, supply params | Same | YES |
| IAgentTaxMinimal | registerToken | token, creator, creator | address, address, address | YES |
| IAgentTaxForRouter | depositTax | tokenAddress, amount | address, uint256 | YES |
| BondingConfig | calculateBondingCurveSupply | airdropBips, needAcf | uint16, bool | YES |

All external interfaces match. No token type mismatches detected.

---

## Step 6: Downstream Integration Compatibility

| Protocol Change | Downstream Consumer | Expected Interface | Actual Post-Migration | Breaking? |
|---|---|---|---|---|
| BondingV5 uses different event signatures (PreLaunched has LaunchParams) | Indexers/subgraphs | BondingV2.PreLaunched(token,pair,uint,uint256) | BondingV5.PreLaunched(token,pair,uint256,uint256,LaunchParams) | YES - different event signatures |
| BondingV5 uses different event signatures (Launched has LaunchParams) | Indexers/subgraphs | BondingV2.Launched(token,pair,uint,uint256,uint256) | BondingV5.Launched(token,pair,uint256,uint256,uint256,LaunchParams) | YES - different event signatures |
| FRouterV3 tax routing via depositTax() | Tax accounting systems | Direct transfer to taxVault | Routed through AgentTax.depositTax() | YES - different flow |
| BondingV5 VirtualIdBase = 50B vs V2=20B, V3=30B, V4=40B | Backend/frontend ID routing | contiguous IDs | Separate ID ranges | NO - by design |
| FFactoryV3 is separate from FFactoryV2 | Frontend pair lookup | Query single factory | Must query correct factory per version | YES - frontend must be version-aware |

Event signature changes are the most impactful downstream breaking change. Indexers monitoring BondingV2-style events will not capture BondingV5 events and vice versa. This requires subgraph updates for V5 deployment.

---

## Summary of Findings

| ID | Title | Severity | Verdict |
|---|---|---|---|
| [MG-1] | FRouterV3 anti-sniper reverts for non-V5 tokens | Medium | CONFIRMED |
| [MG-2] | FRouterV2 deprecated storage slots must be preserved on proxy upgrade | Medium | CONFIRMED |
| [MG-3] | setBondingConfig() mid-launch - gradThreshold safe, fee/supply affect new launches only | Low | PARTIAL |
| [MG-4] | teamTokenReservedWallet can change between preLaunch and launch | Medium | CONFIRMED |
| [MG-5] | BondingConfig.initialize() - no reinitializer vulnerability | Info | REFUTED |
| [MG-6] | V2/V3/V4 have no general asset recovery for stranded dust | Low | CONFIRMED |
| [MG-7] | V2 vs V5 storage layout discontinuity (separate deployments, by design) | Info | REFUTED as bug |
| [MG-8] | BondingV5 exceeds EIP-170 contract size limit | Medium | CONFIRMED |
