# Attack Surface Discovery

## External Dependencies

### 1. IAgentFactoryV6 / IAgentFactoryV7Minimal
- **Identity**: Agent Factory (Virtuals Protocol) - creates agent tokens and manages applications
- **Type**: Protocol-owned external contract
- **Interaction Points**:
  - `createNewAgentTokenAndApplication()` - BondingV2.sol:284, V3:224, V4:289, V5:331
  - `addBlacklistAddress()` - BondingV2.sol:307, V3:246, V4:312, V5:354
  - `removeBlacklistAddress()` - BondingV2.sol:641, V3:576, V4:648, V5:737
  - `updateApplicationThresholdWithApplicationId()` - BondingV2.sol:634, V3:569, V4:641, V5:731
  - `executeBondingCurveApplicationSalt()` - BondingV2.sol:652, V3:587, V4:659, V5:748
  - `removeLpLiquidity()` - FRouterV2.sol:480, FRouterV3.sol:466
- **Token Nature**: Creates ERC20 agent tokens
- **Return-Value Tokens**: Returns (address token, uint256 applicationId) and later (address agentToken)
- **Side Effects**: Creates new tokens, modifies application state, manages blacklists, removes LP liquidity
- **State Coupling**: tokenInfo[token].applicationId, tokenInfo[token].agentToken

### 2. IAgentTokenV2
- **Identity**: Agent Token - ERC20 with LP pool management
- **Type**: ERC20 token created by AgentFactory
- **Interaction Points**:
  - `liquidityPools()` - BondingV2.sol:309, V3:248, V4:314, V5:356, V5:739
  - `decimals()` - BondingV2.sol:314, V3:253, V4:319, V5:361,385
- **Token Nature**: ERC20, can be transferred unsolicited
- **Return-Value Tokens**: No
- **Side Effects**: None from view calls
- **State Coupling**: Bonding curve supply calculation depends on decimals()

### 3. IAgentVeTokenV2
- **Identity**: Staked LP token for agent tokens
- **Type**: Staking receipt token
- **Interaction Points**:
  - `assetToken()` - FRouterV2.sol:455, FRouterV3.sol:441
  - `founder()` - FRouterV2.sol:471, FRouterV3.sol:457
- **Token Nature**: Receipt/staking token
- **Side Effects**: None from view calls
- **State Coupling**: Used in drainUniV2Pool to get LP pair and founder balance

### 4. IUniswapV2Pair (standard UniV2)
- **Identity**: Uniswap V2 LP pair (post-graduation)
- **Type**: Standard DEX LP pair
- **Interaction Points**:
  - `token0()`, `token1()` - FRouterV2.sol:457-458, FRouterV3.sol:443-444
- **Token Nature**: ERC20 LP token
- **Side Effects**: None from view calls
- **State Coupling**: Validates token-pair matching for drain operations

### 5. IBondingTax / IAgentTaxForRouter
- **Identity**: Tax management contracts
- **Type**: Fee distribution contract
- **Interaction Points**:
  - `depositTax(tokenAddress, amount)` - FRouterV3.sol:167,210
  - `registerToken(tokenAddress, tba, creator)` - BondingV5.sol:445
- **Token Nature**: Receives asset tokens (tax)
- **Side Effects**: Tax deposit updates attribution state, token registration
- **State Coupling**: Tax attribution per token

### 6. IERC20 (asset token - $VIRTUAL)
- **Identity**: Base asset token used for purchases
- **Type**: Standard ERC20
- **Interaction Points**: safeTransferFrom/safeTransfer throughout all contracts
- **Token Nature**: ERC20, can be transferred unsolicited to any contract
- **Side Effects**: Standard ERC20 transfers
- **State Coupling**: FPairV2.assetBalance() depends on actual balanceOf

### 7. BondingConfig
- **Identity**: Configuration contract for BondingV5
- **Type**: Protocol-owned upgradeable config store
- **Interaction Points**:
  - `calculateBondingCurveSupply()` - BondingV5.sol:252
  - `calculateLaunchFee()` - BondingV5.sol:302
  - `calculateGradThreshold()` - BondingV5.sol:390
  - `getFakeInitialVirtualLiq()` - BondingV5.sol:376
  - Various getters for params
- **Side Effects**: Pure/view functions only
- **State Coupling**: All BondingV5 economic parameters sourced from here

### 8. IFFactoryV2Minimal / FFactoryV2 / FFactoryV3
- **Identity**: Pair factory
- **Type**: Protocol-owned
- **Interaction Points**:
  - `createPair()` - Bonding contracts
  - `getPair()` - Router contracts
  - `taxVault()`, `buyTax()`, `sellTax()`, `antiSniperBuyTaxStartValue()`, `antiSniperTaxVault()` - Router contracts
- **Side Effects**: Creates new FPairV2 contracts
- **State Coupling**: Tax parameters, pair registry

---

## Token Flow Matrix (MANDATORY)

| Token | Type | Entry Functions | State Tracking | Accounting Queries Affected? | Unsolicited Transfer? | Side-Effect? | Return-Value? |
|-------|------|----------------|----------------|------------------------------|----------------------|--------------|---------------|
| Asset Token ($VIRTUAL) | ERC20 | buy(), preLaunch(), launch() | FPairV2._pool.reserve1 (virtual), FPairV2.assetBalance() (real) | YES: getAmountsOut(), getReserves() diverge from assetBalance() if unsolicited | YES - can send to FPairV2 directly | Tax routing on buy/sell | NO |
| Agent Token (pre-grad) | ERC20 | preLaunch() creates, buy() removes from pair | FPairV2._pool.reserve0 (virtual), FPairV2.balance() (real) | YES: getAmountsOut(), getReserves() diverge from balance() if unsolicited | YES - can send to FPairV2 directly | Graduation trigger when reserve drops below threshold | NO |
| Agent Token (post-grad) | ERC20 | executeBondingCurveApplicationSalt() | tokenInfo[].agentToken | N/A (graduated) | YES | N/A | YES (returned from executeBondingCurveApplicationSalt) |
| LP Token (UniV2) | ERC20 | Post-graduation via AgentFactory | veToken balance | drainUniV2Pool amount | YES | removeLpLiquidity side effects | NO |
| Tax (portion of Asset) | ERC20 | buy(), sell() | None in protocol | N/A | N/A | depositTax() on AgentTax | NO |

### Critical Token Flow Observations

1. **Virtual vs Real Liquidity Mismatch**: FPairV2 tracks reserves virtually in `_pool.reserve1` (asset) but actual asset tokens arrive through transfers. The `addInitialLiquidity()` function only transfers agent tokens to the pair but sets `reserve1` (asset reserve) virtually via `mint()`. This means `assetBalance()` (real) starts at 0 while `reserve1` (virtual) starts at the configured fake liquidity amount. This is by design but means:
   - `getReserves()` returns virtual reserves
   - `assetBalance()` returns real balances
   - The bonding curve math uses virtual reserves for pricing
   - Graduation uses real balances for asset transfer

2. **Unsolicited Transfer Impact**: Sending asset tokens directly to FPairV2 would increase `assetBalance()` without changing `_pool.reserve1`. This affects:
   - `assetBalance()` used in `_openTradingOnUniswap()` for graduation asset transfer
   - Could cause more assets to be transferred to AgentFactory than expected during graduation
   - Does NOT affect pricing (which uses virtual reserves)

3. **Unsolicited Agent Token Transfer Impact**: Sending agent tokens directly to FPairV2 would increase `balance()` without changing `_pool.reserve0`. This affects:
   - `balance()` used in `_openTradingOnUniswap()` for token transfer during graduation
   - Could cause more tokens to be sent to the graduated token contract

---

## Signal Elevation Tags Summary

| Tag | Contract | Evidence |
|-----|----------|---------|
| [ELEVATE:STORAGE_LAYOUT] | BondingV2-V5, BondingConfig, FFactoryV2/V3, FRouterV2/V3 | All use upgradeable proxy pattern with Initializable |
| [ELEVATE:SINGLE_ENTRY] | BondingV2-V5 | `mapping(address => Token) tokenInfo` - single entry per token, no versioning |
| [ELEVATE:FORK_ANCESTRY:Pump.fun] | BondingV2-V5 | Explicitly noted in source: "Modified from Pump.fun-Smart-Contract" |
| [ELEVATE:BRANCH_ASYMMETRY] | FRouterV2/V3 | buy() has 2 tax calculations + anti-sniper logic; sell() has 1 simple tax. Asymmetric risk. |
| [ELEVATE:INLINE_ASSEMBLY] | multicall3.sol | assembly blocks in aggregate3() and aggregate3Value() |
