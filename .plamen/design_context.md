# Design Context: Virtuals Protocol LaunchpadV2

**Agent:** Recon Agent 1B
**Date:** 2026-04-02
**Source:** Inferred from code (no external docs provided); README at `contracts/launchpadv2/README.md`; audit summary at `scripts/launchpadv5/AUDIT_SUMMARY.md`

---

## 1. Protocol Purpose

Virtuals Protocol LaunchpadV2 is a **bonding-curve-based token launch platform** for AI agent tokens ("Virtuals"). It implements a lifecycle:

1. **PreLaunch** -- Creator deploys an AgentToken via `preLaunch()`, which creates a custom constant-product AMM pair (FPairV2) seeded with the token supply and *virtual* (fake) VIRTUAL liquidity. Trading is not yet active.
2. **Launch** -- After the scheduled start time, `launch()` activates trading, applies anti-sniper tax, and executes the creator's initial buy. Tokens bought go to `teamTokenReservedWallet` for backend-managed distribution.
3. **Bonding Curve Trading** -- Users buy/sell via `buy()`/`sell()` through FRouterV2/V3. The pair uses a constant-product formula (`x * y = K`, K is invariant). Anti-sniper tax decays linearly.
4. **Graduation** -- When token reserve drops to `gradThreshold`, `_openTradingOnUniswap()` triggers: the pair is drained, assets go to AgentFactory, remaining tokens go to the real Uniswap V2 pair, and trading moves to Uniswap.
5. **Post-Graduation** -- Token trades on real Uniswap V2. LP liquidity can be drained for Project60days tokens.

The system is a **single-token model** (V2 improvement over V1's dual-token unwrap model). The same AgentToken is used throughout the entire lifecycle.

### Contract Evolution (V2 -> V5)

| Version | K Constant | VirtualIdBase | Key Change |
|---------|-----------|---------------|------------|
| BondingV2 | 3,150,000,000,000 | 20B | Base version; project60days support |
| BondingV3 | 3,150,000,000,000 | 30B | **Deprecated** (identical to V2 minus project60days) |
| BondingV4 | 2,850,000,000,000 | 40B | Added X_LAUNCH, ACP_SKILL modes; authorized launchers |
| BondingV5 | Configurable via BondingConfig | 50B | Fully configurable; BondingConfig extracted; airdrop bips; per-token gradThreshold; anti-sniper types (NONE/60S/98M); fee delegation |

**NOTE:** BondingV2 and BondingV3 `_preLaunch()` both begin with `revert("Not implemented")` -- they are **disabled/legacy** contracts. BondingV4 `preLaunch()` similarly reverts. Only BondingV5 has active preLaunch logic.

---

## 2. Key Invariants

### INV-1: Constant Product K
- **FPairV2**: `_pool.k = reserve0 * reserve1` (set at mint, never changed by swaps)
- `swap()` updates reserves but preserves `k`: `k` field stays constant across swaps
- **BUT**: `syncAfterDrain()` recalculates `k = reserve0 * reserve1` after drain -- this breaks the invariant intentionally for pool termination

### INV-2: Graduation Threshold
- Graduation triggers when `newReserveA <= gradThreshold` AND anti-sniper tax period has ended AND token is still trading
- BondingV2-V4: `gradThreshold` is a global parameter
- BondingV5: `gradThreshold` is per-token, calculated as: `gradThreshold = fakeInitialVirtualLiq * bondingCurveSupply / (targetRealVirtual + fakeInitialVirtualLiq)`

### INV-3: Token Supply Accounting
- Total supply = `initialSupply` (e.g. 1B)
- `bondingCurveSupply = initialSupply - teamTokenReservedSupply` (V2-V4) or `initialSupply * (10000 - totalReservedBips) / 10000` (V5)
- `teamTokenReservedSupply` tokens transferred to `teamTokenReservedWallet` at preLaunch
- All bondingCurveSupply tokens go into the FPairV2 as reserve0

### INV-4: Fee Accounting
- Buy tax: `normalTax` (from factory.buyTax()) + `antiSniperTax` (time-based decay), total capped at 99%
- Sell tax: `factory.sellTax()` only, no anti-sniper
- Normal tax goes to `factory.taxVault()` (AgentTaxV2 in V5 for on-chain attribution)
- Anti-sniper tax goes to `factory.antiSniperTaxVault()` (separate vault, no attribution)

### INV-5: Virtual Liquidity (Fake Reserve)
- The asset side (reserve1) is seeded with **virtual/fake VIRTUAL liquidity** -- no real tokens deposited
- `FPairV2.mint()` sets reserve1 = `amountAsset` (a computed virtual amount), but only real agent tokens are transferred
- `assetBalance()` returns actual `IERC20(tokenB).balanceOf(this)` which will be 0 initially, diverging from `reserve1`
- Real VIRTUAL enters the pair only through user buys

### INV-6: Launch State Machine
- `preLaunch` -> `launchExecuted = false, trading = true`
- `launch()` -> `launchExecuted = true` (or `cancelLaunch()` -> `launchExecuted = true, trading = false`)
- `_openTradingOnUniswap()` -> `trading = false, tradingOnUniswap = true`
- Trading requires both `trading == true` AND `launchExecuted == true`

---

## Operational Implications

### From INV-1 (Constant Product K)
The bonding curve pair uses a simplified constant-product AMM **without** Uniswap's 0.3% swap fee. The K value is computed once from initial reserves and never adjusted during normal trading. This means the price curve is deterministic given the initial seeding. After `syncAfterDrain()`, the pair is effectively dead (reserves zeroed out), so K recalculation is a cleanup operation, not a trading state.

### From INV-2 (Graduation Threshold)
Graduation is **irreversible** and **triggered atomically during a buy**. The system cannot graduate if anti-sniper tax is still active -- this is a deliberate safeguard ensuring the tax period fully elapses before the token moves to Uniswap. In V5, per-token thresholds mean each token's graduation point depends on its specific bonding curve supply (which varies with airdrop/ACF reserves).

### From INV-3 (Token Supply Accounting)
The protocol mints 100% of token supply to the BondingV5 contract (vault), then splits: bonding curve supply into FPairV2, reserved supply to `teamTokenReservedWallet`. This means the **Bonding contract temporarily holds the entire token supply** during preLaunch. Creator's initial buy tokens also route through the bonding contract to the teamTokenReservedWallet, requiring off-chain (backend) distribution.

### From INV-4 (Fee Accounting)
The tax split architecture means **two separate fund flows** for buy transactions: normal tax (attributed per-token via AgentTaxV2) and anti-sniper tax (pooled into a single vault). Sell transactions only generate normal tax. The 99% cap on total tax means at maximum anti-sniper decay, the normal tax is effectively zero-impact since `99 - normalTax = antiSniperTax`.

### From INV-5 (Virtual Liquidity)
The "fake" initial virtual liquidity is a critical bootstrapping mechanism. Since no real VIRTUAL is in the pair at launch, the constant-product formula computes outputs based on a phantom reserve. As real VIRTUAL flows in from buys, `assetBalance()` grows while `reserve1` tracks the computed virtual amount. At graduation, `assetBalance()` represents all real VIRTUAL accumulated. The divergence between `reserve1` (virtual) and `assetBalance()` (real) is the core design feature of the bonding curve.

### From INV-6 (Launch State Machine)
The two-phase launch (preLaunch + launch) creates a window where the pair exists but cannot trade. This allows backend operations (tax recipient setup, marketing) between preLaunch and launch. The `cancelLaunch()` mechanism refunds `initialPurchase` to creator but **does not burn the created tokens or destroy the pair** -- the pair remains with tokens locked in it permanently if cancelled.

---

## Trust Assumption Table

| # | Actor | Trust Level | Assumption | Source |
|---|-------|-------------|------------|--------|
| 1 | **Owner (BondingV2-V5)** | HIGH | Can change all bonding parameters: supply, gradThreshold, maxTx, assetRate, fee, feeTo via `setTokenParams()`. Can set deploy params and launch params. In V5, can change BondingConfig reference entirely via `setBondingConfig()`. | `onlyOwner` modifier; Source: inferred from BondingV2.sol:172-189, BondingV5.sol:857 |
| 2 | **Owner (BondingConfig)** | HIGH | Can change all protocol parameters: bonding curve params, reserve supply params, scheduled launch params, deploy params, team wallet, fee recipient. Can authorize/revoke privileged launchers. | `onlyOwner` modifier; Source: inferred from BondingConfig.sol:155-264 |
| 3 | **ADMIN_ROLE (FFactoryV2/V3)** | HIGH | Can set tax parameters (taxVault, buyTax, sellTax, anti-sniper start value, anti-sniper vault). Can set the router address. | `onlyRole(ADMIN_ROLE)`; Source: inferred from FFactoryV2.sol:108-127 |
| 4 | **CREATOR_ROLE (FFactoryV2/V3)** | MEDIUM | Can create new trading pairs. Granted to BondingV2-V5. | `onlyRole(CREATOR_ROLE)`; Source: inferred from FFactoryV2.sol:88-95 |
| 5 | **EXECUTOR_ROLE (FRouterV2/V3)** | HIGH | Can execute trades (buy/sell), add liquidity, graduate tokens, drain pools, reset time, set tax start time. Granted to BondingV5 and beOpsWallet. | `onlyRole(EXECUTOR_ROLE)`; Source: inferred from FRouterV2.sol:115-290 |
| 6 | **ADMIN_ROLE (FRouterV2/V3)** | HIGH | Can set taxManager, antiSniperTaxManager, bondingV2/V4/V5 references. Controls which bonding contracts the router recognizes. | `onlyRole(ADMIN_ROLE)`; Source: inferred from FRouterV2.sol:252-278, FRouterV3.sol:257-262 |
| 7 | **Privileged Launchers (BondingConfig)** | MEDIUM-HIGH | Backend wallets that can preLaunch X_LAUNCH/ACP_SKILL modes and call launch() for X_LAUNCH/ACP_SKILL/Project60days tokens. Controls when trading starts for special tokens. | `isPrivilegedLauncher` mapping; Source: inferred from BondingConfig.sol:47, BondingV5.sol:524-528, 836-838 |
| 8 | **Router (FPairV2)** | HIGH | Only the router can call mint, swap, transfer, approval, resetTime, setTaxStartTime, syncAfterDrain on a pair. The pair has no independent access control beyond `onlyRouter`. | `onlyRouter` modifier; Source: inferred from FPairV2.sol:61-64 |
| 9 | **Token Creator** | LOW | Can cancel their own launch (before execution). Cannot trade before launch. Initial buy goes to teamTokenReservedWallet, not directly to creator. | `msg.sender == _token.creator` check; Source: inferred from BondingV2.sol:395 |
| 10 | **AgentFactory (V6/V7)** | HIGH | BondingV5 calls createNewAgentTokenAndApplication, addBlacklistAddress, removeBlacklistAddress, updateApplicationThresholdWithApplicationId, executeBondingCurveApplicationSalt. Factory controls token creation and graduation finalization. | Interface calls; Source: inferred from BondingV5.sol:331-356, 727-757 |
| 11 | **teamTokenReservedWallet** | HIGH (off-chain trust) | Receives both reserved tokens (airdrop + ACF) and creator's initial buy tokens. Distribution from this wallet is managed off-chain by the backend. No on-chain enforcement of distribution. | Direct transfer recipient; Source: inferred from BondingV5.sol:383-387, 554-556 |
| 12 | **taxVault / AgentTaxV2** | MEDIUM | Receives all normal trade taxes via `depositTax()`. Has REGISTER_ROLE for BondingV5 to register tokens, SWAP_ROLE for backend to swap accumulated taxes, EXECUTOR_ROLE for updating creators. | Role-based; Source: inferred from bondingV5Fixture.js:414-437 |
| 13 | **DEFAULT_ADMIN_ROLE holders** | CRITICAL | Can grant/revoke any role in AccessControl-based contracts (FFactory, FRouter, AgentFactory). This is the OpenZeppelin default admin pattern. | OZ AccessControl; Source: inferred from deployment scripts |

---

## 3. External Dependencies

| Dependency | Version | Usage |
|-----------|---------|-------|
| OpenZeppelin Contracts Upgradeable | ^5.x (inferred from ^0.8.20) | Initializable, OwnableUpgradeable, AccessControlUpgradeable, ReentrancyGuardUpgradeable |
| OpenZeppelin Contracts | ^5.x | IERC20, SafeERC20, ERC20, Ownable |
| Uniswap V2 (production) | Core | Post-graduation trading via real Uniswap V2 Router/Factory/Pair |
| ERC-6551 (TBA Registry) | Standard | Token-bound accounts for agent NFTs |

---

## 4. Protocol Flow Summary (BondingV5)

```
Creator calls preLaunch():
  1. Validate: airdropBips, antiSniperType, launchMode, startTime
  2. Calculate bondingCurveSupply from BondingConfig
  3. Collect fees (launch fee + ACF fee if applicable)
  4. Create AgentToken via AgentFactoryV7
  5. Blacklist Uniswap LP pool address on token (prevent pre-graduation transfers)
  6. Create FPairV2 via FFactoryV3
  7. Seed pair: transfer bondingCurveSupply tokens, mint with virtual VIRTUAL liquidity
  8. Transfer reserved tokens to teamTokenReservedWallet
  9. Calculate and store per-token gradThreshold
  10. Register token with AgentTaxV2 for on-chain tax attribution
  11. Emit PreLaunched event

Anyone calls launch() (after startTime):
  1. Validate: token exists, not already launched, past startTime
  2. For special tokens: require privileged launcher
  3. Set taxStartTime for anti-sniper calculation
  4. Execute creator's initial buy (tokens -> teamTokenReservedWallet)
  5. Mark launchExecuted = true
  6. Emit Launched event

Users trade via buy()/sell():
  - Buy: normalTax + antiSniperTax deducted, remainder goes to pair, tokens out to buyer
  - Sell: sellTax deducted from output, tokens in to pair, VIRTUAL out to seller
  - After each buy: check graduation condition

Graduation (_openTradingOnUniswap):
  1. Drain pair: all assets + tokens back to BondingV5
  2. Transfer VIRTUAL to AgentFactory (for application threshold)
  3. Remove blacklist on Uniswap LP address
  4. Transfer remaining tokens to token contract itself
  5. Call executeBondingCurveApplicationSalt on AgentFactory
  6. Mark trading = false, tradingOnUniswap = true
  7. Emit Graduated event
```
