# Access Control & Semi-Trusted Role Analysis

**Agent**: Analysis Agent B2
**Date**: 2026-04-02
**Scope**: contracts/launchpadv2/ (BondingV5, BondingConfig, FRouterV2/V3, FFactoryV2/V3, FPairV2)
**Methodology**: SKILL semi-trusted-roles applied to EXECUTOR_ROLE, ADMIN_ROLE, Owner, privilegedLauncher

---

## Step 1: Inventory Role Permissions

### EXECUTOR_ROLE (FRouterV2/V3)
Holders: BondingV5 (contract), beOpsWallet (EOA)

| Function | State Modified | External Calls | Parameters |
|----------|---------------|----------------|------------|
| `buy()` | Pair reserves, token balances, tax vaults | safeTransferFrom(user), pair.swap(), pair.transferTo() | amountIn, tokenAddress, to, isInitialPurchase |
| `sell()` | Pair reserves, token balances, tax vaults | safeTransferFrom(user), pair.swap(), pair.transferAsset() | amountIn, tokenAddress, to |
| `graduate()` | Pair drained, assets to msg.sender | pair.transferAsset(), pair.transferTo() | tokenAddress |
| `addInitialLiquidity()` | Pair reserves (mint), K value | safeTransferFrom(msg.sender), pair.mint() | token_, amountToken_, amountAsset_ |
| `approval()` | Token approvals on pair | pair.approval() | pair, asset, spender, amount |
| `resetTime()` | Pair startTime | pair.resetTime() | tokenAddress, newStartTime |
| `setTaxStartTime()` | Pair taxStartTime | pair.setTaxStartTime() | pairAddress, _taxStartTime |
| `drainPrivatePool()` | Pair drained, reserves synced | pair.transferAsset/To(), pair.syncAfterDrain() | tokenAddress, recipient |
| `drainUniV2Pool()` | UniV2 LP removed | agentFactory.removeLpLiquidity() | agentToken, veToken, recipient, deadline |

### ADMIN_ROLE (FFactoryV2/V3)
| Function | State Modified | Parameters |
|----------|---------------|------------|
| `setTaxParams()` | taxVault, buyTax, sellTax, antiSniperBuyTaxStartValue, antiSniperTaxVault | All 5 params, no upper bound validation on tax values |
| `setRouter()` | router address | router_ (no zero-address check) |

### ADMIN_ROLE (FRouterV2/V3)
| Function | State Modified | Parameters |
|----------|---------------|------------|
| `setTaxManager()` (V2) | taxManager (deprecated) | newManager |
| `setAntiSniperTaxManager()` (V2) | antiSniperTaxManager (deprecated) | newManager |
| `setBondingV2()` (V2) | bondingV2 reference | bondingV2_ |
| `setBondingV4()` (V2) | bondingV4 reference | bondingV4_ |
| `setBondingV5()` (V3) | bondingV5, bondingConfig references | bondingV5_, bondingConfig_ |

### Owner (BondingV5)
| Function | State Modified | Parameters |
|----------|---------------|------------|
| `setBondingConfig()` | bondingConfig reference | bondingConfig_ (no zero-address check, no event) |

### Owner (BondingConfig)
| Function | State Modified | Events? |
|----------|---------------|---------|
| `setDeployParams()` | deployParams | YES |
| `setCommonParams()` | initialSupply, feeTo | YES |
| `setBondingCurveParams()` | fakeInitialVirtualLiq, targetRealVirtual | YES |
| `setScheduledLaunchParams()` | startTimeDelay, normalLaunchFee, acfFee | NO (silent) |
| `setTeamTokenReservedWallet()` | teamTokenReservedWallet | YES |
| `setPrivilegedLauncher()` | isPrivilegedLauncher mapping | YES |
| `setReserveSupplyParams()` | maxAirdropBips, maxTotalReservedBips, acfReservedBips | YES |

### privilegedLauncher (BondingConfig mapping)
| Function | Context |
|----------|---------|
| `preLaunch()` on BondingV5 | Required for X_LAUNCH and ACP_SKILL modes |
| `launch()` on BondingV5 | Required for X_LAUNCH, ACP_SKILL, and Project60days tokens |

---

## Step 2: Within-Scope Abuse Analysis

### EXECUTOR_ROLE Abuse Vectors

**Timing Abuse**:
- beOpsWallet (EOA with EXECUTOR_ROLE) can call `buy()`, `sell()`, `graduate()` at any time, independently of BondingV5's state machine checks (trading, launchExecuted). The router has NO state-machine guards -- it trusts the caller completely.
- beOpsWallet can front-run user buys/sells by calling router functions directly, bypassing BondingV5's slippage checks.

**Parameter Abuse**:
- `buy(amountIn, tokenAddress, to, isInitialPurchase)`: The `isInitialPurchase` flag bypasses anti-sniper tax entirely. beOpsWallet can set `isInitialPurchase=true` for any buy to avoid all anti-sniper tax.
- `buy()`/`sell()`: The `to` parameter controls who tokens are transferred from/to. beOpsWallet can specify arbitrary `to` addresses.
- `graduate(tokenAddress)`: Drains ALL pair assets to `msg.sender`. If called by beOpsWallet (not BondingV5), funds go to beOpsWallet, not through the graduation flow.
- `drainPrivatePool(tokenAddress, recipient)`: The `recipient` parameter is attacker-controlled. Only check is `isProject60days()`.
- `approval(pair, asset, spender, amount)`: Can approve arbitrary tokens held by any pair to any spender.

**Sequence Abuse**:
- beOpsWallet can call `graduate()` on any token regardless of graduation conditions (threshold, anti-sniper period). The router has no graduation checks.
- beOpsWallet can call `resetTime()` and `setTaxStartTime()` in any order on any pair.

**Omission Abuse**:
- beOpsWallet can call `setTaxStartTime()` with a far-future timestamp, effectively extending anti-sniper tax indefinitely on any token.
- beOpsWallet can fail to call `launch()` for privileged tokens, blocking them permanently.

### ADMIN_ROLE (Factory) Abuse Vectors

**Parameter Abuse**:
- `setTaxParams()`: No upper bound on `buyTax_` or `sellTax_`. Can be set to 100 (100%), meaning ALL user funds go to tax. The router caps total tax at 99%, but `buyTax` alone could be set to 99%, and `sellTax` could be 100%.
- `setTaxParams()`: `taxVault` can be set to attacker address, redirecting all tax revenue.
- `setTaxParams()`: `antiSniperTaxVault` can be set to attacker address.
- `setRouter()`: No zero-address check. Can be set to a malicious contract that impersonates the router. Since FPairV2 trusts `onlyRouter` completely, a malicious router can drain all pair funds.

**Timing Abuse**:
- ADMIN can change tax params mid-transaction (between blocks). A sandwich: increase tax before user TX, decrease after.

### Owner (BondingV5/Config) Abuse Vectors

**Parameter Abuse**:
- `setBondingConfig()`: Can replace the entire config contract. A malicious config could return arbitrary `calculateGradThreshold()` values, manipulating graduation for future launches. However, already-stored `tokenGradThreshold[token]` values are immutable per-token (set at preLaunch time), so existing tokens are NOT affected.
- BondingConfig `setBondingCurveParams()`: Changing `fakeInitialVirtualLiq` or `targetRealVirtual` affects graduation threshold calculation for FUTURE tokens only. Existing tokens already have their threshold stored.
- BondingConfig `setCommonParams()`: Can change `initialSupply` affecting future launches. Can change `feeTo` redirecting launch fees.
- BondingConfig `setTeamTokenReservedWallet()`: Can redirect reserved tokens for ALL future launches to a different wallet.

---

## Step 3: Attack Scenarios

### Scenario A: EXECUTOR_ROLE Key Compromise (beOpsWallet) [AC-1] -- CRITICAL

```
1. Attacker compromises beOpsWallet private key
2. Attacker calls graduate(tokenAddress) on FRouterV3 for any actively-trading token
3. Router drains ALL pair assets (VIRTUAL + agent tokens) to msg.sender (= beOpsWallet)
4. No graduation-condition check in router; BondingV5's checks are bypassed entirely
5. Attacker repeats for ALL active trading pairs
6. Maximum extractable value: SUM of all FPairV2 pools' real VIRTUAL balances + all agent token balances
7. Recovery: DEFAULT_ADMIN_ROLE holder calls revokeRole(EXECUTOR_ROLE, beOpsWallet)
```

**Impact**: Total loss of ALL actively-trading bonding curve pools. This is the single highest-impact key compromise in the protocol.

### Scenario B: EXECUTOR_ROLE Tax Bypass [AC-2] -- HIGH

```
1. beOpsWallet (compromised or malicious insider) monitors mempool for large user buy
2. beOpsWallet calls router.buy(amountIn, token, attackerAddress, true) with isInitialPurchase=true
3. This bypasses ALL anti-sniper tax (up to 99% savings)
4. Can be repeated for every buy during anti-sniper period
5. Impact: Anti-sniper mechanism completely nullified; front-running profits
```

### Scenario C: ADMIN_ROLE Tax Manipulation [AC-3] -- HIGH

```
1. ADMIN_ROLE holder (or compromised key) calls setTaxParams() on FFactoryV3
2. Sets buyTax=99, sellTax=100, taxVault=attackerAddress
3. All subsequent buys lose 99% to attacker; all sells lose 100% to attacker
4. No event emitted (silent setter) -- off-chain monitoring cannot detect this
5. Impact: Complete theft of all user trade value until detected
```

### Scenario D: EXECUTOR drainPrivatePool Abuse [AC-4] -- HIGH

```
1. beOpsWallet calls drainPrivatePool(project60daysToken, attackerAddress) on FRouterV2/V3
2. ALL assets and tokens drained from pair to attacker
3. Guard: only works for isProject60days tokens (limits scope)
4. Additionally: drainUniV2Pool with recipient=attacker drains graduated pool LP
5. Impact: Total loss of Project60days pool liquidity
```

### Scenario E: ADMIN setRouter() Pair Takeover [AC-5] -- CRITICAL

```
1. ADMIN_ROLE holder calls setRouter(maliciousContract) on FFactoryV3
2. New pairs created via factory will use malicious router
3. BUT: existing FPairV2 contracts have router immutably set in constructor
4. Attack vector: ADMIN sets new router THEN a new pair is created using old factory
5. Actual impact: NEW pairs only. Existing pairs' router is immutable (constructor-set).
6. HOWEVER: ADMIN can also set router on factory, affecting where future createPair calls 
   point the pair's onlyRouter modifier.
```

Wait -- re-examining: FFactoryV2/V3._createPair() uses `router` state variable as constructor arg for new FPairV2. So `setRouter()` affects ALL FUTURE pairs. Existing pairs are safe (router is immutable in FPairV2 constructor).

But the real risk: if ADMIN sets `router` to a malicious contract, then BondingV5 calls `factory.createPair()`, the new pair will trust the malicious router via `onlyRouter`. The malicious router can then drain that pair. This affects only pairs created AFTER the router change.

### Scenario F: Anti-Sniper Tax Timing Manipulation [AC-6] -- HIGH

```
1. beOpsWallet calls setTaxStartTime(pairAddress, block.timestamp + 1_year)
2. Anti-sniper tax remains at maximum (99%) for all future buys on that pair
3. Guard: setTaxStartTime requires _taxStartTime >= startTime (FPairV2:199-203)
4. But attacker can set it to any future time >= startTime
5. Combined with taxVault redirect: 99% of all buys go to attacker-controlled vault
6. Impact: Effectively freezes trading or extracts 99% of buy value
```

### Scenario G: resetTime() Abuse [AC-7] -- MEDIUM

```
1. beOpsWallet calls resetTime(tokenAddress, far_future_timestamp)
2. FPairV2.resetTime() guard: requires block.timestamp < startTime (line 185)
3. This means resetTime ONLY works on pairs that haven't started trading yet
4. Impact: Can delay launch of not-yet-started tokens indefinitely
5. Guard: Cannot affect already-trading tokens (startTime already passed)
```

### Scenario H: setBondingConfig() Mid-Protocol Swap [AC-8] -- MEDIUM

```
1. Owner calls setBondingConfig(maliciousConfig) on BondingV5
2. Malicious config returns different calculateGradThreshold(), initialSupply, etc.
3. Impact on EXISTING tokens: LIMITED
   - tokenGradThreshold[token] already stored per-token (immutable after preLaunch)
   - tokenInfo[token] already stored
   - Graduation threshold for existing tokens NOT affected
4. Impact on FUTURE tokens: FULL control over graduation conditions, supply params, fees
5. Impact on launch(): malicious config could change isPrivilegedLauncher(), 
   teamTokenReservedWallet(), feeTo() for tokens in pre-launch state
6. Severity: Medium (existing tokens safe, pre-launch and future tokens affected)
```

### Scenario I: EXECUTOR graduate() Without Threshold Check [AC-9] -- CRITICAL

```
1. beOpsWallet calls router.graduate(tokenAddress) directly (bypassing BondingV5)
2. Router's graduate() has NO threshold check, NO anti-sniper check, NO trading state check
3. All pair assets (VIRTUAL + agent tokens) sent to msg.sender (beOpsWallet)
4. BondingV5's _openTradingOnUniswap() logic (factory integration, blacklist removal, 
   application execution) is completely skipped
5. Token is left in an inconsistent state: pair drained but trading=true, tradingOnUniswap=false
6. Impact: Theft of all pool value + broken token state (unrecoverable without migration)
```

### Scenario J: privilegedLauncher Value Extraction [AC-10] -- MEDIUM

```
1. Compromised privilegedLauncher calls preLaunch() with X_LAUNCH mode
2. Constrained: must use ANTI_SNIPER_60S, immediate launch, airdropBips=0, needAcf=false
3. Creates token normally but with shortest anti-sniper window (60s)
4. Immediately calls launch() (privileged can launch their own tokens)
5. Front-runs other buyers during 60s anti-sniper window using isInitialPurchase=true bypass
   -- Wait, privilegedLauncher does NOT have EXECUTOR_ROLE, so cannot call router directly
6. Actual impact: privilegedLauncher can control WHEN tokens launch but cannot directly 
   manipulate trading. Can delay launch() indefinitely for X_LAUNCH/ACP_SKILL tokens.
7. Revised Impact: DOS on special token launches; cannot extract value directly
```

---

## Step 4: Mitigations Assessment

| Control | Present? | Details |
|---------|----------|---------|
| Timelock on EXECUTOR actions | NO | All EXECUTOR functions execute immediately |
| Timelock on ADMIN actions | NO | setTaxParams, setRouter execute immediately |
| Timelock on Owner actions | NO | setBondingConfig executes immediately |
| beOpsWallet is multisig? | UNKNOWN | Not enforced on-chain; could be EOA |
| EXECUTOR_ROLE revocable? | YES | Via OpenZeppelin revokeRole() by DEFAULT_ADMIN_ROLE holder |
| ADMIN_ROLE revocable? | YES | Via OpenZeppelin revokeRole() by DEFAULT_ADMIN_ROLE holder |
| privilegedLauncher revocable? | YES | Via setPrivilegedLauncher(addr, false) by BondingConfig owner |
| Rate limits / cooldowns | NO | None on any role function |
| Tax param upper bounds | NO | buyTax/sellTax can be set to any uint256 |
| Event emission on changes | PARTIAL | 23 silent setters; Factory/Router admin changes emit NO events |
| Router address validation | NO | setRouter() accepts any address including zero |

**Revocability Assessment**:
- EXECUTOR_ROLE on beOpsWallet: Can be revoked by DEFAULT_ADMIN_ROLE holder on FRouterV2/V3. Recovery path exists but requires the DEFAULT_ADMIN_ROLE key.
- If DEFAULT_ADMIN_ROLE is compromised: Attacker can grant EXECUTOR_ROLE to arbitrary addresses AND revoke it from legitimate holders. This is the ultimate escalation point.
- BondingV5 owner: Standard OZ Ownable -- transferable via `transferOwnership()`, revocable via `renounceOwnership()`.

---

## Step 5: User-Side Exploitation

### Scenario D: User Exploits beOpsWallet Predictability

```
1. beOpsWallet calls launch() for scheduled tokens at predictable times (after startTime)
2. User monitors for launch() transaction in mempool
3. User front-runs with buy() immediately after launch, during peak anti-sniper tax period
   -- Actually, this hurts the user (high tax), so no exploit here
4. Reverse: User BACK-RUNS launch() to buy immediately as anti-sniper tax starts declining
5. Impact: Minimal -- anti-sniper tax is designed to decay, user timing is expected
```

### Scenario E: User Griefs resetTime() Precondition

```
1. resetTime() precondition: block.timestamp < startTime (pair not yet trading)
2. User CANNOT manipulate block.timestamp
3. Once startTime passes, resetTime() permanently reverts for that pair
4. Impact: None -- precondition is not user-manipulable
```

### Scenario F: User Forces Suboptimal Graduation

```
1. Graduation triggers when newReserveA <= gradThreshold AND !hasAntiSniperTax AND trading
2. User can buy large amounts to push reserveA below gradThreshold
3. This is by design -- graduation is supposed to trigger when enough buying occurs
4. User can manipulate WHEN graduation happens but not extract value from it
5. Impact: Expected protocol behavior, not an exploit
```

### Scenario G: User Blocks EXECUTOR Drain

```
1. drainPrivatePool() requires isProject60days(token) == true
2. User cannot change isProject60days flag (set at preLaunch, stored in tokenLaunchParams)
3. drainPrivatePool() operates on pair balances, not user-controlled state
4. Impact: None -- drain preconditions are not user-manipulable
```

---

## Step 6: Precondition Griefability Check

### EXECUTOR_ROLE Functions

| Function | Preconditions | User Can Manipulate? | Grief Impact |
|----------|--------------|---------------------|--------------|
| `buy()` | token != 0, to != 0, amountIn > 0 | NO | N/A |
| `sell()` | token != 0, to != 0, amountIn > 0 | NO | N/A |
| `graduate()` | token != 0 | NO | N/A |
| `resetTime()` | block.timestamp < startTime, newStartTime >= timestamp + delay | NO (time-based) | N/A |
| `setTaxStartTime()` | _taxStartTime >= startTime | NO | N/A |
| `drainPrivatePool()` | isProject60days(token), pair exists, balances > 0 | NO (flag is immutable) | N/A |
| `drainUniV2Pool()` | isProject60days(token), veToken matches, founder balance > 0 | Partially (founder could transfer veTokens away) | Drain blocked if veTokens moved |
| `addInitialLiquidity()` | token != 0, pair exists, pool.lastUpdated == 0 | NO | N/A |
| `approval()` | spender != 0 | NO | N/A |

### Admin/Owner Functions (Step 6b)

| Function | Preconditions | External State Dependency? | User Can Manipulate? | Grief Impact |
|----------|--------------|---------------------------|---------------------|--------------|
| `setTaxParams()` | newVault != 0 | NO | NO | N/A |
| `setRouter()` | None | NO | NO | N/A |
| `setBondingConfig()` | None | NO | NO | N/A |
| `setDeployParams()` | None | NO | NO | N/A |
| `setCommonParams()` | None | NO | NO | N/A |
| `setBondingCurveParams()` | None | NO | NO | N/A |
| `setScheduledLaunchParams()` | None | NO | NO | N/A |
| `setTeamTokenReservedWallet()` | None | NO | NO | N/A |
| `setPrivilegedLauncher()` | None | NO | NO | N/A |
| `setReserveSupplyParams()` | max+acf <= total, all <= 10000 | NO | NO | N/A |
| `cancelLaunch()` | sender == creator, !launchExecuted | YES (user-initiated) | YES (creator only) | Creator can cancel own token |

**Griefability Summary**: Admin/owner functions have NO user-griefable preconditions. All preconditions are either non-existent, time-based, or owner-controlled. The one exception (`drainUniV2Pool` depends on founder veToken balance) is a legitimate admin concern but low severity since the founder is also a protocol-trusted entity.

---

## Findings Summary

### [AC-1] EXECUTOR_ROLE graduate() Bypasses All BondingV5 Safety Checks -- CRITICAL

**Status**: CONFIRMED
**Severity**: Critical
**Location**: FRouterV2.sol:230-239, FRouterV3.sol:230-239
**Evidence**: `graduate()` on FRouter only checks `onlyRole(EXECUTOR_ROLE)` and `tokenAddress != address(0)`. It has NO checks for:
- Graduation threshold (newReserveA <= gradThreshold)
- Anti-sniper tax period completion
- Trading state (trading == true)
- Launch state (launchExecuted == true)

When called by beOpsWallet (EOA with EXECUTOR_ROLE), ALL pair assets are sent to `msg.sender` (the EOA), completely bypassing BondingV5's `_openTradingOnUniswap()` flow which handles application threshold updates, blacklist removal, and Uniswap LP creation.

**Max Damage**: Total value of ALL active FPairV2 pools (all real VIRTUAL + all agent tokens in every actively-trading pair).
**Key Question Answers**:
1. Maximum malicious damage: Drain all pools
2. Maximum key compromise damage: Same -- drain all pools
3. Time-sensitive: Yes -- must be detected before all pools drained
4. User funds affected: ALL user funds in all bonding curve pools

### [AC-2] EXECUTOR_ROLE Can Bypass Anti-Sniper Tax via isInitialPurchase Flag -- HIGH

**Status**: CONFIRMED
**Severity**: High
**Location**: FRouterV2.sol:184, FRouterV3.sol:189
**Evidence**: The `isInitialPurchase` parameter on `buy()` is trusted implicitly from the EXECUTOR_ROLE caller. When `true`, anti-sniper tax is skipped entirely (lines 184-188 in V2, 189-191 in V3). beOpsWallet can call `buy()` with `isInitialPurchase=true` for any address, bypassing up to 99% anti-sniper tax on any token at any time.

**Max Damage**: Value of anti-sniper tax that should have been collected across all tokens during their anti-sniper periods.

### [AC-3] ADMIN_ROLE Can Set Unbounded Tax Rates (Up to 100%) -- HIGH

**Status**: CONFIRMED
**Severity**: High
**Location**: FFactoryV2.sol:108-122, FFactoryV3.sol:116-130
**Evidence**: `setTaxParams()` accepts arbitrary `uint256` values for `buyTax_` and `sellTax_` with NO upper bound validation. While the router caps total buy tax at 99% (normalTax + antiSniperTax), `sellTax` has NO such cap in the router's `sell()` function (FRouterV2.sol:150-153, FRouterV3.sol:157-158). A `sellTax` of 100 means `txFee = (100 * amountOut) / 100 = amountOut`, and `amount = amountOut - txFee = 0`. Users selling would receive zero VIRTUAL.

Additionally, both `taxVault` and `antiSniperTaxVault` can be redirected to arbitrary addresses, silently stealing all tax revenue.

**Compounding Factor**: `setTaxParams()` emits NO event (silent setter), making this undetectable by on-chain monitoring.

### [AC-4] ADMIN_ROLE setRouter() Can Compromise All Future Pairs -- HIGH

**Status**: CONFIRMED
**Severity**: High
**Location**: FFactoryV2.sol:124-126, FFactoryV3.sol:132-134
**Evidence**: `setRouter()` accepts ANY address (including zero -- no validation). The `router` value is used as the `onlyRouter` authority in all FUTURE FPairV2 contracts created by this factory. A malicious router address would have full control over all future pairs (mint, swap, transfer, drain). Existing pairs are safe (router is immutable in FPairV2 constructor).

**Impact**: All future pairs created after the malicious setRouter() call are fully compromised.

### [AC-5] EXECUTOR_ROLE setTaxStartTime() Can Extend Anti-Sniper Tax Indefinitely -- HIGH

**Status**: CONFIRMED
**Severity**: High
**Location**: FRouterV2.sol:358-369, FRouterV3.sol:344-355, FPairV2.sol:198-206
**Evidence**: `setTaxStartTime()` is callable by any EXECUTOR_ROLE holder. FPairV2 only validates `_taxStartTime >= startTime`. An EXECUTOR can set `taxStartTime` to `type(uint256).max` or any far-future value, causing `_calculateAntiSniperTax()` to return maximum tax (99%) indefinitely for that pair (since `block.timestamp < finalTaxStartTime` returns `startTax`).

Combined with tax vault redirection [AC-3], this enables extracting 99% of all buy value.

### [AC-6] setBondingConfig() Silent Setter -- No Event, No Validation -- MEDIUM

**Status**: CONFIRMED
**Severity**: Medium
**Location**: BondingV5.sol:857-859
**Evidence**: `setBondingConfig(address bondingConfig_)` has no zero-address check and emits no event. Owner can silently replace the entire configuration contract, affecting:
- `launch()` behavior: `isPrivilegedLauncher()` check, `teamTokenReservedWallet()` for initial buy tokens
- `preLaunch()` behavior: all bonding curve parameters, supply calculations, fee calculations
- Anti-sniper type lookups in FRouterV3 (via `bondingConfig.getAntiSniperDuration()`)

**Limitation**: Existing tokens' `tokenGradThreshold` is immutable (stored at preLaunch time), limiting retroactive impact.

### [AC-7] 23 Silent Setters Create Monitoring Blindspot -- MEDIUM

**Status**: CONFIRMED
**Severity**: Medium
**Location**: See SCRATCHPAD/setter_list.md for full list
**Evidence**: 23 admin/owner functions across the protocol emit NO events when modifying critical state. Key silent setters affecting active trading:
- `FFactoryV2/V3.setTaxParams()` -- tax rates, vaults (affects ALL active trades)
- `FFactoryV2/V3.setRouter()` -- router address (affects future pairs)
- `BondingV5.setBondingConfig()` -- entire config swap
- `BondingConfig.setScheduledLaunchParams()` -- launch fees, delays
- All `FRouterV2` admin setters: taxManager, bondingV2/V4 references

Off-chain monitoring systems cannot detect these changes without polling state, creating a window for silent manipulation.

### [AC-8] EXECUTOR_ROLE approval() Can Set Arbitrary Approvals on Pair Assets -- MEDIUM

**Status**: CONFIRMED
**Severity**: Medium
**Location**: FRouterV2.sol:241-250, FRouterV3.sol:241-250
**Evidence**: `approval(pair, asset, spender, amount)` allows any EXECUTOR_ROLE holder to approve ANY token held by ANY pair to ANY spender. The only validation is `spender != address(0)`. A compromised beOpsWallet could:
1. Call `approval(pairAddress, assetToken, attackerAddress, type(uint256).max)`
2. Attacker then calls `transferFrom()` on the token to drain the pair

This is an alternative drain vector to [AC-1] that works at the token level.

### [AC-9] privilegedLauncher Can Block Special Token Launches via Omission -- LOW

**Status**: CONFIRMED
**Severity**: Low
**Location**: BondingV5.sol:524-528
**Evidence**: `launch()` for X_LAUNCH, ACP_SKILL, and Project60days tokens requires `isPrivilegedLauncher(msg.sender)`. If the privileged launcher key is lost or the operator refuses to act, these tokens are permanently stuck in pre-launch state. The creator's `initialPurchase` funds are locked in BondingV5 (creator can call `cancelLaunch()` to recover them, mitigating the fund-lock aspect).

**Mitigation**: Creator can call `cancelLaunch()` to recover initial purchase, so this is a liveness issue, not a fund-loss issue.

### [AC-10] DEFAULT_ADMIN_ROLE is Single Point of Escalation -- MEDIUM

**Status**: CONFIRMED
**Severity**: Medium
**Location**: FRouterV2.sol:72, FRouterV3.sol:79, FFactoryV2.sol:51, FFactoryV3.sol:59
**Evidence**: `DEFAULT_ADMIN_ROLE` is granted to `msg.sender` at initialization. This role can:
- Grant EXECUTOR_ROLE to any address (enabling [AC-1])
- Grant ADMIN_ROLE to any address (enabling [AC-3], [AC-4])
- Revoke roles from legitimate holders (DOS)
No multi-sig enforcement or timelock on role grants.

---

## Key Questions (All Roles)

### Q1: Maximum damage if each role acts maliciously?
| Role | Max Damage |
|------|-----------|
| EXECUTOR_ROLE (beOpsWallet) | Drain ALL active bonding curve pools via graduate() or approval() |
| ADMIN_ROLE (Factory) | Set 100% sell tax + redirect vault = steal all sell proceeds; set malicious router for future pairs |
| Owner (BondingV5) | Swap BondingConfig to manipulate future launches; limited impact on existing tokens |
| Owner (BondingConfig) | Change all protocol params for future tokens; redirect fees and reserved tokens |
| privilegedLauncher | Block special token launches (low impact due to cancelLaunch()) |
| DEFAULT_ADMIN_ROLE | Grant any role to attacker = escalate to EXECUTOR/ADMIN level attacks |

### Q2: Maximum damage if each role's key is compromised?
Same as Q1. No on-chain mitigations (timelocks, multi-sig enforcement) differentiate malicious insider from key compromise.

### Q3: Time-sensitive operations?
- EXECUTOR `graduate()`: Immediate, irreversible pool drain
- EXECUTOR `setTaxStartTime()`: Immediately affects all subsequent buys
- ADMIN `setTaxParams()`: Immediately affects all subsequent trades
- Owner `setBondingConfig()`: Affects next preLaunch/launch calls

### Q4: User funds / protocol state affected?
- EXECUTOR: ALL user funds in ALL active bonding curve pools
- ADMIN: ALL user trade proceeds (via tax manipulation)
- Owner: Future launch deposits and reserved token allocations
- privilegedLauncher: Creator initial purchase (recoverable via cancelLaunch)

---

## Step Execution Checklist

| Step | Required | Completed? | Notes |
|------|----------|------------|-------|
| 1. Inventory Role Permissions | YES | YES | All 4 roles + DEFAULT_ADMIN inventoried |
| 2. Analyze Within-Scope Abuse | YES | YES | Timing, parameter, sequence, omission analyzed |
| 3. Model Attack Scenarios (A,B,C) | YES | YES | 10 scenarios modeled (A-J) |
| 4. Assess Mitigations | YES | YES | No timelocks, no rate limits, revocation exists via OZ |
| 5. Model User-Side Exploitation (D,E,F,G) | YES | YES | 4 user-side scenarios analyzed; minimal exploitability |
| 6. Precondition Griefability Check | YES | YES | EXECUTOR + Admin functions checked; no user-griefable preconditions |
| 6b. Admin Function Griefability | YES | YES | All admin functions enumerated; none have user-griefable preconditions |

**Step Execution**: 1,2,3,4,5,6,6b | (no skips)

---

## Cross-Reference Notes

- [AC-1] and [AC-8] are alternative drain vectors for the same assets -- fixing one does not fix the other
- [AC-3] (tax manipulation) compounds with [AC-5] (tax timing) for maximum extraction
- [AC-7] (silent setters) makes [AC-3], [AC-4], [AC-6] harder to detect
- Per-token `tokenGradThreshold` storage (BondingV5.sol:393) is a key defense against retroactive Owner manipulation
- FPairV2's immutable `router` (constructor-set) is a key defense against [AC-4] for existing pairs
