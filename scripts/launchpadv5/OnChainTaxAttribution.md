# On-Chain Tax Attribution Solution

## Executive Summary

This document describes the on-chain tax attribution solution that eliminates the need for chain-specific `tax-listener` services when expanding to multiple chains.

**Key Changes:**
- New contracts: `AgentFactoryV7`, `FFactoryV3`, `FRouterV3`, `AgentTokenV3`, `AgentTaxV2`
- Modified contracts: `BondingV5`
- Reused (unchanged): `FPairV2`, `AgentNft`, `AgentVeTokenV2`, `AgentDAO`

**V5 Suite Architecture:**
```
V4 Suite (Legacy):
  BondingV4 → AgentFactoryV6 → AgentTokenV2 → FFactoryV2 → FRouterV2 → AgentTax
  
V5 Suite (New):
  BondingV5 → AgentFactoryV7 → AgentTokenV3 → FFactoryV3 → FRouterV3 → AgentTaxV2
```

---

## 1. Problem: Why Was Tax-Listener Needed?

### AgentTax Doesn't Know Tax Source

When taxes are collected from trading activities, the `AgentTax` contract receives VIRTUAL tokens but **cannot determine which agent the tax belongs to**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PREVIOUS ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Prototype SELL: preTokenPair.transferAsset() → AgentTax               │
│   Prototype BUY:  Buyer → safeTransferFrom → AgentTax                   │
│   Graduated:      UniswapRouter.swap() → AgentTax                       │
│                           │                                             │
│                           ▼                                             │
│   AgentTax receives VIRTUAL but doesn't know which agent                │
│                           │                                             │
│                           ▼                                             │
│   tax-listener (OFF-CHAIN) scans Transfer events                        │
│   Groups transactions by virtualId using:                               │
│     - lpSource (preTokenPair address)                                   │
│     - uniV2PoolAddr                                                     │
│                           │                                             │
│                           ▼                                             │
│   Backend calls AgentTax.handleAgentTaxes(virtualId, hashes, amounts)   │
│   to attribute and distribute taxes                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tax-Listener Identification Logic

The `tax-listener` uses a **multi-step fallback mechanism** to identify which agent a tax transfer belongs to:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  TAX-LISTENER IDENTIFICATION FLOW                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Step 1: Try to find agent by log.from                                 │
│   ├── Find by lpSource (graduated token's uniV2PoolAddr)                │
│   └── Find by uniV2PoolAddr (preTokenPair mapped to agent)              │
│                         │                                               │
│                         ▼                                               │
│   Step 2: If Step 1 fails, check transaction receipt logs               │
│   └── Look for Swap event from preTokenPair                             │
│       └── If found: use preTokenPair to query RDS for agent             │
│                         │                                               │
│                         ▼                                               │
│   findVirtualIdFromSender(sender, txHash):                              │
│     1. findAgentWithLP(sender) → if found, return virtualId             │
│     2. getLPSource(sender) → findAgentWithToken → return virtualId      │
│     3. findPreTokenPairFromSwapEvent(txHash) → query RDS → virtualId    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Additional Backend Requirement for V2 Tokens

Before calling `launch()` for V2 prototype tokens, the backend must call:

```solidity
taxManager.updateCreatorForPrototypeV2Agents(agentId, tba, creator)
```

This ensures the `agentId → creator` mapping exists on-chain so that `handleAgentTaxes()` can properly distribute taxes.

### Issues with This Approach

1. **Chain-specific infrastructure** - Each new chain requires its own `tax-listener` service
2. **Complex virtualId lookup** - Requires off-chain mapping of lpSource/uniV2Pool to agentId
3. **Delay between tax collection and attribution** - Backend processing introduces latency
4. **Risk of missed transactions** - If tax-listener fails, taxes aren't properly attributed
5. **Infrastructure overhead** - Running separate services per chain increases costs (~$50-100/month per chain)

---

## 2. Solution: On-Chain Tax Attribution

### Core Idea

Instead of having AgentTax passively receive transfers, we make **all tax inflows call `depositTax(tokenAddress, amount)`**, which:
1. Immediately identifies the agent via `tokenAddress`
2. Credits the tax to the correct token's account
3. Backend triggers swap when threshold is reached

### New Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        NEW ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   During BondingV5.launch():                                            │
│   └── AgentTax.registerToken(tokenAddress, creator, creator)            │
│                                                                         │
│   Prototype SELL (via FRouterV3):                                       │
│   └── preTokenPair → FRouterV3 → AgentTax.depositTax(tokenAddr, amt)    │
│                                                                         │
│   Prototype BUY (via FRouterV3):                                        │
│   └── Buyer → FRouterV3 → AgentTax.depositTax(tokenAddr, amt)           │
│                                                                         │
│   Graduated (via AgentTokenV3._swapTax):                                │
│   └── UniswapSwap → AgentTokenV3 → AgentTax.depositTax(tokenAddr, amt)  │
│                           │                                             │
│                           ▼                                             │
│   AgentTax immediately knows tokenAddress → creator                     │
│   Credits to tokenTaxAmounts[tokenAddress]                              │
│   Backend triggers swap when threshold reached                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tax Collection and Swap Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TAX COLLECTION AND SWAP FLOW                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   User Trade (BUY/SELL)                                                 │
│   └── FRouterV3/AgentTokenV3 calls AgentTax.depositTax(tokenAddr, amt)  │
│       └── Tax accumulated in tokenTaxAmounts[tokenAddr].amountCollected │
│           (NO auto-swap - user never pays swap gas)                     │
│                                                                         │
│   Backend Monitoring (Two Options)                                      │
│   ├── Option 1: Direct on-chain monitoring                              │
│   │   └── Watch tokenTaxAmounts[tokenAddr].amountCollected              │
│   │                                                                     │
│   └── Option 2: Backend volume-based monitoring (Recommended)           │
│       └── Monitor virtual.volume24h from backend DB                     │
│       └── Only check on-chain if volume24h >= 1000 VIRTUAL              │
│       └── Check hourly (saves RPC calls)                                │
│                                                                         │
│   When threshold reached:                                               │
│   └── Verify price externally                                           │
│   └── Call AgentTax.swapForTokenAddress(tokenAddr, minOutput)           │
│       └── Swap tax → distribute to creator and treasury                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Benefits

1. **No chain-specific tax-listener needed** - On-chain attribution works identically on any EVM chain
2. **Real-time attribution** - Tax is attributed immediately when deposited
3. **No risk of missed transactions** - Contract logic ensures attribution
4. **Reduced infrastructure costs** - Eliminates need for per-chain backend services (~$50-100/month saved per chain)
5. **Simplified backend** - No transaction scanning or grouping logic required
6. **No backend calls to `updateCreatorForPrototypeV2Agents()`** for V3 tokens
7. **Users never pay swap gas** - Backend controls all swaps

---

## 3. Contract Design Decisions

### Summary: Which Contracts Need New Versions?

| Contract | Action | Reason |
|----------|--------|--------|
| **AgentFactory** | ✅ **New (`AgentFactoryV7`)** | Separate `projectTaxRecipient` config for V3 tokens (AgentTaxV2) |
| **AgentTax** | ✅ **New (`AgentTaxV2`)** | Simplified contract with only V3 functions (~300 lines vs ~670 lines) |
| **FFactory** | ✅ **New (`FFactoryV3`)** | Frontend determines router by factory; need separate factory for V3 tokens |
| **FRouter** | ✅ **New (`FRouterV3`)** | Must call `depositTax()` for tax attribution |
| **AgentToken** | ✅ **New (`AgentTokenV3`)** | Must call `depositTax()` in `_swapTax()` for graduated tokens |
| **BondingV5** | 🔄 Modify | Use FFactoryV3 + FRouterV3 + AgentFactoryV7, call `registerToken()` during launch |
| **FPair** | ❌ Unchanged | `FPairV2.transferAsset()` is sufficient; router handles the rest |
| **BondingConfig** | ❌ Unchanged | Shared configuration, no changes needed |
| **AgentNft** | ❌ Unchanged | Shared by both V6 and V7 factories |
| **AgentVeToken** | ❌ Unchanged | Same implementation used by V7 |
| **AgentDAO** | ❌ Unchanged | Same implementation used by V7 |

### Why AgentFactoryV7?

| Aspect | Reuse AgentFactoryV6 | New AgentFactoryV7 |
|--------|---------------------|-------------------|
| **projectTaxRecipient** | Single config shared by all tokens | Separate config for V5 suite |
| **V4 Token Tax** | Conflict if set to AgentTaxV2 | N/A (V4 uses V6) |
| **V5 Token Tax** | Conflict if set to AgentTax | Works with AgentTaxV2 |
| **nextIdBase** | 60_000_000_000 | 70_000_000_000 (new range) |
| **Clean Separation** | Mixed V4/V5 tokens | Pure V5 tokens only |

**Decision:** New `AgentFactoryV7` for V5 suite:
- **AgentFactoryV6** (old) → BondingV4 + AgentTokenV2 → AgentTax
- **AgentFactoryV7** (new) → BondingV5 + AgentTokenV3 → AgentTaxV2

#### The Core Problem: projectTaxRecipient Conflict

`AgentFactoryV6` has a single `_tokenTaxParams` that includes `projectTaxRecipient`. This recipient is used by **all graduated tokens** created through the factory for tax distribution in `_swapTax()`:

```solidity
// AgentFactoryV6.sol - Single config for all tokens
bytes private _tokenTaxParams; // Contains projectTaxRecipient

// Set via setTokenTaxParams() - applies to ALL tokens created by this factory
function setTokenTaxParams(..., address projectTaxRecipient) {
    _tokenTaxParams = abi.encode(..., projectTaxRecipient);
}
```

**If both BondingV4 and BondingV5 use AgentFactoryV6:**

| `projectTaxRecipient` Setting | BondingV4 Graduated Token | BondingV5 Graduated Token |
|------------------------------|---------------------------|---------------------------|
| **AgentTax (old)** | ✅ Works with tax-listener | ❌ **FAILS** - AgentTax lacks `depositTax(address, uint256)` |
| **AgentTaxV2 (new)** | ❌ **FAILS** - Token not registered (no `registerToken()` was called) | ✅ Works correctly |

**Solution:** Separate factories ensure each suite has its own `projectTaxRecipient` configuration.

### V4 vs V5 Suite Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         V4 SUITE (Legacy)                                   │
│                    Tax Attribution: OFF-CHAIN (tax-listener)                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌────────────┐    ┌─────────────────┐    ┌───────────────┐               │
│   │ BondingV4  │───▶│ AgentFactoryV6  │───▶│ AgentTokenV2  │               │
│   └────────────┘    └─────────────────┘    └───────────────┘               │
│         │                   │                      │                        │
│         │           projectTaxRecipient            │                        │
│         │                   ▼                      │                        │
│         │              AgentTax ◀──────────────────┘                        │
│         │                   ▲              _swapTax() direct transfer       │
│         │                   │                                               │
│         ▼                   │                                               │
│   ┌────────────┐    ┌─────────────┐                                        │
│   │ FFactoryV2 │───▶│  FRouterV2  │──── direct transfer to AgentTax        │
│   └────────────┘    └─────────────┘                                        │
│                             │                                               │
│                             ▼                                               │
│                     tax-listener scans Transfer events                      │
│                     calls handleAgentTaxes(agentId, hashes, amounts)        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         V5 SUITE (New)                                      │
│                    Tax Attribution: ON-CHAIN (depositTax)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌────────────┐    ┌─────────────────┐    ┌───────────────┐               │
│   │ BondingV5  │───▶│ AgentFactoryV7  │───▶│ AgentTokenV3  │               │
│   └────────────┘    └─────────────────┘    └───────────────┘               │
│         │                   │                      │                        │
│         │           projectTaxRecipient            │                        │
│         │                   ▼                      │                        │
│         │             AgentTaxV2 ◀─────────────────┘                        │
│         │                   ▲           _swapTax() → depositTax()           │
│         │                   │                                               │
│         ▼           registerToken() + depositTax()                          │
│   ┌────────────┐    ┌─────────────┐                                        │
│   │ FFactoryV3 │───▶│  FRouterV3  │──── depositTax() to AgentTaxV2         │
│   └────────────┘    └─────────────┘                                        │
│                             │                                               │
│                             ▼                                               │
│                     Backend calls swapForTokenAddress(tokenAddr, minOutput) │
│                     when threshold reached (hourly check via distributeTax) │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Configuration Differences

| Configuration | AgentFactoryV6 (V4) | AgentFactoryV7 (V5) |
|--------------|---------------------|---------------------|
| `nextIdBase` | 60,000,000,000 | 70,000,000,000 |
| `tokenImplementation` | AgentTokenV2 | AgentTokenV3 |
| `projectTaxRecipient` | AgentTax (old) | AgentTaxV2 (new) |
| **Tax Flow** | Direct transfer → tax-listener | depositTax() → on-chain |

### Why AgentTaxV2 Instead of Upgrading AgentTax?

| Aspect | Upgrade AgentTax | New AgentTaxV2 |
|--------|------------------|----------------|
| **Code Size** | ~670 lines (V2 + V3 mixed) | ~300 lines (V3 only) |
| **Complexity** | High (legacy code, deprecated fields) | Low (clean design) |
| **Audit Cost** | Higher (mixed responsibilities) | Lower (single purpose) |
| **Dependencies** | Needs `AgentNft`, `BondingV2/V4/V5` refs | None (standalone) |
| **Storage** | Multiple mappings (agentId + tokenAddress) | Single mapping (tokenAddress only) |
| **Maintenance** | Both V2 and V3 logic to maintain | Only V3 logic |

**Decision:** New `AgentTaxV2` contract for cleaner separation:
- **AgentTax** (old) → V2 tokens via tax-listener
- **AgentTaxV2** (new) → V3 tokens via on-chain attribution

### Contract Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    V4 SUITE (Legacy)                                    │
│                    (Old tokens, tax-listener required)                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   BondingV4 ──────┬──→ AgentFactoryV6 ──→ AgentTokenV2                 │
│                   │        │                                            │
│                   │        └──→ projectTaxRecipient = AgentTax         │
│                   │                                                     │
│                   ├──→ FFactoryV2 ──→ FPairV2 (router=FRouterV2)       │
│                   │                        │                            │
│                   └──→ FRouterV2 ──────────┴──→ AgentTax (old)         │
│                                                     │                   │
│   AgentTokenV2 ──→ _swapTax() ──→ direct transfer ──┘                  │
│                                                                         │
│   Tax Attribution: OFF-CHAIN (tax-listener scans events)               │
│   Backend: handleAgentTaxes(agentId, txhashes, amounts)                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    V5 SUITE (New)                                       │
│                    (New tokens, on-chain attribution)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   BondingV5 ──────┬──→ AgentFactoryV7 ──→ AgentTokenV3                 │
│        │          │        │                                            │
│        │          │        └──→ projectTaxRecipient = AgentTaxV2       │
│        │          │                                                     │
│        │          ├──→ FFactoryV3 ──→ FPairV2 (router=FRouterV3)       │
│        │          │                        │                            │
│        │          └──→ FRouterV3 ──────────┴──→ AgentTaxV2 (new)       │
│        │                                            │                   │
│        └──→ registerToken() ────────────────────────┘                  │
│                                                                         │
│   AgentTokenV3 ──→ _swapTax() ──→ depositTax() ─────┘                  │
│                                                                         │
│   Tax Attribution: ON-CHAIN (depositTax records tokenAddress)          │
│   Backend: swapForTokenAddress(tokenAddr, minOutput)                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why FFactoryV3 is Needed (Not Just Router Switch)

**Question:** Can we just update `FFactoryV2.router` to `FRouterV3` instead of deploying a new factory?

**Answer:** No, because of frontend router determination logic.

#### Frontend Router Selection Logic

The frontend determines which router contract to call based on the token's factory/bonding version:

```typescript
// Frontend: virtual-protocol-app/src/utils/cyoa.tsx
export const getRouterAddress = (factory: string) => {
  if (
    factory === FactoryEnum.BONDING_V2 ||
    factory === FactoryEnum.BONDING_V4 ||
    factory === FactoryEnum.VIBES_BONDING_V2
  ) {
    return CONTRACT.UNICORN_ROUTER;      // FRouterV2
  } else if (factory === FactoryEnum.BONDING_V3) {
    return CONTRACT.V3_PROTOTYPE_ROUTER; // FRouterV3 (for BONDING_V3)
  } else if (factory === FactoryEnum.BONDING_V5) {
    return CONTRACT.V5_ROUTER;           // FRouterV3 (for BONDING_V5)
  }
  // ...
};
```

#### Example: Frontend Calling `resetTime()`

When a creator wants to reset their token's launch time, the frontend calls `router.resetTime()`:

```typescript
// Frontend calling resetTime - must use correct router!
const routerAddress = getRouterAddress(token.virtualFactory); // e.g., BONDING_V4 → FRouterV2

await writeContract({
  address: routerAddress,
  abi: frouterV2Abi,
  functionName: 'resetTime',
  args: [pairAddress, newStartTime],
});
```

**The Problem:** If we reuse `FFactoryV2` and switch its router to `FRouterV3`:
- New `BondingV4` tokens would get pairs with `router=FRouterV3` (stored at pair creation time)
- But frontend sees `BONDING_V4` → calls `FRouterV2.resetTime()`
- `FRouterV2.resetTime()` will **FAIL** because `FPairV2.onlyRouter` modifier rejects it!

```solidity
// FPairV2.sol - pair only accepts calls from its stored router
modifier onlyRouter() {
    require(msg.sender == address(router), "Only router can call this function");
    _;
}

function resetTime(uint256 newStartTime) external onlyRouter {
    // Only the router stored at pair creation can call this!
}
```

#### Why Separate FFactoryV3 Solves This

**Solution:** Deploy separate `FFactoryV3` (identical code) for `BondingV5`:

```
BondingV4 → FFactoryV2 (router=FRouterV2) → FPairV2 (router=FRouterV2)
                                               ↑
                                    Frontend calls FRouterV2 ✅

BondingV5 → FFactoryV3 (router=FRouterV3) → FPairV2 (router=FRouterV3)
                                               ↑
                                    Frontend calls FRouterV3 ✅
```

This ensures:
1. Frontend can reliably determine router by checking `virtualFactory` (bonding version)
2. Each pair's stored router matches what frontend will call
3. No mismatch between pair's `router` and frontend's router selection

### Why FPairV3 is NOT Needed

**Question:** Why don't we need a new pair contract?

**Answer:** The pair contract only needs to transfer funds to the router - it doesn't care about tax attribution:

```solidity
// FPairV2.sol - this function is unchanged and sufficient
function transferAsset(address to, uint256 amount) external onlyRouter {
    IERC20(tokenB).safeTransfer(to, amount);
}
```

**Tax Flow for V3:**
1. `FPairV2.transferAsset()` sends tax to `FRouterV3` (not directly to AgentTax)
2. `FRouterV3` receives the tax, then calls `AgentTax.depositTax(tokenAddress, amount)`
3. The pair doesn't need to know about `depositTax()` - the router handles it

**Key Insight:** Each `FPairV2` stores its router reference at creation time (set by factory). Old pairs created via `FFactoryV2` have `router=FRouterV2`; new pairs created via `FFactoryV3` have `router=FRouterV3`.

### Contract Changes Summary

| Contract | Changes |
|----------|---------|
| `AgentTax.sol` | Add `registerToken()`, `depositTax()`, `swapForTokenAddress()`, `tokenRecipients` mapping, `tokenTaxAmounts` mapping |
| `FFactoryV3.sol` | **NEW** - Identical code to FFactoryV2, deployed separately for BondingV5 tokens |
| `FRouterV3.sol` | **NEW** - Router that calls `depositTax()` for both buy and sell taxes |
| `AgentTokenV3.sol` | **NEW** - Modified `_swapTax()` to call `depositTax()` after swap |
| `BondingV5.sol` | Modified to use FFactoryV3 + FRouterV3, calls `registerToken()` during `launch()` |
| `FPairV2.sol` | **Unchanged** - Reused for both V2 and V3 tokens |

---

## 4. Trade-offs and Gas Analysis

### Cons

1. **Increased gas cost per trade (paid by user)**
   - Each `depositTax()` call adds ~15,000 gas to user's transaction
   - This is additional cost paid by the trading user, not the backend

2. **Requires contract upgrades** - Need to deploy FFactoryV3, FRouterV3, AgentTokenV3, upgrade AgentTax

3. **Not retroactive** - Old V2 tokens continue to use tax-listener

### Gas Cost Formula

```
Gas Cost (USD) = Gas Used × Gas Price (Gwei) × Native Token Price (USD) / 1e9
```

### Current Gas Prices and Costs (March 2026)

| Chain | Native Token | Token Price | Avg Gas Price | depositTax() Gas | depositTax() Cost |
|-------|--------------|-------------|---------------|------------------|-------------------|
| **Base** | ETH | ~$2,200 | ~0.005 Gwei | 15,000 | **$0.00017** |
| **BSC** | BNB | ~$600 | ~1 Gwei | 15,000 | **$0.009** |
| **Ethereum** | ETH | ~$2,200 | ~0.2 Gwei | 15,000 | **$0.0066** |

### Extreme Scenario (100x Gas Price Spike)

| Chain | 100x Gas Price | depositTax() Cost |
|-------|----------------|-------------------|
| **Base** | 0.5 Gwei | **$0.017** |
| **BSC** | 100 Gwei | **$0.90** |
| **Ethereum** | 20 Gwei | **$0.66** |

### Percentage Impact Analysis

| Transaction Type | Base Gas | Added Gas | **% Increase** | Sample Transaction |
|-----------------|----------|-----------|----------------|---------------------|
| Prototype BUY | 246,484 | +15,000 | **+6.1%** | [0xff977f...](https://sepolia.basescan.org/tx/0xff977f07b6112e5b04f9d51a2382ab8b06584922f55193428089e0adc3d30dba) |
| Prototype SELL | 170,616 | +15,000 | **+8.8%** | [0xf6e044...](https://sepolia.basescan.org/tx/0xf6e0444720a89a7ecb0927a06aae86e600fa4b9d8fd34998a048682484b9c9f4) |

**Key Insight:** The percentage increase (~6-9%) is constant regardless of gas price. Users trading in extreme gas conditions are typically not cost-sensitive.

### Gas Breakdown for `depositTax()` (no auto-swap)

| Operation | Gas Cost |
|-----------|----------|
| External call overhead | ~2,600 |
| `safeTransferFrom` | ~3,000 |
| SSTORE (amountCollected update, warm) | ~5,000 |
| Event emission (TaxDeposited) | ~2,000 |
| Approval check & state reads | ~2,400 |
| **Total per depositTax()** | **~15,000** |

### Backend Savings

**Current `handleAgentTaxes()` Costs (per batch of 100 txns):**

| Chain | Mode | Gas per Batch | Monthly Calls | Gas Price | Token Price | Monthly Cost |
|-------|------|---------------|---------------|-----------|-------------|--------------|
| **Base** | For-loop (100 txns) | 2,686,000 | 100 | 0.005 Gwei | ETH $2,200 | **$2.95** |
| **BSC** | For-loop (100 txns) | 2,686,000 | 100 | 1 Gwei | BNB $600 | **$161** |
| **Ethereum** | Checksum mode | 52,600 | 100 | 0.2 Gwei | ETH $2,200 | **$0.23** |

**With New Solution:**
- Backend no longer calls `handleAgentTaxes()` for V3 tokens
- Backend calls `swapForTokenAddress(tokenAddress, minOutput)` when threshold reached
- **Net effect:** Cost shifts from backend to users (~6-9% more gas per trade)

**Infrastructure Savings:**
- Tax-listener service: ~$50-100/month per chain
- No batch processing logic needed

---

## 5. V2 vs V3 Token Tax Flow Comparison

### V2 Token Tax Flows (tax-listener required)

#### Prototype (BondingV1/V2/V3/V4)

| Action | Tax Sender | Tax-Listener | New Mechanism |
|--------|------------|--------------|---------------|
| **BUY** | Buyer directly | ✅ Processes via fallback | ❌ Not called |
| **SELL** | preTokenPair | ✅ Processes via fallback | ❌ Not called |

#### Graduated (AgentTokenV2)

| Action | Tax Sender | Tax-Listener | New Mechanism |
|--------|------------|--------------|---------------|
| **BUY/SELL** | uniV2PoolAddr | ✅ Processes (recognized) | ❌ Not called |

### V3 Token Tax Flows (on-chain attribution)

#### Prototype (BondingV5 + FRouterV3)

| Action | Tax Sender | Tax-Listener | New Mechanism |
|--------|------------|--------------|---------------|
| **BUY** | FRouterV3 | ⚠️ Must skip! | ✅ depositTax() called |
| **SELL** | FRouterV3 | ⚠️ Must skip! | ✅ depositTax() called |

#### Graduated (AgentTokenV3)

| Action | Tax Sender | Tax-Listener | New Mechanism |
|--------|------------|--------------|---------------|
| **BUY/SELL** | AgentTokenV3 | ⚠️ Must skip! | ✅ depositTax() called |

### ⚠️ Critical: Tax-Listener Must Skip BondingV5 Tokens

Since tax-listener's fallback mechanism will also match V3 token transactions, **it MUST be updated** to skip BondingV5 tokens:

```typescript
// In tax-listener/src/services/chain.ts - findVirtualIdFromSender()
if (virtualId) {
  // Check if this is a BondingV5 token via backend API
  const isBondingV5Token = await checkIfBondingV5Token(preTokenPair);
  if (isBondingV5Token) {
    return undefined; // Don't process - let on-chain depositTax handle it
  }
  return virtualId;
}
```

### Summary Matrix (After Tax-Listener Update)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TAX PROCESSING MATRIX                               │
├─────────────────┬─────────────────────┬─────────────────────────────────┤
│ Token Type      │ Tax-Listener        │ New Mechanism (depositTax)      │
├─────────────────┼─────────────────────┼─────────────────────────────────┤
│ V2 Prototype    │ ✅ Processes        │ ❌ Not used                     │
│ V2 Graduated    │ ✅ Processes        │ ❌ Not used                     │
│ V3 Prototype    │ ⏭️ Skipped          │ ✅ Processes                    │
│ V3 Graduated    │ ⏭️ Skipped          │ ✅ Processes                    │
└─────────────────┴─────────────────────┴─────────────────────────────────┘
```

---

## 6. Files Changed

| File | Type | Description |
|------|------|-------------|
| `contracts/tax/AgentTaxV2.sol` | **New** | Simplified tax contract for V3 tokens (~300 lines) |
| `contracts/launchpadv2/FFactoryV3.sol` | **New** | Identical to FFactoryV2, separate instance for V3 tokens |
| `contracts/launchpadv2/FRouterV3.sol` | **New** | Router with `depositTax()` calls for buy/sell |
| `contracts/launchpadv2/BondingV5.sol` | Modified | Use FFactoryV3 + FRouterV3, call `registerToken()` in `launch()` |
| `contracts/virtualPersona/AgentTokenV3.sol` | **New** | `_swapTax()` calls `depositTax()` |
| `tax-listener/src/services/chain.ts` | Modified | Add BondingV5 token check to skip V3 tokens |

### AgentTaxV2 vs AgentTax Comparison

```
AgentTax (old, ~670 lines):
├── V2 Functions: handleAgentTaxes, dcaSell, updateCreatorFor*
├── V2 Storage: agentTaxAmounts[agentId], _agentRecipients[agentId], taxHistory[txhash]
├── Dependencies: AgentNft, BondingV2/V4/V5 refs
└── Legacy: tbaBonus (deprecated), creatorFeeRate (unused)

AgentTaxV2 (new, ~300 lines):
├── V3 Functions: registerToken, depositTax, swapForTokenAddress, batchSwap
├── V3 Storage: tokenTaxAmounts[tokenAddr], tokenRecipients[tokenAddr]
├── Dependencies: None (standalone)
└── Clean design, single responsibility
```

---

## 7. Deployment Checklist

### Contract Deployment

**Step 1: Deploy Tax Contract**

1. [ ] Deploy `AgentTaxV2`:
   ```solidity
   AgentTaxV2.initialize(
       admin,           // defaultAdmin
       usdcAddress,     // assetToken
       virtualAddress,  // taxToken
       routerAddress,   // Uniswap router
       treasury,        // treasury
       minThreshold,    // minSwapThreshold
       maxThreshold,    // maxSwapThreshold
       3000             // feeRate (30%)
   )
   ```

**Step 2: Deploy Token Implementation**

2. [ ] Deploy `AgentTokenV3` implementation contract

**Step 3: Deploy AgentFactoryV7**

3. [ ] Deploy `AgentFactoryV7`:
   ```solidity
   AgentFactoryV7.initialize(
       agentTokenV3Impl,    // tokenImplementation
       veTokenImpl,         // veTokenImplementation (same as V6)
       daoImpl,             // daoImplementation (same as V6)
       tbaRegistry,         // tbaRegistry (same as V6)
       assetToken,          // assetToken (VIRTUAL)
       agentNft,            // nft (same as V6)
       vault,               // vault (same as V6)
       0                    // nextId (starts fresh with 70_000_000_000 base)
   )
   ```

4. [ ] Configure `AgentFactoryV7`:
   ```solidity
   agentFactoryV7.setParams(
       maturityDuration,    // same as V6
       uniswapRouter,       // Uniswap V2 Router
       defaultDelegatee,    // same as V6
       tokenAdmin           // same as V6
   )
   
   agentFactoryV7.setTokenParams(
       500,                 // projectBuyTaxBasisPoints (5%)
       500,                 // projectSellTaxBasisPoints (5%)
       100,                 // taxSwapThresholdBasisPoints
       agentTaxV2Address    // projectTaxRecipient = AgentTaxV2 ⚠️ KEY CONFIG
   )
   ```

**Step 4: Deploy Factory & Router**

5. [ ] Deploy `FFactoryV3`:
   - Identical code to FFactoryV2
   - Configure with `AgentTaxV2` as taxVault

6. [ ] Deploy `FRouterV3` (pointing to `FFactoryV3`)

7. [ ] Configure `FFactoryV3`:
   - `fFactoryV3.setRouter(fRouterV3Address)`
   - `fFactoryV3.setTaxParams(agentTaxV2, buyTax, sellTax, antiSniperTax, antiSniperVault)`

**Step 5: Deploy BondingV5**

8. [ ] Deploy/Upgrade `BondingV5`:
   ```solidity
   BondingV5.initialize(
       fFactoryV3Address,
       fRouterV3Address,
       agentFactoryV7Address,  // ⚠️ Use AgentFactoryV7, not V6
       bondingConfigAddress
   )
   ```

**Step 6: Grant Roles**

9. [ ] Grant roles on `FFactoryV3`:
   - `CREATOR_ROLE` to `BondingV5`

10. [ ] Grant roles on `AgentFactoryV7`:
   - `BONDING_ROLE` to `BondingV5`

11. [ ] Grant roles on `AgentTaxV2`:
   - `EXECUTOR_ROLE` to `BondingV5` (for `registerToken()`)
   - `EXECUTOR_ROLE` to backend wallet (for `swapForTokenAddress()`)

### Tax-Listener Update (Critical)

10. [ ] Update `findVirtualIdFromSender()` to skip BondingV5 tokens:
    - Call `ai-contribution-be` API to check if token is from BondingV5
    - If BondingV5 token, return `undefined` to skip processing

### Backend Monitoring Setup: `distributeTaxMultichain`

11. [ ] Deploy `distributeTaxMultichain` Lambda function in `tax-listener`:
    - Location: `tax-listener/src/functions/distributeTaxMultichain.ts`
    - Schedule: Hourly (`cron(0 * * * ? *)`)
    - Reserved concurrency: 1

12. [ ] The function implements the following logic:

    **Step 1: Query BONDING_V5 Virtuals from Platform-BE API**
    ```
    SELECT * FROM virtuals 
    WHERE factory = 'BONDING_V5' 
      AND status != 'DRAFT'
      AND (
        (created_at <= '25hrs ago' AND volume_24_h >= 1000) 
        OR (created_at > '25hrs ago')
      )
    ```
    
    - Old tokens (> 25 hours): Only process if `volume24h >= 1000 VIRTUAL`
    - New tokens (< 25 hours): Process all (grace period for new launches)

    **Step 2: Group by Chain**
    - Group virtuals by `blockchain` field (base, eth, bsc)
    - Each chain has its own `AgentTaxV2` contract address

    **Step 3: For Each Chain**
    - Get chain-specific config (RPC, AgentTaxV2 address, conversion rate key)
    - Fetch `minSwapThreshold` from `AgentTaxV2` contract
    - For each token, call `getTokenTaxAmounts(preToken)`:
      - If `(amountCollected - amountSwapped) >= minSwapThreshold`, add to batch

    **Step 4: Execute Batch Swap**
    - Calculate `minOutput = pendingAmount * conversionRate`
    - Adjust for asset token decimals (8 for cbBTC, 18 for WETH/WBNB)
    - Call `batchSwapForTokenAddress(tokenAddresses, minOutputs)` with max 100 tokens per batch

    **Configuration Required** (in `config.{stage}.json`):
    ```json
    {
      "AGENT_TAX_V2_BASE": "0x...",
      "AGENT_TAX_V2_ETH": "0x...",
      "AGENT_TAX_V2_BSC": "0x...",
      "DISTRIBUTE_TAX_GAS_MULTIPLIER": "1.3"
    }
    ```

    **Conversion Rate Keys** (already updated by `updateVirtRate`):
    - Base: `VIRTBTC_RATE` (VIRTUAL → cbBTC)
    - ETH: `VIRTETH_RATE` (VIRTUAL → WETH)
    - BSC: `VIRTBNB_RATE` (VIRTUAL → WBNB)

### Configuration Sync (Important)

13. [ ] Maintain configuration for both tax contracts:

| Config | AgentTax (V2 tokens) | AgentTaxV2 (V3 tokens) |
|--------|---------------------|------------------------|
| Router | Existing | Same or new |
| Treasury | Existing | Same |
| FeeRate | 3000 (30%) | 3000 (30%) |
| MinThreshold | 100 VIRTUAL | 100 VIRTUAL |
| MaxThreshold | 10000 VIRTUAL | 10000 VIRTUAL |

---

## 8. Conclusion

The on-chain tax attribution solution provides a scalable approach for multi-chain expansion by eliminating the need for chain-specific `tax-listener` services.

**Full V4 vs V5 Suite Comparison:**

| Component | V4 Suite (Legacy) | V5 Suite (New) |
|-----------|------------------|----------------|
| Bonding | BondingV4 | BondingV5 |
| AgentFactory | AgentFactoryV6 | **AgentFactoryV7** |
| AgentToken | AgentTokenV2 | AgentTokenV3 |
| FFactory | FFactoryV2 | FFactoryV3 |
| FRouter | FRouterV2 | FRouterV3 |
| FPair | FPairV2 | FPairV2 (reused) |
| Tax Contract | AgentTax | AgentTaxV2 |
| Tax Attribution | Off-chain (tax-listener) | On-chain (depositTax) |

**Architecture Flow:**
```
V4 Suite:
  BondingV4 → AgentFactoryV6 → AgentTokenV2
                    ↓
            FFactoryV2 → FRouterV2 → AgentTax (tax-listener processes)
  
V5 Suite:
  BondingV5 → AgentFactoryV7 → AgentTokenV3
                    ↓
            FFactoryV3 → FRouterV3 → AgentTaxV2 (on-chain attribution)
```

**Why AgentFactoryV7?**
- `AgentFactoryV6` and `AgentFactoryV7` share the same `_tokenTaxParams` which includes `projectTaxRecipient`
- V6's `projectTaxRecipient` → AgentTax (for graduated AgentTokenV2 tax)
- V7's `projectTaxRecipient` → AgentTaxV2 (for graduated AgentTokenV3 tax)
- Using separate factories ensures clean separation and no configuration conflicts

**Key Trade-offs:**
- Users pay ~6-9% more gas per trade
- This percentage remains constant regardless of gas price fluctuations
- Two complete suites to maintain (V4 + V5)

**Key Benefits:**
- No new tax-listener service needed per chain (saves ~$50-100/month per chain)
- Real-time tax attribution
- Simplified backend architecture (no tx scanning/grouping)
- No risk of missed transactions
- Clean separation between legacy (V4) and new (V5) ecosystems
- Clean `AgentTaxV2` contract (~300 lines vs ~670 lines)
- No legacy code or deprecated fields in V5 suite

**Critical Requirements:**
- Tax-listener must be updated to skip BondingV5 tokens
- Deploy `distributeTaxMultichain` Lambda to trigger swaps hourly
- Configure `AGENT_TAX_V2_*` addresses for each chain
- Deploy and configure AgentFactoryV7 with `projectTaxRecipient = AgentTaxV2`
- Grant `BONDING_ROLE` to BondingV5 in AgentFactoryV7
