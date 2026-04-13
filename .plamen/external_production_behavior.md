# External Contract Verification: LaunchpadV2

**Agent:** Recon Agent 1B
**Date:** 2026-04-02
**Source:** Code analysis of contracts/launchpadv2/ mock contracts and production interfaces

---

## 1. Mock Contract Inventory

All external dependencies in the test/dev environment use mock contracts. **No hardcoded production addresses were found in the launchpadv2 contract source code.** Production addresses are injected via environment variables at deployment time.

### Known Deployed Addresses (Base Sepolia testnet, from AUDIT_SUMMARY_V2.md)

| Contract | Address | Network |
|----------|---------|---------|
| BondingV5 | `0x2eB4313e3047845FD07315A51003F1f440780cdD` | Base Sepolia |
| AgentTaxV2 | `0xC7475Af17c2041f4e3a027F9840623054ae5FC36` | Base Sepolia |
| FRouterV3 | `0x2c224aC500927B8a583799bfe1e35AA68983CE10` | Base Sepolia |
| VIRTUAL Token | `0xbfAB80ccc15DF6fb7185f9498d6039317331846a` | Base Sepolia |
| Anti-Sniper Vault | `0x6EB12855a21564A1aC4aD0674e032A88e757570C` | Base Sepolia |

**Note:** These are testnet addresses. No mainnet production addresses were found in the codebase.

[MCP: SKIPPED] -- No MCP calls to evm-chain-data or farofino attempted as no mainnet production addresses are available to verify.

---

## 2. Mock vs Production Behavioral Differences

### 2.1 MockUniswapV2Factory
**File:** `contracts/launchpadv2/MockUniswapV2Factory.sol`
**Status:** MOCK: production behavior UNVERIFIED

| Aspect | Mock Behavior | Real Uniswap V2 Factory |
|--------|--------------|------------------------|
| Pair creation | Deploys `MockUniswapV2Pair` with extra params (startTime, startTimeDelay) | Deploys actual UniswapV2Pair via CREATE2 with init code hash |
| Token ordering | Sorts token0/token1 by address | Same |
| Duplicate pair check | Yes | Yes |
| feeTo/feeToSetter | Implemented | Same interface |

**Risk:** The mock factory creates `MockUniswapV2Pair` which has different math from production. Tests against this mock do NOT validate real Uniswap behavior.

### 2.2 MockUniswapV2Router02
**File:** `contracts/launchpadv2/MockUniswapV2Router02.sol`
**Status:** MOCK: production behavior UNVERIFIED

| Aspect | Mock Behavior | Real Uniswap V2 Router |
|--------|--------------|----------------------|
| `addLiquidity()` | Returns desired amounts as-is, `liquidity = amountA + amountB` | Calculates optimal amounts, mints LP tokens based on reserves |
| `removeLiquidity()` | Returns `liquidity / 2` for both tokens | Pro-rata burn of LP tokens based on pool reserves |
| `swapExactTokensForTokens()` | 1:1 swap (no price impact, no fees) | Full constant-product formula with 0.3% fee |
| `getAmountsOut()` | 1:1 amounts (no price impact) | Applies constant-product formula with fee |
| `*SupportingFeeOnTransferTokens()` | No-ops | Handles deflationary/fee-on-transfer tokens |

**Critical Differences:**
1. **No actual token transfers in mock router** -- real router moves tokens via `transferFrom`
2. **No slippage calculation** -- mock returns exact amounts, real router may revert on slippage
3. **No LP token minting** -- mock returns synthetic liquidity value
4. **No deadline enforcement** in mock (no `require(deadline >= block.timestamp)`)

**Risk:** Post-graduation liquidity addition via real Uniswap V2 Router could behave differently than tests suggest. Slippage, LP token accounting, and fee-on-transfer token handling are completely untested with mocks.

### 2.3 MockUniswapV2Pair
**File:** `contracts/launchpadv2/MockUniswapV2Pair.sol`
**Status:** MOCK: production behavior UNVERIFIED

| Aspect | Mock Behavior | Real Uniswap V2 Pair |
|--------|--------------|---------------------|
| `swap()` | Full K invariant check with 0.3% fee | Same (this mock is relatively faithful) |
| `mint()` | MINIMUM_LIQUIDITY = 1000 locked | Same |
| `burn()` | Pro-rata calculation | Same |
| `_mintFee()` | Protocol fee calculation present | Same |
| `_update()` | Price oracle (cumulative price) implemented | Same |
| `resetTime()` | **ADDED** -- not in real Uniswap V2 | Does not exist |
| `skim()` / `sync()` | Implemented | Same |

**Notable:** This mock is a near-complete Uniswap V2 Pair implementation. It includes the K invariant check, the 0.3% swap fee, TWAP oracle, and protocol fee logic. However, it adds `resetTime()` and `startTime`/`startTimeDelay` fields that do not exist in the real pair.

**Risk:** The mock pair is used for graduation testing. The real Uniswap V2 pair will NOT have `resetTime()` -- this is only used in FPairV2 (the custom bonding curve pair), not the post-graduation Uniswap pair.

### 2.4 MockAgentToken
**File:** `contracts/launchpadv2/MockAgentToken.sol`
**Status:** MOCK: production behavior UNVERIFIED

| Aspect | Mock Behavior | Real AgentToken (V2/V3) |
|--------|--------------|----------------------|
| `initialize()` | Mints `maxSupply` to vault address | Real token has complex supply params: lpSupply, vaultSupply, projectTaxBasisPoints, etc. |
| Transfer restrictions | None (standard ERC20) | Real token has blacklist, tax-on-transfer, swap threshold, valid caller checks |
| `liquidityPools()` | Manual array managed by owner | Same interface but integrated with Uniswap pool detection |
| Tax mechanism | No tax on transfers | Real token applies projectBuyTaxBasisPoints / projectSellTaxBasisPoints |
| `distributeTaxTokens()` | No-op | Real token swaps accumulated tax tokens |

**Critical Differences:**
1. **No transfer tax in mock** -- real AgentToken applies buy/sell tax basis points on LP pool transfers
2. **No blacklist enforcement in mock beyond manual mapping** -- real token has sophisticated blacklist tied to AgentFactory
3. **No valid caller restrictions** -- real token restricts certain operations to whitelisted contract hashes

**Risk:** The mock does not replicate the tax-on-transfer behavior of real AgentTokens. This means tests do NOT validate how bonding curve buys/sells interact with the token's own transfer tax. In production, the AgentToken's transfer tax could reduce the actual amount received, affecting graduation threshold calculations.

### 2.5 MockAgentVeToken
**File:** `contracts/launchpadv2/MockAgentVeToken.sol`
**Status:** MOCK: production behavior UNVERIFIED

| Aspect | Mock Behavior | Real AgentVeTokenV2 |
|--------|--------------|-------------------|
| `initialize()` | Mints 1M tokens to founder | Real veToken manages LP token staking |
| `stake()` | Simple transferFrom + mint | Real has maturity checks, delegation, LP pair management |
| `withdraw()` | Simple burn + transfer back | Real has time-lock, maturity enforcement |
| Transfer | Freely transferable | Real veToken may be non-transferable |

**Risk:** The drain functions (`drainUniV2Pool`) rely on `veTokenContract.founder()` and `IERC20(veToken).balanceOf(founder)`. If the real veToken has transfer restrictions or maturity locks, the drain may behave differently.

### 2.6 MockAgentDAO
**File:** `contracts/launchpadv2/MockAgentDAO.sol`
**Status:** MOCK: production behavior UNVERIFIED

Minimal mock. Only used during token creation via AgentFactory. Does not affect trading or graduation logic.

### 2.7 MockERC6551Registry
**File:** `contracts/launchpadv2/MockERC6551Registry.sol`
**Status:** MOCK: production behavior UNVERIFIED

| Aspect | Mock Behavior | Real ERC-6551 Registry |
|--------|--------------|----------------------|
| `createAccount()` | Generates deterministic address from hash | Creates actual contract via CREATE2 |
| `account()` | Returns stored address | Computes CREATE2 address deterministically |

**Risk:** Mock creates fake addresses that are not actual contracts. In production, these addresses are real TBA contracts that can hold assets and execute transactions.

---

## 3. Token Transferability Analysis

### Can tokens be sent TO the protocol unsolicited?

| Contract | Token Type | Unsolicited Transfer Possible? | Impact |
|----------|-----------|-------------------------------|--------|
| **FPairV2** | Agent Token (tokenA) | YES -- anyone can transfer ERC20 tokens to the pair | `balance()` uses `balanceOf(address(this))` -- unsolicited tokens would inflate the real balance but NOT change reserves. Graduation uses `pair.balance()` not reserves. **RISK: unsolicited agent token transfers could inflate `tokenBalance` read during graduation, causing more tokens than expected to be sent to the token contract.** |
| **FPairV2** | Asset Token (tokenB) | YES -- anyone can transfer VIRTUAL to the pair | `assetBalance()` uses `balanceOf(address(this))` -- unsolicited VIRTUAL would inflate the real balance. Graduation uses `pair.assetBalance()`. **RISK: unsolicited VIRTUAL could inflate `assetBalance` read during graduation, causing more VIRTUAL than expected to be sent to AgentFactory.** |
| **BondingV5** | Any ERC20 | YES | BondingV5 holds tokens temporarily during preLaunch. Unsolicited tokens would be ignored since the contract uses specific token addresses from tokenInfo. |
| **FRouterV2/V3** | Asset Token | Transient -- router does not hold tokens long-term | Router transfers tokens in the same transaction. Unsolicited tokens could be swept by a subsequent trade. |

### Key Finding: FPairV2 `balance()` vs `getReserves()` Divergence

The pair tracks reserves internally (`_pool.reserve0`, `_pool.reserve1`) but `balance()` and `assetBalance()` read actual `balanceOf`. During graduation, `_openTradingOnUniswap()` reads:
- `pair.assetBalance()` -- actual VIRTUAL balance (could be inflated by unsolicited transfers)
- `pair.balance()` -- actual agent token balance (could be inflated)

These values are used to determine how much to transfer to AgentFactory and to the token contract. If someone sends extra tokens to the pair before graduation, more tokens/VIRTUAL than expected would be transferred.

**However:** The virtual liquidity design means reserve1 (VIRTUAL) starts at 0 actual balance but a high virtual value. As users buy, actual VIRTUAL enters. The `assetBalance()` reading during graduation would equal the sum of all real VIRTUAL sent by buyers minus the VIRTUAL paid out to sellers. Unsolicited VIRTUAL donations would be captured during graduation.

---

## 4. FPairV2 (Custom Pair) vs Uniswap V2 Pair

**FPairV2 is NOT a Uniswap V2 fork.** It is a simplified custom AMM pair:

| Feature | FPairV2 | Uniswap V2 Pair |
|---------|---------|-----------------|
| K invariant | Set once at mint, unchanged during swaps | Checked per-swap via balance comparison |
| Swap execution | Router calculates amounts, pair just updates reserves | Pair validates K invariant after transfer |
| Token transfers | Via `transferTo`/`transferAsset` called by router | Direct transfer + balance check in swap |
| LP tokens | None | ERC20 LP tokens |
| Flash loans | Not supported | Supported via callback |
| Price oracle | None | TWAP via cumulative prices |
| Fee handling | External (router deducts tax before pair sees tokens) | 0.3% built into K check |
| Access control | `onlyRouter` | Anyone can call swap (with K check) |
| Virtual liquidity | Yes (reserve1 can exceed actual balance) | No (reserves track actual balances) |

**Critical Architectural Difference:** FPairV2 trusts the router completely. There is no K invariant check in `swap()` -- the router is solely responsible for calculating correct amounts. If the router has a bug or is compromised, the pair offers no protection.

---

## 5. Known Production Address References (from scripts)

| Source | Address | Network | Purpose |
|--------|---------|---------|---------|
| `handle_buy_sell.ts` | `0xF940345C...` | Base Sepolia | BondingV5 (inferred) |
| `handle_buy_sell.ts` | `0x02b6d8a1...` | ETH Sepolia | BondingV5 (inferred) |
| `handle_buy_sell.ts` | `0x6B9048DF...` | BSC Testnet | BondingV5 (inferred) |
| `batch_swap_tax.ts` | `0xD972075b...` | Unknown | Token address for batch swap |

All found addresses are testnet. No mainnet production addresses discovered in the codebase.
