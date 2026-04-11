# Dimensional Analysis Findings — VP Launchpad Suite

**Agent**: Dimensional Analysis (MIXED_DECIMALS flag)
**Scope**: FPairV2.sol, FRouterV2.sol, FRouterV3.sol, BondingV5.sol, BondingConfig.sol, BondingV2.sol
**Expressions analyzed**: 28 arithmetic expressions across 6 contracts
**Finding IDs**: [DA-1] through [DA-3]

---

## PHASE 1: Vocabulary Discovery

| Variable/Parameter | Location | Inferred Dimension | Scale | Evidence |
|---|---|---|---|---|
| `reserve0` (FPairV2) | FPairV2:Pool | Agent tokens | WAD (1e18) | Transferred as `bondingCurveSupply` which is `supplyBase * 1e18` |
| `reserve1` (FPairV2) | FPairV2:Pool | VIRTUAL asset | WAD (1e18) | Initialized with `fakeInitialVirtualLiq` = e.g. `6300 * 1e18` |
| `k` (FPairV2) | FPairV2:Pool | Dimensionless constant | WAD² (1e36) | `reserve0 * reserve1` |
| `buyTax`, `sellTax` (FFactoryV2/V3) | FFactoryV2:25-26 | Percentage | Integer (1 = 1%) | Used as `(tax * amountIn) / 100` |
| `antiSniperBuyTaxStartValue` | FFactoryV2:27 | Percentage | Integer (1 = 1%) | Used as `(antiSniperTax * amountIn) / 100` |
| `fakeInitialVirtualLiq` | BondingConfig:51 | VIRTUAL amount | WAD (1e18) | Comment: "e.g., 6300 * 1e18" |
| `targetRealVirtual` | BondingConfig:52 | VIRTUAL amount | WAD (1e18) | Comment: "e.g., 42000 * 1e18" |
| `initialSupply` | BondingConfig:112 | Token count | Base units (integer) | AgentTokenV2 multiplies by `10^decimals()` on receipt |
| `bondingCurveSupplyBase` | BondingV5:252 | Token count | Base units (integer) | From `calculateBondingCurveSupply()` which divides by 10000 |
| `bondingCurveSupply` | BondingV5:360 | Agent tokens | WAD (1e18) | `bondingCurveSupplyBase * 10^decimals` |
| `K` (BondingV2/V3/V4) | BondingV2:29 | Dimensionless | Raw integer | `K = 3_150_000_000_000` — combines with assetRate to yield WAD |
| `assetRate` | BondingV2:31 | Scale factor | Raw integer | `assetRate = 5000` — encodes the pricing relationship |
| `liquidity` (BondingV2 formula) | BondingV2:325 | VIRTUAL amount | WAD (1e18) | Formula output verified below |
| `price` (BondingV5/V2) | BondingV5:377 | Raw ratio | Raw integer | `bondingCurveSupply / liquidity` — WAD/WAD → pure integer |
| `gradThreshold` | BondingConfig:232 | Agent tokens | WAD (1e18) | `fakeInitLiq * supplyWei / (target + fakeInitLiq)` = WAD²/WAD = WAD |
| `normalTxFee`, `antiSniperTxFee` | FRouterV2:194-195 | VIRTUAL amount | WAD (1e18) | `(percent * amountIn) / 100` where amountIn is WAD |
| `duration` (anti-sniper) | BondingConfig:315 | Time | Seconds | 60 or 5880 |
| `startTax` | FRouterV3:291 | Percentage | Integer (1 = 1%) | Sourced from `antiSniperBuyTaxStartValue` |

---

## PHASE 2: Expression Annotation

| Expression | Location | Left Dim | Op | Right Dim | Result Dim | Valid? |
|---|---|---|---|---|---|---|
| `k = reserve0 * reserve1` | FPairV2:77 | WAD | × | WAD | WAD² (1e36) | ✓ |
| `k / (reserve0 + amountIn)` | FRouterV2:101-103 | WAD² | ÷ | WAD | WAD | ✓ |
| `reserve1 / reserve0` (priceALast) | FPairV2:169 | WAD | ÷ | WAD | Dimensionless | ✗ ALWAYS 0 |
| `reserve0 / reserve1` (priceBLast) | FPairV2:173 | WAD | ÷ | WAD | Dimensionless | ✗ Unscaled |
| `(fee * amountOut) / 100` | FRouterV2:151 | Integer | × | WAD / 100 | WAD | ✓ |
| `(normalTax * amountIn) / 100` | FRouterV2:194 | Integer | × | WAD / 100 | WAD | ✓ |
| `(antiSniperTax * amountIn) / 100` | FRouterV2:195 | Integer | × | WAD / 100 | WAD | ✓ |
| `K*10000 / assetRate * 10000e18 / supply * 1e18 / 10000` | BondingV2:325-326 | See below | | | WAD | ✓ |
| `bondingCurveSupply / liquidity` (price) | BondingV5:377 | WAD | ÷ | WAD | Dimensionless integer | ✗ No WAD scaling |
| `fakeInitLiq * supplyWei / (target + fakeInitLiq)` | BondingConfig:232 | WAD×WAD / WAD | | | WAD | ✓ |
| `initialSupply * (10000 - reserved) / 10000` | BondingConfig:207 | Base | × | Integer / Integer | Base | ✓ |
| `supplyBase * 10^decimals` | BondingV5:361 | Base | × | 1e18 | WAD | ✓ |
| `startTax * (duration - elapsed) / duration` | FRouterV3:318 | Integer | × | Integer / Integer | Integer | ✓ (rounding noted) |
| `amountIn * antiSniperBuyTaxStartValue / 100` | FRouterV2:195 | WAD | × | Integer / 100 | WAD | ✓ |
| `totalReservedSupply * 10^decimals` | BondingV5:385 | Base | × | 1e18 | WAD | ✓ |

### BondingV2/V3/V4 Liquidity Formula Trace
`liquidity = (((((K * 10000) / assetRate) * 10000 ether) / bondingCurveSupply) * 1 ether) / 10000`

With `K=3_150_000_000_000`, `assetRate=5000`, `bondingCurveSupply=450M*1e18`:
1. `K * 10000` = `3.15e16`
2. `/ assetRate` = `6.3e12`
3. `* 10000e18` = `6.3e34`
4. `/ bondingCurveSupply` (WAD) = `1.4e8`
5. `* 1e18` = `1.4e26`
6. `/ 10000` = `1.4e22` WAD = **14,000 VIRTUAL** ✓ (matches README)

The formula is dimensionally correct and produces a WAD-scaled VIRTUAL amount. No overflow risk (max intermediate = `3.15e38` << `uint256_max = 1.15e77`).

---

## PHASE 3: Propagation Tracing

| Mismatch Location | Downstream Consumer | Impact | Severity |
|---|---|---|---|
| `FPairV2.priceALast()` (always 0) | Off-chain indexers, UI price feeds | Token price reported as 0 — completely wrong | Low |
| `FPairV2.priceBLast()` (raw integer, not WAD) | Off-chain indexers, UI price feeds | Price reported as integer tokens-per-VIRTUAL, consumers expecting WAD get 1e18× wrong value | Low |
| `tokenInfo.data.price = supply/liquidity` (BondingV5/V2) | Off-chain Etherscan, indexers | `price` field stores raw ratio (e.g. 158730), consumers expecting WAD-scaled get a 1e18-factor underestimate | Low |
| `antiSniperBuyTaxStartValue` comment "basis points" | ADMIN_ROLE setting this param | Admin intending to set 99 bps (~1%) sets 99 meaning 99% — OR sets 10000 thinking "100%" but cap protects at 99% | Informational |

---

## PHASE 4: Concrete Validation

| Mismatch | Example Values | Expected Result | Actual Result | Dollar Impact |
|---|---|---|---|---|
| `priceALast()` at graduation | reserve0=29.4M*1e18, reserve1=214K*1e18 | 7.3×10⁻³ VIRTUAL/token (WAD-scaled) | 0 | Off-chain price feed shows $0/token |
| `priceBLast()` at graduation | reserve0=29.4M*1e18, reserve1=214K*1e18 | 137 (tokens/VIRTUAL, integer) | 137 | Correct as raw ratio, wrong if consumed as WAD (would show 137 WAD ≈ 137 "tokens" when true value is 1.37×10²⁰) |
| `tokenInfo.data.price` | bondingCurveSupply=450M*1e18, liquidity=14K*1e18 | 14K VIRTUAL / 450M tokens = 3.1×10⁻⁵ WAD | 32142 (integer) | Off-chain systems expecting WAD-scaled price see 3.2×10⁴ instead of 3.1×10⁻⁵; 10⁹ difference |
| `antiSniperBuyTaxStartValue` set as BPS | Admin sets 9900 thinking "99%" | 99% tax | Cap: tax = 99-normalTax% (protected) | No fund loss — cap enforced on-chain |

---

## Findings

---

## Finding [DA-1]: FPairV2.priceALast() Returns Constant Zero Due to Missing WAD Multiplier

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4 | ✗5(N/A, no external deps)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗(no external tokens), R12:✗(no dangerous precondition), R13:✓, R14:✗(no aggregate variable), R15:✗(no flash loan), R16:✗(no oracle)]
**Depth Evidence**: [BOUNDARY:reserve1=214000e18, reserve0=29.4Me18 → result=0], [VARIATION:any realistic reserve values → always 0], [TRACE:priceALast()→integer division truncates to 0→returned to caller]
**Severity**: Low
**Location**: FPairV2.sol:168-170, FPairV2.sol:172-174

**Description**:
`FPairV2.priceALast()` and `FPairV2.priceBLast()` divide two WAD-scaled (1e18) reserve values against each other without applying a WAD multiplier to preserve precision:

```solidity
function priceALast() public view returns (uint256) {
    return _pool.reserve1 / _pool.reserve0;  // e.g. 14000e18 / 450_000_000e18 = 0
}
function priceBLast() public view returns (uint256) {
    return _pool.reserve0 / _pool.reserve1;  // e.g. 450_000_000e18 / 14000e18 = 32142 (raw integer)
}
```

Both `reserve0` (agent tokens, WAD scale) and `reserve1` (VIRTUAL, WAD scale) are stored as 18-decimal ERC-20 amounts. The ratio `reserve1/reserve0` equals the price of one agent token in VIRTUAL units, which is approximately `14000/450_000_000 = 3.1×10⁻⁵` — a fractional value that truncates to **0** in Solidity's integer arithmetic.

Concretely, for all realistic bonding curve parameters:
- At launch: `14000e18 / 450000000e18 → 0`
- At graduation: `214000e18 / 29439252e18 → 0`

`priceBLast()` returns a non-zero value (e.g. 32142) but it is a raw dimensionless ratio — not WAD-scaled — so any consumer expecting a WAD-priced value will under-read it by a factor of 10¹⁸.

A correct implementation would apply `* 1e18` to the numerator before dividing to preserve fractional precision (matching Uniswap V2's Q112.112 price oracle approach).

**Impact**:
- Any off-chain indexer, price feed, UI component, or monitoring system calling `priceALast()` receives a permanent 0, making the token appear worthless regardless of actual on-chain price.
- Any consumer calling `priceBLast()` expecting a WAD-denominated price sees a value 10¹⁸× smaller than reality (e.g. 32142 instead of `32142e18`).
- On-chain bonding and trading logic is unaffected — these functions are pure views and the core AMM uses `kLast()` and `getReserves()` for swap computation. Impact is confined to off-chain price discovery and monitoring.
- If any external contract is built on top of `priceALast()` for liquidation triggers or similar, it would malfunction.

**Evidence**:
```solidity
// FPairV2.sol:168-174
function priceALast() public view returns (uint256) {
    return _pool.reserve1 / _pool.reserve0;
}
function priceBLast() public view returns (uint256) {
    return _pool.reserve0 / _pool.reserve1;
}
// With reserve0=450_000_000*1e18, reserve1=14000*1e18:
// priceALast() = 14000e18 / 450000000e18 = 0 (truncates)
// priceBLast() = 450000000e18 / 14000e18 = 32142 (raw integer, not WAD)
```

---

## Finding [DA-2]: tokenInfo.data.price Stores Raw Integer Ratio Without WAD Scaling — Off-Chain Price Data Corrupted

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,4 | ✗5(N/A)
**Rules Applied**: [R4:✗(evidence clear), R5:✓, R6:✗(no role), R8:✗(single-step), R10:✓, R11:✗, R12:✗, R13:✓, R14:✗, R15:✗, R16:✗]
**Depth Evidence**: [BOUNDARY:supply=1B*1e18, liquidity=6300*1e18 → price=158730 (raw)], [VARIATION:supply=450M*1e18, liquidity=14000*1e18 → price=32142 (raw)]
**Severity**: Low
**Location**: BondingV5.sol:377, BondingV2.sol:327, BondingV3.sol (same pattern), BondingV4.sol (same pattern)

**Description**:
The `price` field stored in `tokenInfo.data.price` is computed as:

```solidity
// BondingV5.sol:376-377
uint256 liquidity = bondingConfig.getFakeInitialVirtualLiq(); // e.g. 6300 * 1e18
uint256 price = bondingCurveSupply / liquidity;  // WAD / WAD = dimensionless integer
```

Both `bondingCurveSupply` (WAD scale, e.g. `1e9 * 1e18`) and `liquidity` (WAD scale, e.g. `6300 * 1e18`) are ERC-20 amounts in wei. Their quotient is a dimensionless raw integer — the number of agent tokens per VIRTUAL — with no WAD scaling applied. For example:
- Supply = `1_000_000_000 * 1e18`, Liquidity = `6300 * 1e18` → price = **158730** (raw tokens per VIRTUAL)
- Supply = `450_000_000 * 1e18`, Liquidity = `14000 * 1e18` → price = **32142** (raw tokens per VIRTUAL)

The same pattern appears in BondingV2:327, BondingV3 (line ~264 equivalent), and BondingV4:332. This is consistent with `FPairV2.priceBLast()` (DA-1 above) — both return raw unscaled ratios.

The `price` field is stored in `tokenInfo.data` which is accessed by external monitoring systems, APIs, and UIs (`newToken.data.price = price`). A system expecting a WAD-denominated price per agent token (i.e. expressed as VIRTUAL/token in 1e18 units, which would be `~3.1e-5 * 1e18 = 31102` WAD) would misinterpret the raw integer. More problematically, a system expecting VIRTUAL per agent token in WAD (the inverse price `priceALast`) would receive 0 from the view function (DA-1).

**Impact**:
- Affects all versions (BondingV2 through BondingV5) — the `data.price` field is consistently unscaled.
- Off-chain indexers/APIs consuming `tokenInfo.data.price` receive integer tokens-per-VIRTUAL (e.g. 32142), not a fractional WAD price. If the indexer interprets it as WAD, it computes a price that is `1e18×` too large.
- If any on-chain contract ever reads `tokenInfo.data.price` for logic (currently none found), it would receive the wrong unit.

**Evidence**:
```solidity
// BondingV2.sol:325-327
uint256 liquidity = (((((K * 10000) / assetRate) * 10000 ether) /
    bondingCurveSupply) * 1 ether) / 10000;
uint256 price = bondingCurveSupply / liquidity; // raw integer, no WAD scaling
newToken.data.price = price;  // stored as-is

// BondingV5.sol:376-377
uint256 liquidity = bondingConfig.getFakeInitialVirtualLiq();
uint256 price = bondingCurveSupply / liquidity; // same pattern
newToken.data.price = price;
```

---

## Finding [DA-3]: antiSniperBuyTaxStartValue NatSpec Declares "Basis Points" But Contract Uses It as Percentage — Admin Misconfiguration Risk

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3 | ✗4(N/A, view only) | ✗5(N/A)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single entity), R6:✓, R8:✗(single-step), R10:✓, R11:✗, R12:✗, R13:✓, R14:✓, R15:✗, R16:✗]
**Depth Evidence**: [VARIATION:admin sets 9900 thinking "99 bps = 0.99%" vs actual 9900% → capped at 99-normalTax by guard]
**Severity**: Informational
**Location**: FFactoryV2.sol:27, FFactoryV3.sol:35, FRouterV2.sol:190-195, FRouterV3.sol:195-200

**Description**:
`FFactoryV2` stores `antiSniperBuyTaxStartValue` with a NatSpec comment explicitly stating "in basis points":

```solidity
// FFactoryV2.sol:27
uint256 public antiSniperBuyTaxStartValue; // Starting tax value for anti-sniper (in basis points)
```

However, the contract consumes this value as a **percentage** (dividing by 100, not by 10000):

```solidity
// FRouterV2.sol:194-195
uint256 normalTxFee = (normalTax * amountIn) / 100;      // /100 = percentage
uint256 antiSniperTxFee = (antiSniperTax * amountIn) / 100; // /100 = percentage
```

This applies to all tax parameters: `buyTax`, `sellTax`, and `antiSniperBuyTaxStartValue` are all percentages (1 = 1%), not basis points (1 = 0.01%). The NatSpec on `antiSniperBuyTaxStartValue` is incorrect; the comment on `buyTax` and `sellTax` have no unit annotation.

The same comment exists in FFactoryV3.sol:35.

**Impact**:
- An ADMIN_ROLE holder reading the contract comment may attempt to configure "99% anti-sniper tax" by setting `antiSniperBuyTaxStartValue = 9900` (in basis points = 99%), but the on-chain cap `if (normalTax + antiSniperTax > 99) { antiSniperTax = 99 - normalTax; }` limits the value to 99. No funds are lost.
- The cap in FRouterV2:190 and FRouterV3:195 prevents any financial harm from an incorrect large value.
- However, an admin attempting to set the value correctly to `99` (percent) might mistakenly set it to `9900` (basis points they think means 99%). The cap would still make it work, but the intended "standard" 99% start tax would be lost if the admin set `antiSniperBuyTaxStartValue = 1` thinking 1 bps = 0.01% rather than 1% — resulting in only 1% anti-sniper tax instead of 99%.
- Existing finding AC-3 covers the related issue of `buyTax >= 100` causing underflow; this finding covers the unit confusion vector.

**Evidence**:
```solidity
// FFactoryV2.sol:27 — wrong comment
uint256 public antiSniperBuyTaxStartValue; // Starting tax value for anti-sniper (in basis points)

// FRouterV2.sol:320 — used as percentage (start value of 99 = 99%)
uint256 startTax = factory.antiSniperBuyTaxStartValue(); // 99%

// FRouterV2.sol:195 — division by 100 confirms percentage denomination
uint256 antiSniperTxFee = (antiSniperTax * amountIn) / 100;
```

### Precondition Analysis
**Missing Precondition**: Admin must read the comment and set value in basis points instead of percent
**Precondition Type**: ACCESS
**Why This Blocks**: On-chain cap (99-normalTax) prevents catastrophic failure; misconfiguration only reduces anti-sniper protection if admin sets 1 (thinking "1 bps = 0.01%") instead of 99

---

## Dismissed Expressions (Not Findings)

| Expression | Location | Reason |
|---|---|---|
| BondingV2 liquidity formula | BondingV2:325-326 | Dimensionally correct; produces 14000 VIRTUAL from K=3.15e12, assetRate=5000, supply=450M*1e18. No mismatch. |
| `k = reserve0 * reserve1` | FPairV2:77 | WAD×WAD = WAD². uint256 holds up to 1.15e77; max k = ~2.14e50. No overflow. |
| `calculateBondingCurveSupply` | BondingConfig:207 | Returns base units (correct). BondingV5 multiplies by 1e18 before use. |
| `calculateGradThreshold` | BondingConfig:232 | WAD×WAD/WAD = WAD. Dimensionally correct. |
| `(fee * amountIn) / 100` (buy/sell) | FRouterV2/V3 | Percentage × WAD / integer = WAD. Correct. |
| `startTax * (duration-elapsed) / duration` | FRouterV3:318 | Integer × integer / integer = integer (percent). Correct. Precision loss covered by RS2-8. |
| `tokenSupplyParams` encoding | BondingV5:333-344 | Passes base units to AgentTokenV2 which internally multiplies by `10^decimals()`. Verified in AgentTokenV2.sol:108-109. |
| `fee = (fee_ * 1 ether) / 1000` | BondingV2:151 | Converts fee from per-mille (e.g. 1 = 0.1%) to WAD for internal use. Correct. |

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|---|---|---|---|---|---|---|
| DA-1 | FPairV2.sol:168-174 | `reserve1/reserve0` truncates to 0 (WAD/WAD without WAD multiplier) — price oracle always returns zero | CONFIRMED | Low | DESIGN | MONITORING_CORRUPTION |
| DA-2 | BondingV5.sol:377, BondingV2.sol:327, BondingV3.sol, BondingV4.sol | `price = supply/liquidity` stores raw dimensionless ratio (not WAD) in `tokenInfo.data.price` — off-chain price data 1e18× wrong | CONFIRMED | Low | DESIGN | MONITORING_CORRUPTION |
| DA-3 | FFactoryV2.sol:27, FFactoryV3.sol:35 | `antiSniperBuyTaxStartValue` documented as "basis points" but used as percentage — unit mismatch in NatSpec causes admin misconfiguration risk | CONFIRMED | Informational | ACCESS | TAX_MISCONFIGURATION |
