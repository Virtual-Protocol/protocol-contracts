# Smart Contract Audit Summary V2 - On-Chain Tax Attribution

**Previous Audit Commit:** `8a539e03b727d14c35522d241c3023ec24388010`  
**Current Commit:** feat/vp-2173 lastest commit
**PR:** 
**Date:** March 2026

---

## 1. Executive Summary

This document describes changes made since the previous audit, focusing on the implementation of **on-chain tax attribution** which eliminates the need for chain-specific `tax-listener` backend services.

### Key Changes Since Last Audit

| Category | Details |
|----------|---------|
| **New Contracts** | `AgentTaxV2.sol`, `FFactoryV3.sol`, `FRouterV3.sol`, `AgentTokenV3.sol`, `IAgentTokenV3.sol` |
| **Modified Contracts** | `BondingV5.sol`, `BondingConfig.sol`, `AgentFactoryV6.sol`, `AgentTax.sol` |
| **Total Lines Changed** | ~2,100 lines in contracts |

### Files Changed (Contracts Only)

```
contracts/launchpadv2/BondingConfig.sol     |  105 ++-
contracts/launchpadv2/BondingV5.sol         |  195 +++--
contracts/launchpadv2/FFactoryV3.sol        |  135 +++ (NEW)
contracts/launchpadv2/FRouterV3.sol         |  335 ++++++++ (NEW)
contracts/tax/AgentTax.sol                  |  177 ++++
contracts/tax/AgentTaxV2.sol                |  375 ++++++++ (NEW)
contracts/virtualPersona/AgentFactoryV6.sol |   12 +-
contracts/virtualPersona/AgentTokenV3.sol   | 1238 +++++++ (NEW)
contracts/virtualPersona/IAgentTokenV3.sol  |   14 + (NEW)
```

### Commits Since Last Audit

```
130cf00 add getAmountsOut validation before swap
7e4d0c4 init on-chain tax attribution
896d71c upgrade contracts and upload deployment json
6c2bee8 fix: Incorrect Boundary Condition for Reserved Percentage
bba530b fix: Cancelled launches still become tradable at scheduled start
854e4af make scheduledLaunchParams and deployParams var public
65af952 make airdropPercent related to bips
```

---

## 2. On-Chain Tax Attribution Architecture

For detailed architecture documentation, see: **[OnChainTaxAttribution.md](./OnChainTaxAttribution.md)**

### Summary

The core change is moving tax attribution from off-chain (tax-listener backend) to on-chain:

**Previous Architecture (V4 Suite):**
```
Trade → FRouterV2 → direct VIRTUAL transfer → AgentTax
                                                  ↓
                                    tax-listener scans events
                                                  ↓
                                    Backend: handleAgentTaxes(agentId, txhashes, amounts)
```

**New Architecture (V5 Suite):**
```
Trade → FRouterV3 → AgentTaxV2.depositTax(tokenAddress, amount)
                                                  ↓
                               Tax immediately attributed to token
                                                  ↓
                               Backend: swapForTokenAddress(tokenAddress, minOutput)
```

### V5 Suite Components

| Component | Contract | Purpose |
|-----------|----------|---------|
| Bonding | `BondingV5` | Launch tokens, calls `registerToken()` on AgentTaxV2 |
| Factory | `AgentFactoryV7` | Creates AgentTokenV3, points to AgentTaxV2 |
| Token | `AgentTokenV3` | Calls `depositTax()` in `_swapTax()` |
| Pair Factory | `FFactoryV3` | Creates pairs with FRouterV3 |
| Router | `FRouterV3` | Calls `depositTax()` for buy/sell taxes |
| Tax Contract | `AgentTaxV2` | On-chain tax attribution and distribution |

---

## 3. Security Focus Areas

### 3.1 Fund Safety & Reentrancy Risk

#### AgentTaxV2.sol (~375 lines)

| Function | External Calls | Reentrancy Risk | Mitigation |
|----------|---------------|-----------------|------------|
| `depositTax()` | `safeTransferFrom` | Low | State updated after transfer, no callbacks |
| `swapForTokenAddress()` | Router `swapExactTokensForTokens` | Medium | State update (`amountSwapped`) AFTER swap; uses try-catch |
| `_swapAndDistribute()` | Router swap + 2x `safeTransfer` | Medium | State updated before distributions |

**Key Observation - `_swapAndDistribute()` Pattern:**
```solidity
// Line 259: State update AFTER swap but BEFORE distributions
amounts.amountSwapped += amountToSwap;

// Then distributions (lines 251-257)
IERC20(assetToken).safeTransfer(recipient.creator, creatorFee);
IERC20(assetToken).safeTransfer(treasury, protocolFee);
```

**Recommendation:** Consider adding `nonReentrant` modifier to `swapForTokenAddress()` and `batchSwapForTokenAddress()` for defense-in-depth.

#### FRouterV3.sol (~335 lines)

| Function | External Calls | Reentrancy Risk | Mitigation |
|----------|---------------|-----------------|------------|
| `buy()` | Pair operations + `depositTax()` | Medium | Follows checks-effects-interactions |
| `sell()` | Pair operations + `depositTax()` | Medium | Follows checks-effects-interactions |
| `buyV5()` / `sellV5()` | Same pattern | Medium | Same pattern |

**Tax Flow in FRouterV3:**
```solidity
// After trade calculation, calls depositTax
if (taxAmount > 0) {
    IERC20(taxToken).safeTransferFrom(msg.sender, address(this), taxAmount);
    IERC20(taxToken).forceApprove(taxVault, taxAmount);
    IAgentTaxV2(taxVault).depositTax(pair.tokenA(), taxAmount);
}
```

#### AgentTokenV3.sol (~1238 lines)

| Function | External Calls | Reentrancy Risk | Mitigation |
|----------|---------------|-----------------|------------|
| `_swapTax()` | Router swap + `depositTax()` | Medium | Inherited from AgentTokenV2 pattern |

**Graduated Token Tax Flow:**
```solidity
// After Uniswap swap in _swapTax()
IERC20(taxToken).forceApprove(projectTaxRecipient, taxAmount);
IAgentTaxV2(projectTaxRecipient).depositTax(address(this), taxAmount);
```

---

### 3.2 Access Control & Permission Management

#### AgentTaxV2 Roles

| Role | Granted To | Permissions |
|------|------------|-------------|
| `DEFAULT_ADMIN_ROLE` | Deployer initially | Can grant/revoke all roles |
| `ADMIN_ROLE` | Admin wallet | `updateSwapParams`, `updateSwapThresholds`, `updateTreasury`, `withdraw` |
| `EXECUTOR_ROLE` | BondingV5, Backend wallet | `registerToken`, `swapForTokenAddress`, `batchSwapForTokenAddress` |

#### Deployment Scripts Role Assignment

**deployLaunchpadv5_0.ts (AgentTaxV2):**
```typescript
// Roles granted during deployment
AgentTaxV2.grantRole(ADMIN_ROLE, ADMIN_WALLET);
AgentTaxV2.grantRole(EXECUTOR_ROLE, BE_OPS_WALLET);  // Backend executor
// Note: BondingV5 gets EXECUTOR_ROLE in step 3
```

**deployLaunchpadv5_3.ts (BondingV5):**
```typescript
// BondingV5 needs EXECUTOR_ROLE to call registerToken
AgentTaxV2.grantRole(EXECUTOR_ROLE, BondingV5.address);
```

**deployLaunchpadv5_4.ts (Role Revocation):**
```typescript
// Revoke deployer roles from all contracts
AgentTaxV2.revokeRole(ADMIN_ROLE, deployer);
AgentTaxV2.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
// Similar for other contracts
```

**Security Note:** The revocation order in `deployLaunchpadv5_4.ts` uses try-catch blocks to handle cases where roles may have already been revoked:

```typescript
try {
    await agentTaxV2.revokeRole(ADMIN_ROLE, deployer);
} catch (e) {
    console.log("Warning: Could not revoke ADMIN_ROLE (may already be revoked)");
}
```

#### FFactoryV3 Roles

| Role | Granted To | Permissions |
|------|------------|-------------|
| `DEFAULT_ADMIN_ROLE` | Deployer initially | Can grant/revoke all roles |
| `ADMIN_ROLE` | Admin wallet | Configuration functions |
| `CREATOR_ROLE` | BondingV5 | `createPair` |

#### AgentFactoryV7 Roles

| Role | Granted To | Permissions |
|------|------------|-------------|
| `DEFAULT_ADMIN_ROLE` | Deployer initially | Can grant/revoke all roles |
| `BONDING_ROLE` | BondingV5 | Token creation and management |

---

### 3.3 Critical Functions to Audit

#### 1. `AgentTaxV2.registerToken()` - Token Registration

```solidity
function registerToken(
    address tokenAddress,
    address tba,
    address creator
) external onlyRole(EXECUTOR_ROLE) {
    require(tokenAddress != address(0), "Invalid token address");
    require(creator != address(0), "Invalid creator");
    
    // Can overwrite existing registration - is this intended?
    tokenRecipients[tokenAddress] = TaxRecipient({
        tba: tba,
        creator: creator
    });
    
    emit TokenRegistered(tokenAddress, creator, tba);
}
```

**Audit Questions:**
- Should re-registration of the same token be allowed?
- What prevents malicious registration of arbitrary tokens?

#### 2. `AgentTaxV2.depositTax()` - Tax Deposit

```solidity
function depositTax(address tokenAddress, uint256 amount) external {
    TaxRecipient memory recipient = tokenRecipients[tokenAddress];
    require(recipient.creator != address(0), "Token not registered");
    require(amount > 0, "Amount must be greater than 0");

    IERC20(taxToken).safeTransferFrom(msg.sender, address(this), amount);

    TaxAmounts storage amounts = tokenTaxAmounts[tokenAddress];
    amounts.amountCollected += amount;

    emit TaxDeposited(tokenAddress, amount);
}
```

**Audit Questions:**
- No access control - anyone can deposit. Is this intentional?
- Integer overflow in `amounts.amountCollected` (Solidity 0.8.20 has built-in checks)

#### 3. `AgentTaxV2._swapAndDistribute()` - Tax Distribution

```solidity
function _swapAndDistribute(...) internal {
    uint256 amountToSwap = amounts.amountCollected - amounts.amountSwapped;
    
    if (amountToSwap < minSwapThreshold) return;
    if (amountToSwap > maxSwapThreshold) amountToSwap = maxSwapThreshold;
    
    uint256 balance = IERC20(taxToken).balanceOf(address(this));
    if (balance < amountToSwap) return;  // Silently returns if insufficient balance
    
    // Validates price before swap
    uint256[] memory amountsOut = router.getAmountsOut(amountToSwap, path);
    require(amountsOut.length > 1, "Failed to fetch token price");
    
    try router.swapExactTokensForTokens(...) returns (uint256[] memory swapAmounts) {
        // Distribution logic
        amounts.amountSwapped += amountToSwap;  // State update
        
        // Distributions
        IERC20(assetToken).safeTransfer(recipient.creator, creatorFee);
        IERC20(assetToken).safeTransfer(treasury, protocolFee);
    } catch {
        emit SwapFailed(tokenAddress, amountToSwap);
    }
}
```

**Audit Questions:**
- Silent return on insufficient balance - should this emit an event?
- State update order relative to external calls
- `getAmountsOut` validation added (commit 130cf00)

#### 4. `BondingV5.launch()` - Token Launch with Registration

```solidity
// In launch() after token graduation
IAgentTaxV2(taxVault).registerToken(
    token,
    tba,
    tokenInfo_[token].creator
);
```

---

## 4. Local Deployment & Testing

### Prerequisites

1. Node.js >= 18
2. Clone repository and install dependencies:
   ```bash
   cd protocol-contracts
   npm install
   ```

3. Create environment file:
   ```bash
   cp .env.launchpadv5_local.example .env.launchpadv5_local
   # Edit with your BASE_SEPOLIA_RPC_URL and private keys
   ```

### 4.1 Full Local Deployment

Use the deployment orchestration script:

```bash
# From protocol-contracts directory

# Full deployment (starts local fork + deploys all contracts)
./scripts/launchpadv5/run_local_deploy.sh

# Or specify network/env explicitly
./scripts/launchpadv5/run_local_deploy.sh --network local --env .env.launchpadv5_local
```

**What it does:**
1. Kills any existing Hardhat node
2. Starts local fork of Base Sepolia
3. Runs deployment scripts 0-3 sequentially
4. Saves deployed addresses to env file

**Deployment Steps:**
- Step 0: Deploy AgentNftV2, AgentTaxV2
- Step 1: Deploy FFactoryV3, FRouterV3
- Step 2: Deploy AgentTokenV3 impl, AgentVeTokenV2 impl, AgentDAO impl, AgentFactoryV7
- Step 3: Deploy BondingConfig, BondingV5, configure all roles

**Individual Steps:**
```bash
./scripts/launchpadv5/run_local_deploy.sh 0   # Run only step 0
./scripts/launchpadv5/run_local_deploy.sh 1   # Run only step 1
./scripts/launchpadv5/run_local_deploy.sh 2   # Run only step 2
./scripts/launchpadv5/run_local_deploy.sh 3   # Run only step 3
./scripts/launchpadv5/run_local_deploy.sh 4   # Revoke deployer roles (production)
```

### 4.2 End-to-End Testing

After deployment, run the comprehensive E2E test:

```bash
# Local network
ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/e2e_test.ts --network local

# Base Sepolia
ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/e2e_test.ts --network base_sepolia
```

**E2E Test Verifies:**
1. BondingConfig parameters
2. FFactoryV3 tax configuration
3. `preLaunch()` with configurable parameters
4. On-chain tokenInfo and tokenLaunchParams storage
5. Anti-sniper tax configuration
6. `launch()` execution
7. `buy()` during and after anti-sniper period
8. `sell()` with tax collection
9. Tax recorded in AgentTaxV2
10. `batchSwapForTokenAddress()` tax distribution

### 4.3 Batch Swap Tax Script

Test or execute tax distribution manually:

```bash
# Edit TOKEN_ADDRESSES in the script first
ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/batch_swap_tax.ts --network local

# Or for testnet
ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/batch_swap_tax.ts --network base_sepolia
```

**Script Configuration (edit in file):**
```typescript
const TOKEN_ADDRESSES: string[] = [
  "0x...",  // Token addresses to swap tax for
];

const MIN_OUTPUTS: bigint[] = [
  0n,  // Use 0 for no slippage protection (testing only!)
];
```

**Script Functions:**
- Reads pending tax from AgentTaxV2
- Validates EXECUTOR_ROLE
- Executes `batchSwapForTokenAddress()`
- Reports SwapExecuted/SwapFailed events

### 4.4 Network Options

| Network | Command | Description |
|---------|---------|-------------|
| local | `--network local` | Fork of Base Sepolia |
| base_sepolia | `--network base_sepolia` | Base Sepolia testnet |
| base | `--network base` | Base mainnet (use with caution) |

---

## 5. Audit Checklist

### Fund Safety

- [ ] `AgentTaxV2._swapAndDistribute()` state update ordering
- [ ] Reentrancy protection in swap functions
- [ ] Integer overflow/underflow (Solidity 0.8.20 built-in)
- [ ] Silent failures in `_swapAndDistribute()` (insufficient balance)
- [ ] Token approval patterns (`forceApprove` vs `approve`)

### Access Control

- [ ] `EXECUTOR_ROLE` assignment to BondingV5 and backend wallet
- [ ] Role revocation in `deployLaunchpadv5_4.ts`
- [ ] `registerToken()` - can overwrite existing registrations?
- [ ] `updateCreator()` - only creator or admin can update

### External Calls

- [ ] Router interaction in `_swapAndDistribute()`
- [ ] `depositTax()` call from FRouterV3 and AgentTokenV3
- [ ] `getAmountsOut()` validation before swap
- [ ] Try-catch around swap operations

### Configuration

- [ ] `minSwapThreshold` / `maxSwapThreshold` validation
- [ ] `feeRate` bounds check (≤ 10000)
- [ ] Treasury address non-zero validation

### Integration

- [ ] BondingV5 → AgentTaxV2 `registerToken()` flow
- [ ] FRouterV3 → AgentTaxV2 `depositTax()` flow
- [ ] AgentTokenV3 → AgentTaxV2 `depositTax()` flow (graduated tokens)

---

## 6. Contract Addresses (Base Sepolia - Development)

After deployment, addresses are saved to the env file. Example:

```bash
AGENT_NFT_V2_ADDRESS=0x...
AGENT_TAX_V2_CONTRACT_ADDRESS=0x...
FFactoryV3_ADDRESS=0x...
FRouterV3_ADDRESS=0x...
AGENT_TOKEN_V3_IMPLEMENTATION=0x...
AGENT_FACTORY_V7_ADDRESS=0x...
BONDING_CONFIG_ADDRESS=0x...
BONDING_V5_ADDRESS=0x...
```

---

## 7. Contact

For questions about this audit scope, please contact the Virtuals Protocol team.
