# Meta-Buffer: VP Launchpad Suite (DEX/Launchpad — Bonding Curve + AMM)

## Protocol Classification
- **Type**: dex / launchpad
- **Key Indicators**: BondingV2, BondingV3, BondingV4, BondingV5, FPairV2, FFactoryV2, FFactoryV3, FRouterV2, FRouterV3
- **Asset Token**: $VIRTUAL (single asset token for all pairs)
- **Graduation Target**: Bonding curve → UniswapV2 LP migration upon reaching `gradThreshold`
- **RAG_TOOLS_AVAILABLE**: false (mcp__unified-vuln-db not available; analysis derived from direct code inspection)

---

## Contract Architecture Summary

| Contract | Version | Role | Notes |
|---|---|---|---|
| BondingV2 | V2 | Launchpad orchestrator | preLaunch reverts ("Not implemented"); launch(), buy(), sell(), graduate |
| BondingV3 | V3 | Launchpad orchestrator | preLaunch reverts ("Not implemented"); near-identical to V2 |
| BondingV4 | V4 | Launchpad orchestrator | Adds X_LAUNCH / ACP_SKILL launch modes; preLaunch reverts ("Not implemented") |
| BondingV5 | V5 | Launchpad orchestrator | Fully active; uses BondingConfig; per-token gradThreshold; airdropBips; feeDelegation |
| FPairV2 | V2 | Custom AMM pair | Virtual reserves (no real balanceOf math); onlyRouter guards; syncAfterDrain |
| FFactoryV2 | V2 | Pair factory | CREATOR_ROLE creates pairs; paired with FRouterV2 |
| FFactoryV3 | V3 | Pair factory | Structurally identical to V2; paired with FRouterV3 / BondingV5 |
| FRouterV2 | V2 | Trade router | EXECUTOR_ROLE; anti-sniper tax; drainPrivatePool; drainUniV2Pool |
| FRouterV3 | V3 | Trade router | EXECUTOR_ROLE; configurable anti-sniper types; AgentTax attribution |
| BondingConfig | — | Configuration store | Multi-chain params; privileged launchers; reserve bips; grad threshold math |

---

## Bonding Curve Mechanics

- **Invariant**: Constant-product (`k = reserve0 * reserve1`), stored in `FPairV2._pool.k`
- **Virtual reserves**: `FPairV2` tracks reserves internally — NOT derived from `balanceOf`. Initial virtual asset liquidity (`fakeInitialVirtualLiq`) is recorded in pool but no actual asset tokens are deposited.
- **Price formula**: `price = bondingCurveSupply / liquidity` (set at creation, never updated on-chain after launch)
- **Graduation trigger**: Inside `_buy()`, after each buy, checks `newReserveA <= gradThreshold`. If true AND no active anti-sniper tax → calls `_openTradingOnUniswap()`.
- **K constant variants**: BondingV2/V3 use `K = 3_150_000_000_000`; BondingV4 uses `K = 2_850_000_000_000`; BondingV5 uses `BondingConfig.bondingCurveParams` (configurable per chain).

---

## Common Vulnerabilities for DEX/Launchpad

| Category | Frequency | Key Functions to Check |
|---|---|---|
| Price / Reserve Manipulation | High | `getAmountsOut`, `getReserves`, `kLast`, `syncAfterDrain` |
| Graduation Condition Bypass | High | `_buy → newReserveA <= gradThreshold`, `_openTradingOnUniswap` |
| Anti-sniper Tax Bypass | Medium | `_calculateAntiSniperTax`, `hasAntiSniperTax`, `taxStartTime` |
| Access Control Misconfiguration | High | `EXECUTOR_ROLE`, `CREATOR_ROLE`, `isPrivilegedLauncher` |
| Reentrancy (Bonding → Router → Pair) | High | `buy`, `sell`, `graduate`, `drainPrivatePool` |
| Front-running / Sandwich | High | `buy`, `sell` (amountOutMin slippage checks) |
| cancelLaunch Event Bug | Low | BondingV2/V3/V4: event emits `_token.initialPurchase` AFTER it is zeroed (always emits 0) |
| Launch-before-startTime Bypass | Medium | `launch()` checks `block.timestamp < pair.startTime()`, but sell() has no such check |
| Liquidity Drain Privilege Abuse | Medium | `drainPrivatePool`, `drainUniV2Pool` (EXECUTOR_ROLE, amountAMin=0) |
| Fee Math Precision / Rounding | Medium | Integer division in tax, `(fee * amount) / 100` vs bips |
| State Desync After Drain | Medium | `syncAfterDrain` in try-catch; old pairs silently skip sync |
| Stale Graduation via drainPool | High | After `drainPrivatePool`, reserves are zeroed → next buy triggers graduation with drained pool |
| Initial Purchase Slippage Zero | Medium | `_buy(..., amountOutMin=0, ...)` in `launch()` — no minimum output |

---

## Attack Vectors

### Bonding Curve
- **Virtual Reserve Manipulation**: `FPairV2._pool` reserves are only updated via `swap()` (onlyRouter). If the router incorrectly accounts for token transfers before calling `swap()`, reserves can desync from actual balances, allowing free token extraction.
- **`syncAfterDrain` Desync**: If `drainPrivatePool` is called and old `FPairV2` (without `syncAfterDrain`) is used, the pair's stored reserves remain positive while actual balances are zero. The next `getAmountsOut()` call will return a value based on phantom reserves, allowing a large buy for near-zero output triggering graduation with empty pool assets.
- **Graduation Spam via Price Push**: An attacker with sufficient capital can buy down `reserveA` to `<= gradThreshold` in a single transaction (since anti-sniper tax check also must be false), triggering graduation. Graduation transfers ALL remaining pair assets to agentFactory. Timing this with a drainPrivatePool or near-empty pool could result in graduating with near-zero asset backing.
- **Anti-sniper Tax Period Block**: For `ANTI_SNIPER_NONE` type tokens (BondingV5), there is zero anti-sniper protection. Combined with immediate launch (`startTime = block.timestamp`), snipers can buy in the same block.
- **Graduation Blocked by hasAntiSniperTax**: Graduation is gated on `!router.hasAntiSniperTax(pairAddress)`. If `taxStartTime` is never set (e.g., on old pairs where `setTaxStartTime()` silently fails), anti-sniper tax will never expire, permanently blocking graduation.
- **cancelLaunch with trading=true**: After `cancelLaunch()`, `launchExecuted = true` but `trading` remains `true`. This means `buy()` and `sell()` could still be called on an "active" (non-graduated, non-launched) pair, except they check `launchExecuted` too — so this is actually safe in current code, but the state is inconsistent.

### AMM/Pair
- **FPairV2 `k` not enforced on swap**: `swap()` receives explicit `amount0In/Out/1In/1Out` params from the router and updates reserves directly. The pair does NOT verify the constant-product invariant post-swap. Full trust in router; any router bug breaks invariant integrity.
- **`transferAsset` / `transferTo` without reserve update**: Both functions transfer tokens without touching `_pool` reserves. Only `syncAfterDrain` (or `swap`) updates reserves. A sequence of `transferAsset` → no `syncAfterDrain` → `getAmountsOut` produces phantom-reserve pricing.
- **`addInitialLiquidity` double-mint prevention**: `mint()` checks `_pool.lastUpdated == 0`. However, `lastUpdated` is set to `block.timestamp` which could be 0 at genesis (unlikely in practice, but theoretically edge-case on some chains).
- **`priceALast` / `priceBLast` division by zero**: If `reserve0` or `reserve1` is 0, these view functions will revert (not return 0). Any upstream contract calling these as price oracles could be DoS'd.

### Graduate Sequence Race Condition
- `_openTradingOnUniswap()` reads `pair.assetBalance()` and `pair.balance()` (real `balanceOf`), then calls `router.graduate()` which calls `pair.transferAsset(msg.sender, ...)` and `pair.transferTo(msg.sender, ...)`.
- If any external call between the balance reads and transfers can re-enter (e.g., ERC777 token hooks, if assetToken ever changes), the amount sent could differ from what was read.
- The graduation salt uses `keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress))` — predictable, miner/validator-influenceable.

### Router Access Control
- `buy()` and `sell()` in the router are `onlyRole(EXECUTOR_ROLE)`. The bonding contracts (V2–V5) are the only intended executors. If a third party is accidentally granted `EXECUTOR_ROLE` on the router, they can execute swaps bypassing bonding contract checks (trading status, launchExecuted, deadline).

---

## Root Cause Analysis

### Price Manipulation
- **Why This Happens**: Reserves in `FPairV2` are maintained as internal state, not derived from `balanceOf`. The router computes output amounts from these internal reserves and then calls `swap()` to update them. Any divergence between actual token balances and stored reserves (e.g., direct token sends to the pair, failed syncAfterDrain) creates exploitable price discrepancies.
- **What to Look For**: 
  - Direct ERC20 transfers to `FPairV2` address (not through router) that inflate balances without updating reserves
  - `drainPrivatePool` without subsequent `syncAfterDrain` (backward compat try-catch)
  - `getAmountsOut` called with stale `k` (k is only updated in `mint()` and `syncAfterDrain`, not in `swap()`)

### Graduation Condition Manipulation
- **Why This Happens**: Graduation is triggered inside `_buy()` based on `newReserveA <= gradThreshold`. `newReserveA` is calculated from the pre-buy reserve minus `amount0Out` (from router.buy return value). Since actual reserve update happens in `pair.swap()` (called inside router), there is a window where local `newReserveA` and stored reserves can diverge if the buy fails mid-way.
- **What to Look For**:
  - Artificial reduction of `reserveA` without actual buys (e.g., via `drainPrivatePool` on the bonding curve token itself)
  - Graduation triggered while anti-sniper tax is active (currently blocked by check, but any bypass of `hasAntiSniperTax` enables premature graduation)
  - `tokenGradThreshold[token]` in BondingV5 is set at preLaunch and never updated; if `bondingConfig` parameters change after launch, existing token thresholds are unaffected (safe), but newly created tokens get new thresholds.

### Anti-Sniper Tax Bypass
- **Why This Happens**: FRouterV3 reads anti-sniper type via `bondingV5.tokenAntiSniperType(tokenAddress)`. If `bondingV5` address is not set, this call will fail silently (no try-catch in V3's `_calculateAntiSniperTax`), causing a revert and effectively blocking all buys.
- **What to Look For**:
  - Tokens created before V5 but traded through V3 router (tokenAntiSniperType reverts for non-V5 tokens with `InvalidTokenStatus`)
  - FRouterV2 backward compat: uses try-catch for `pair.taxStartTime()` — if old pair, falls back to `startTime=0` meaning anti-sniper tax starts from epoch 0 → `timeElapsed` is huge → tax = 0 for all old pairs (anti-sniper bypassed for legacy pairs in V2 router)

---

## Solodit Findings (Top Matches)
[MCP: UNAVAILABLE — unified-vuln-db not found in available tools; entries below are synthesized from code patterns and known vulnerability classes]

| Title | Protocol Type | Severity | Key Pattern |
|---|---|---|---|
| Virtual reserve desync allows price oracle manipulation | Bonding Curve AMM | High | Internal reserve != balanceOf; `syncAfterDrain` skipped on legacy pairs |
| Graduation triggered with drained pool assets | Launchpad Bonding | High | drainPrivatePool → graduation → zero asset transfer to agentFactory |
| Anti-sniper tax permanently blocks graduation | Launchpad | Medium | taxStartTime not set on old pairs; anti-sniper never expires |
| cancelLaunch event emits zeroed initialPurchase | Launchpad | Low | State zeroed before event emission (BondingV2/V3/V4) |
| Initial purchase with amountOutMin=0 | Launchpad | Medium | launch() → _buy(..., 0, ...) — no slippage protection on creator buy |
| Predictable graduation salt enables front-running | Launchpad | Medium | `keccak256(abi.encodePacked(msg.sender, block.timestamp, token))` |
| EXECUTOR_ROLE over-privilege in router | Access Control | High | Any EXECUTOR_ROLE holder bypasses all bonding contract guards |
| drainUniV2Pool with amountAMin=0 causes sandwich loss | Liquidity Drain | Medium | No slippage protection in privileged UniV2 drain |
| `k` not verified post-swap in FPairV2 | AMM Invariant | High | Pair trusts router completely; no k-check after swap() |
| preLaunch reverts in V2/V3/V4 — dead code after revert | Dead Code | Info | `revert("Not implemented")` followed by unreachable logic |

---

## Questions for Analysis Agents

1. **Graduation with drained pool**: Can an EXECUTOR call `drainPrivatePool()` on a non-Project60days token (bypassing the check via a different code path), then trigger graduation via a buy, resulting in graduation with zero asset backing?
2. **Anti-sniper bypass for legacy pairs**: In FRouterV2, when `taxStartTime()` reverts on old pairs and the fallback `taxStartTime = 0` is used, does `_calculateAntiSniperTax` return 0 for all legacy pairs, effectively disabling anti-sniper protection?
3. **`k` staleness**: `FPairV2._pool.k` is only updated in `mint()` and `syncAfterDrain()`, NOT in `swap()`. This means after every swap, `k` remains constant (by design for constant-product), but after a drain without sync, `k` is stale relative to actual reserves. Does this create an exploitable arbitrage via `getAmountsOut`?
4. **BondingV5 `preLaunch` vs `launch` authorization**: `preLaunch` for X_LAUNCH/ACP_SKILL requires `isPrivilegedLauncher`. `launch()` also requires it for these modes. Can a non-privileged user call `launch()` for a token pre-launched by a privileged user, and what happens?
5. **`syncAfterDrain` try-catch**: If `drainPrivatePool` is called on an old `FPairV2` (without `syncAfterDrain`), the reserves remain at their pre-drain values. What is the impact on subsequent `getAmountsOut` calls and graduation?
6. **Fee calculation with 100% tax scenario**: If `buyTax + antiSniperTax > 99`, the code caps `antiSniperTax = 99 - normalTax`. But `normalTax` itself is stored as a percentage and can theoretically be set to 99 by ADMIN_ROLE. What happens when `buyTax = 99`?
7. **cancelLaunch does not set `trading = false`** (BondingV2/V3/V4): After cancel, `trading` remains `true` and `launchExecuted = true`. Both `buy()` and `sell()` check `launchExecuted` first and revert. But what if `launchExecuted` is checked first and `trading` second? Is there any path where a cancelled token's pair can still be traded?
8. **`isFeeDelegation` flag in BondingV5**: The `isFeeDelegation` mapping is stored per token but never consumed anywhere in the contract code. Is this used by an off-chain backend only, or is it an incomplete feature that should gate fee behavior on-chain?
9. **`_openTradingOnUniswap` salt predictability**: The salt `keccak256(abi.encodePacked(msg.sender, block.timestamp, tokenAddress))` is used in `executeBondingCurveApplicationSalt`. Since `msg.sender` at graduation is the bonding contract and `block.timestamp` is known, can an attacker predict the salt and front-run the TBA/agent token deployment?
10. **FRouterV3 `_calculateAntiSniperTax` reverts for non-V5 tokens**: If `bondingV5.tokenAntiSniperType(tokenAddress)` reverts (token not in V5), the entire `buy()` call in FRouterV3 reverts. Are there any non-V5 tokens expected to use FRouterV3/FFactoryV3?

---

## Code Patterns to Grep

```
# Reserve accounting
getReserves          - check callers; verify vs balanceOf divergence
syncAfterDrain       - check if called after every drain; try-catch silencing
kLast                - k is stale after drain without sync
assetBalance         - uses balanceOf directly; compare with _pool.reserve1

# Graduation logic
graduation           - entry points to _openTradingOnUniswap
gradThreshold        - per-token (V5) vs global (V2-V4); manipulation surface
newReserveA          - calculated off-chain before swap; race condition window
_openTradingOnUniswap - ensure not re-enterable; check trading flag update order

# Anti-sniper tax
taxStartTime         - set in launch(); try-catch fallback path
hasAntiSniperTax     - graduation gate; bypass via legacy pair fallback
_calculateAntiSniperTax - legacy pair returns 0 via fallback; V3 reverts for non-V5

# Access control
EXECUTOR_ROLE        - who holds this? bonding contract only?
isPrivilegedLauncher - backend wallets; can any user be added accidentally?
CREATOR_ROLE         - only bonding contracts; factory pair creation

# Fee handling
buyTax               - stored as percentage; division by 100 (precision loss)
sellTax              - same; check for 0 tax edge case
normalTxFee          - rounding down means protocol takes slightly less
antiSniperTxFee      - separate vault; no on-chain attribution

# Liquidity drain
drainPrivatePool     - isProject60days check; syncAfterDrain try-catch
drainUniV2Pool       - amountAMin=0, amountBMin=0; founder balance drain
isProject60days      - mapping in BondingV2/V4; function in BondingV5

# State consistency
launchExecuted       - set true on launch AND cancel; used to block re-launch
trading              - NOT set false on cancelLaunch in V2/V3/V4 (BondingV5 DOES set it)
tradingOnUniswap     - set in graduation; never reset

# Token supply math
bondingCurveSupply   - (initialSupply - reservedSupply) * decimals
calculateBondingCurveSupply - bips validation; totalReserved check
calculateGradThreshold - per-token in V5; static in V2-V4

# Salt predictability
executeBondingCurveApplicationSalt - keccak(msg.sender, block.timestamp, token)
keccak256.*block.timestamp  - predictable salt inputs

# isFeeDelegation
isFeeDelegation      - stored but never consumed in V5; off-chain flag only?
```

---

## Version Differences Summary (Critical for Audit Scoping)

| Feature | V2 | V3 | V4 | V5 |
|---|---|---|---|---|
| preLaunch active | No (reverts) | No (reverts) | No (reverts) | YES |
| Per-token gradThreshold | No (global) | No (global) | No (global) | YES |
| Anti-sniper type | 60s/99min (binary) | 60s/99min (binary) | 60s/99min + X_LAUNCH 99s | NONE/60S/98M (configurable) |
| Privileged launcher check in launch() | No | No | No | YES (for X/ACP/60d) |
| trading=false on cancel | No | No | No | YES |
| On-chain tax attribution | No | No | No | YES (AgentTax.depositTax) |
| isFeeDelegation flag | No | No | No | YES (stored, not enforced) |
| cancelLaunch event bug (emits 0) | YES | YES | YES | No (records before zeroing) |
| BondingConfig external | No | No | No | YES |

---

## Key Addresses / Roles to Verify in Deployment

- `EXECUTOR_ROLE` on FRouterV2 / FRouterV3: should only be BondingV2-V5 contracts
- `CREATOR_ROLE` on FFactoryV2 / FFactoryV3: should only be BondingV5 (and possibly V2-V4 if still active)
- `isPrivilegedLauncher` in BondingConfig: should be tightly controlled backend wallets
- `teamTokenReservedWallet`: receives all reserved tokens (550M+); compromise = full token supply capture
- `taxVault` / `antiSniperTaxVault`: fee recipients; must be trusted contracts
- `agentFactory`: receives graduation asset funds; trusted contract critical

---

## Fork Ancestry Analysis

**Agent:** Recon Agent 1B
**Date:** 2026-04-02

### 1. Declared Fork Origin

All BondingV2-V5 contracts contain the header:
```
// Modified from https://github.com/sourlodine/Pump.fun-Smart-Contract/blob/main/contracts/PumpFun.sol
```

This identifies the codebase as a **Pump.fun EVM fork** by sourlodine. Pump.fun is originally a Solana-based bonding curve launchpad; sourlodine created an EVM port that Virtuals Protocol then modified extensively.

### 2. Fork Pattern Detection

#### Pump.fun Bonding Curve Patterns (PRESENT)
- Constant-product AMM with virtual reserves: **YES** -- FPairV2 implements `x * y = K` with virtual asset liquidity
- Two-phase lifecycle (bonding curve -> DEX migration): **YES** -- preLaunch/launch -> graduation to Uniswap V2
- Creator initial purchase: **YES** -- creator's buy during launch() with tax exemption
- Graduation threshold: **YES** -- `gradThreshold` / `tokenGradThreshold` triggers `_openTradingOnUniswap`
- Fee/tax system: **YES** -- buy/sell tax with anti-sniper decay

#### Uniswap V2 Pair Patterns (in MockUniswapV2Pair only)
- `getReserves()`, `token0`, `token1`: **PRESENT** in MockUniswapV2Pair (44 occurrences across 10 files)
- `MINIMUM_LIQUIDITY`: **PRESENT** in MockUniswapV2Pair only (returns 1000)
- `_update`, `_mintFee`: **PRESENT** in MockUniswapV2Pair (faithful Uniswap V2 implementation)
- `addLiquidity`, `removeLiquidity`, `swapExactTokensForTokens`: **PRESENT** in MockUniswapV2Router02 only (14 occurrences, 2 files -- all mocks)

#### FPairV2 is NOT a Uniswap V2 Fork
FPairV2 is a custom simplified AMM. It shares the `getReserves()` interface but:
- No LP tokens
- No K invariant verification in `swap()`
- No flash loan support
- No price oracle
- Router-controlled via `onlyRouter` (not permissionless)
- Virtual liquidity (reserves can exceed actual balances)

### 3. Known Pump.fun Fork Vulnerabilities (Web Research)

#### 3.1 Flash Loan Exploit (May 2024)
**Source:** [BeInCrypto](https://beincrypto.com/pump-fun-solana-exploitation-former-employee/), [The Block](https://www.theblock.co/post/294959/solana-token-launcher-pump-fun-suffers-flash-loan-exploit)

An attacker used flash loans to buy all tokens of new projects, pushing bonding curves to their limits and preventing normal DEX listing. Loss: ~12,300 SOL (~$2M).

**Relevance to Virtuals:** The Virtuals implementation has no flash loan integration in FPairV2 and uses `nonReentrant` guards. However, the same attack pattern (buying enough to trigger graduation) is possible with sufficient capital. The anti-sniper tax gate (`!router.hasAntiSniperTax(pairAddress)`) is a mitigation that Pump.fun lacked.

#### 3.2 Token Decimal Handling
**Source:** [Medium - Lessons from Auditing a Pump.fun Clone](https://medium.com/@mahitman1/lessons-from-auditing-a-pump-fun-clone-4c8a890d536a)

Pump.fun clones often hardcode `TOKEN_DECIMALS`, failing to account for varying decimal places. This causes incorrect pool amounts.

**Relevance to Virtuals:** The Virtuals implementation uses `IAgentTokenV2(token).decimals()` dynamically in bonding curve supply calculation (e.g., `bondingCurveSupply * (10 ** IAgentTokenV2(token).decimals())`). This is a **correct mitigation** of the known decimal handling issue. However, the `MockERC20Decimals` contract exists specifically for testing non-18-decimal tokens.

#### 3.3 Virtual Reserve Price Manipulation
**Source:** Web research on bonding curve virtual reserves

Virtual reserves (synthetic state variables for pricing, not backed by real tokens) create a fundamental trust assumption: the price derived from virtual reserves is artificial until real liquidity accumulates. An attacker who can manipulate when graduation occurs (e.g., by front-running the graduation buy) can profit from the price discontinuity between bonding curve pricing and real Uniswap V2 pricing.

**Relevance to Virtuals:** The `fakeInitialVirtualLiq` in BondingConfig is the virtual reserve seed. The graduation threshold formula `gradThreshold = fakeInitialVirtualLiq * bondingCurveSupply / (targetRealVirtual + fakeInitialVirtualLiq)` determines when the curve "fills up." An attacker who knows these parameters can calculate the exact buy amount needed to trigger graduation and position trades accordingly.

### 4. Divergences from Parent (sourlodine Pump.fun EVM)

| Feature | sourlodine PumpFun (inferred) | Virtuals LaunchpadV2 |
|---------|------------------------------|---------------------|
| AMM implementation | Single contract (PumpFun.sol) | Separated into Bonding + Factory + Router + Pair |
| Token model | Simple ERC20 | AgentToken with blacklist, tax, LP pool management |
| Graduation target | Fixed K constant | Per-token via BondingConfig (V5) |
| Anti-sniper | Not present (inferred) | Linear decay tax (99%->0% over configurable duration) |
| Access control | Basic owner | Role-based (EXECUTOR, CREATOR, ADMIN, PRIVILEGED_LAUNCHER) |
| Virtual liquidity | Basic K calculation | Configurable `fakeInitialVirtualLiq` and `targetRealVirtual` |
| Pre-launch phase | Not present | Two-phase: preLaunch + launch with scheduled start times |
| Cancel mechanism | Not present | `cancelLaunch()` with refund |
| Tax attribution | Not present | On-chain via AgentTaxV2 (V5) |
| Multi-chain config | Not present | BondingConfig external contract |
| Launch modes | Single mode | NORMAL, X_LAUNCH, ACP_SKILL + Project60days flag |
| Liquidity drain | Not present | drainPrivatePool + drainUniV2Pool for Project60days |

### 5. Uniswap V2 Vulnerability Mitigations

| Known Uniswap V2 Vulnerability | Present in FPairV2? | Notes |
|-------------------------------|--------------------|----|
| Reentrancy in swap | N/A -- FPairV2 does not use balance-based K check | FPairV2 uses `onlyRouter` + `ReentrancyGuard` |
| First depositor LP manipulation | N/A -- No LP tokens | FPairV2 has no LP token system |
| Oracle manipulation via flash loans | N/A -- No TWAP oracle | FPairV2 has no price oracle |
| `skim()` / `sync()` abuse | N/A -- Not implemented | FPairV2 has `syncAfterDrain` for explicit drain operations only |
| K invariant violation | **RISK** -- FPairV2 does NOT verify K after swap | Router is solely responsible for correct amounts; pair trusts router |
| Price manipulation via direct token transfer | **RISK** -- `balance()` / `assetBalance()` use `balanceOf` | Graduation reads actual balances, not reserves; unsolicited transfers captured |

### 6. Summary

The Virtuals LaunchpadV2 is a **heavily modified Pump.fun EVM fork** with:
- **Significant architectural improvements**: separation of concerns (Bonding/Factory/Router/Pair), role-based access control, configurable parameters via BondingConfig
- **Novel features**: anti-sniper tax, two-phase launch, per-token graduation thresholds, on-chain tax attribution, multiple launch modes
- **Inherited risks**: virtual reserve price discontinuity at graduation, K invariant not enforced in custom pair (shifted from pair to router), graduation triggerable by any sufficiently large buy
- **Mitigations present**: ReentrancyGuard throughout, dynamic decimal handling, anti-sniper tax gates graduation, privileged launcher requirements for special modes
- **Mitigations absent**: No K invariant check in FPairV2.swap(), no protection against unsolicited token transfers to pair, graduation salt is predictable

Web search sources:
- [BeInCrypto: Pump.fun Flash Loan Exploit](https://beincrypto.com/pump-fun-solana-exploitation-former-employee/)
- [The Block: Pump.fun Flash Loan Exploit](https://www.theblock.co/post/294959/solana-token-launcher-pump-fun-suffers-flash-loan-exploit)
- [Medium: Lessons from Auditing a Pump.fun Clone](https://medium.com/@mahitman1/lessons-from-auditing-a-pump-fun-clone-4c8a890d536a)
- [99Bitcoins: What is Virtuals Protocol](https://99bitcoins.com/cryptocurrency/virtuals-protocol/)
- [Flashift: Pump.fun Bonding Curve Mechanics](https://flashift.app/blog/bonding-curves-pump-fun-meme-coin-launches/)
