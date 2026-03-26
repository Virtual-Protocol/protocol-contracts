# Smart Contract Audit Summary - LaunchpadV5

**Branch:** `feat/vp-2016`  
**Commit:** `latest commit from git branch feat/vp-2016`  
**Date:** March 2026

---

## 1. Context & Motivation

### Background

Virtuals Protocol currently operates bonding curve launches across multiple chains (Base, Ethereum, Solana). The existing implementation (`BondingV2`), (`BondingV3 (deprecated)`), (`BondingV4`) has accumulated various launch modes and configurations that were added incrementally:

- **Normal Launch**: Standard bonding curve with 99-minute anti-sniper tax decay
- **X-Launch**: Partnership launches with 99-second anti-sniper tax decay
- **ACP Skill Launch**: Agent Commerce Protocol skill-based launches
- **Project 60-days**: Time-locked creator reward distribution
- **ACF (Agent Creation Fund)**: 50% token reserve for operations

Each mode was implemented separately, leading to:
1. Fragmented logic across multiple contracts
2. Hardcoded parameters that require contract upgrades to modify
3. Difficulty in deploying consistent configurations across new chains

### Goal

**Unify the launch mechanism into a more flexible and configurable architecture** to:
1. Enable easier multi-chain expansion with chain-specific configurations
2. Consolidate all launch modes into a single, parameterized system
3. Make bonding curve parameters adjustable without contract upgrades
4. Improve code maintainability and auditability

---

## 2. Scope of Changes

### New Contracts

| Contract | Lines | Description |
|----------|-------|-------------|
| `BondingConfig.sol` | 362 | Configuration contract storing all adjustable parameters |
| `BondingV5.sol` | 718 | New bonding curve contract with unified launch logic |

### Modified Contracts

| Contract | Changes | Description |
|----------|---------|-------------|
| `FRouterV2.sol` | +129 lines | Added BondingV5 integration for configurable anti-sniper tax |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User (Creator)                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ preLaunch() / launch() / buy() / sell()
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          BondingV5                              │
│  - Unified launch logic for all modes                           │
│  - Per-token configurable parameters                            │
│  - Graduation threshold calculated per-token                    │
└─────────────────────────────────────────────────────────────────┘
        │                       │                       │
        │ reads config          │ creates pair          │ creates token
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────────┐
│ BondingConfig │      │  FFactoryV2   │      │  AgentFactoryV6   │
│               │      │               │      │                   │
│ - Launch fees │      │ - Creates     │      │ - Creates agent   │
│ - Bonding     │      │   FPairV2     │      │   token           │
│   curve params│      │               │      │ - Manages         │
│ - Anti-sniper │      └───────────────┘      │   applications    │
│   types       │              │              └───────────────────┘
│ - Authorized  │              │
│   launchers   │              ▼
└───────────────┘      ┌───────────────┐
                       │  FRouterV2    │
                       │               │
                       │ - Executes    │
                       │   trades      │
                       │ - Calculates  │
                       │   anti-sniper │
                       │   tax         │
                       └───────────────┘
```

---

## 4. Key Changes Detail

### 4.1 BondingConfig.sol (New)

**Purpose:** Centralized configuration contract for multi-chain deployments.

#### Launch Mode Constants
```solidity
uint8 public constant LAUNCH_MODE_NORMAL = 0;    // Open to everyone (Project60days uses this + flag)
uint8 public constant LAUNCH_MODE_X_LAUNCH = 1;  // isPrivilegedLauncher on preLaunch + launch() (backend taxRecipient)
uint8 public constant LAUNCH_MODE_ACP_SKILL = 2; // isPrivilegedLauncher on preLaunch + launch() (backend taxRecipient)
```

#### Anti-Sniper Tax Type Constants
```solidity
uint8 public constant ANTI_SNIPER_NONE = 0;  // No anti-sniper tax (0 seconds)
uint8 public constant ANTI_SNIPER_60S = 1;   // 60 seconds duration
uint8 public constant ANTI_SNIPER_98M = 2;   // 98 minutes duration (5880 seconds)
```

#### Reserve Percentage Constants
```solidity
uint8 public constant MAX_TOTAL_RESERVED_PERCENT = 55; // At least 45% must remain in bonding curve
uint8 public constant ACF_RESERVED_PERCENT = 50;       // ACF operations reserve 50%
```

#### Configurable Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initialSupply` | `uint256` | Token initial supply (e.g., 1 billion) |
| `feeTo` | `address` | Address to receive launch fees |
| `teamTokenReservedWallet` | `address` | Wallet for airdrop + ACF reserved tokens |
| `maxAirdropPercent` | `uint8` | Maximum allowed airdrop percentage (e.g., 5%) |
| `scheduledLaunchParams` | `struct` | startTimeDelay, normalLaunchFee, acfFee |
| `deployParams` | `struct` | tbaSalt, tbaImplementation, daoVotingPeriod, daoThreshold |
| `bondingCurveParams` | `struct` | fakeInitialVirtualLiq, targetRealVirtual |
| `isPrivilegedLauncher` | `mapping` | Backend wallets: X_LAUNCH/ACP `preLaunch`; X_LAUNCH, ACP_SKILL, or Project60days `launch()` (taxRecipient must be updated off-chain before `launch()`) |

#### Key Functions

```solidity
// Calculate bonding curve supply after reserves
function calculateBondingCurveSupply(uint8 airdropPercent_, bool needAcf_) 
    external view returns (uint256);

// Calculate graduation threshold for a token
function calculateGradThreshold(uint256 bondingCurveSupplyWei_) 
    external view returns (uint256);

// Calculate launch fee based on launch type
function calculateLaunchFee(bool isScheduledLaunch_, bool needAcf_) 
    external view returns (uint256);

// Get anti-sniper duration for a given type
function getAntiSniperDuration(uint8 antiSniperType_) 
    external pure returns (uint256);
```

---

### 4.2 BondingV5.sol (New)

**Purpose:** Unified bonding curve contract with per-token configurable parameters.

#### Per-Token Storage

```solidity
// Stores token info (same as BondingV4)
mapping(address => BondingConfig.Token) public tokenInfo;

// NEW: Stores configurable launch parameters per token
mapping(address => BondingConfig.LaunchParams) public tokenLaunchParams;

// NEW: Stores graduation threshold per token (calculated based on airdropPercent and needAcf)
mapping(address => uint256) public tokenGradThreshold;
```

#### LaunchParams Structure
```solidity
struct LaunchParams {
    uint8 launchMode;        // 0=Normal, 1=X-Launch, 2=ACP-Skill
    uint8 airdropPercent;    // 0-5%
    bool needAcf;            // Whether 50% is reserved for ACF
    uint8 antiSniperTaxType; // 0=None, 1=60s, 2=98min
    bool isProject60days;    // Whether creator rewards are time-locked
}
```

#### preLaunch Function

**New Signature:**
```solidity
function preLaunch(
    string memory name_,
    string memory ticker_,
    uint8[] memory cores_,
    string memory desc_,
    string memory img_,
    string[4] memory urls_,
    uint256 purchaseAmount_,
    uint256 startTime_,
    // NEW: Configurable parameters
    uint8 launchMode_,
    uint8 airdropPercent_,
    bool needAcf_,
    uint8 antiSniperTaxType_,
    bool isProject60days_
) public nonReentrant returns (address, address, uint, uint256)
```

**Key Logic Changes:**

1. **Fail-Fast Validation:**
   - Validates `airdropPercent <= maxAirdropPercent`
   - Validates `totalReserved < MAX_TOTAL_RESERVED_PERCENT` (55%)
   - Validates `antiSniperTaxType` is valid (0, 1, or 2)

2. **Launch Type Determination:**
   - Immediate launch: `startTime < now + scheduledLaunchParams.startTimeDelay`
   - Scheduled launch: `startTime >= now + scheduledLaunchParams.startTimeDelay`

3. **Fee Calculation:**
   - Immediate + no ACF: `0`
   - Immediate + ACF: `acfFee`
   - Scheduled + no ACF: `normalLaunchFee`
   - Scheduled + ACF: `normalLaunchFee + acfFee`

4. **Special Mode Validation:**
   - X-Launch and ACP-Skill modes require:
     - `antiSniperTaxType = ANTI_SNIPER_NONE`
     - Immediate launch (not scheduled)
     - `airdropPercent = 0`
     - `needAcf = false`
     - `isProject60days = false`

5. **Per-Token Graduation Threshold:**
   - Calculated during `preLaunch` based on token's specific `airdropPercent` and `needAcf`
   - Formula: `gradThreshold = y0 * x0 / (targetRealVirtual + y0)`
   - Where: `y0 = fakeInitialVirtualLiq`, `x0 = bondingCurveSupply`

6. **`launch()` and privileged backend (tax recipient):**
   - X_LAUNCH, ACP_SKILL, and Project60days (`NORMAL` + `isProject60days`) share a requirement that **taxRecipient** (AgentTax / related flows) is configured by the **backend before trading starts**.
   - `BondingV5.launch()` therefore requires `isPrivilegedLauncher(msg.sender)` for those three cases so only the backend wallet executes `launch()` after off-chain setup.

#### View Functions for External Contracts

```solidity
// Classify token for tax recipient / ops (X_LAUNCH, ACP_SKILL, Project60days need backend taxRecipient before launch())
function isProject60days(address token_) external view returns (bool);
function isProjectXLaunch(address token_) external view returns (bool);
function isAcpSkillLaunch(address token_) external view returns (bool);

// Used by FRouterV2 for anti-sniper tax calculation
function tokenAntiSniperType(address token_) external view returns (uint8);
```

---

### 4.3 FRouterV2.sol (Modified)

**Purpose:** Support BondingV5's configurable anti-sniper tax types.

#### New State Variables
```solidity
IBondingV5ForRouter public bondingV5;
IBondingConfigForRouter public bondingConfig;
```

#### New Setter Function
```solidity
function setBondingV5(address bondingV5_, address bondingConfig_) 
    public onlyRole(ADMIN_ROLE);
```

#### Modified Anti-Sniper Tax Calculation

**Previous Logic (BondingV4):**
- Regular tokens: 99% → 0% over 99 minutes (1% per minute)
- X-Launch tokens: 99% → 0% over 99 seconds (1% per second)

**New Logic (BondingV5):**
1. Check if token exists in BondingV5
2. Get `antiSniperTaxType` from BondingV5
3. Get duration from BondingConfig:
   - `ANTI_SNIPER_NONE (0)`: 0 seconds → immediate 0% tax
   - `ANTI_SNIPER_60S (1)`: 60 seconds → linear decay from 99% to 0%
   - `ANTI_SNIPER_98M (2)`: 5880 seconds → linear decay from 99% to 0%
4. Fall back to legacy logic if token not in BondingV5

**Tax Formula:**
```
tax = startTax * (duration - timeElapsed) / duration
```

---

## 5. Security Considerations

### 5.1 Access Control

| Contract | Role | Permissions |
|----------|------|-------------|
| BondingConfig | `owner` | All setter functions |
| BondingV5 | `owner` | `setBondingConfig()` |
| FRouterV2 | `ADMIN_ROLE` | `setBondingV5()` |

### 5.2 Potential Attack Vectors to Review

1. **Reserve Percentage Manipulation**
   - Ensure `MAX_TOTAL_RESERVED_PERCENT` (55%) cannot be bypassed
   - Verify `airdropPercent + ACF_RESERVED_PERCENT` is properly validated

2. **Launch Mode Authorization**
   - Verify `isPrivilegedLauncher` mapping is only modifiable by owner
   - Ensure X_LAUNCH / ACP_SKILL parameter restrictions on `preLaunch()` and privileged `launch()` for X_LAUNCH, ACP_SKILL, and Project60days (taxRecipient orchestration)

3. **Graduation Threshold Calculation**
   - Verify per-token `tokenGradThreshold` cannot be manipulated post-launch
   - Ensure calculation uses correct bonding curve supply

4. **Anti-Sniper Tax Bypass**
   - Verify `FRouterV2` correctly falls back to legacy logic for non-BondingV5 tokens
   - Ensure `tokenAntiSniperType` reverts for non-existent tokens

5. **Fee Collection**
   - Verify launch fees are transferred to `feeTo` before token creation
   - Ensure `purchaseAmount >= launchFee` check is enforced

6. **Reentrancy**
   - `BondingV5.preLaunch()` uses `nonReentrant` modifier
   - Verify all external calls follow checks-effects-interactions pattern

### 5.3 Backward Compatibility

- `FRouterV2` maintains full backward compatibility with BondingV4 and older tokens
- Anti-sniper tax calculation falls back to legacy logic if `bondingV5` is not set or token not found

---

## 6. Test Coverage

Test file: `test/launchpadv5/bondingV5.js` (2274 lines)

Key test scenarios:
- Normal launch with various parameter combinations
- X-Launch and ACP-Skill authorization checks (`preLaunch` + `launch()`)
- Project60days and privileged `launch()` (backend taxRecipient ordering)
- Scheduled vs immediate launch fee calculation
- Anti-sniper tax type validation and decay
- Graduation threshold calculation with different airdrop/ACF settings
- Reserve percentage boundary tests

---

## 7. Deployment Scripts

| Script | Purpose |
|--------|---------|
| `deployLaunchpadv5_0.ts` | Deploy AgentNftV2, AgentTax |
| `deployLaunchpadv5_1.ts` | Deploy FFactoryV2, FRouterV2 |
| `deployLaunchpadv5_2.ts` | Deploy AgentFactoryV6 |
| `deployLaunchpadv5_3.ts` | Deploy BondingConfig, BondingV5 |
| `deployLaunchpadv5_4.ts` | Revoke deployer roles |

---

## 8. Testing & Utility Scripts

### 8.1 e2e_test.ts

**Purpose:** Comprehensive end-to-end test script for BondingV5 on testnets (e.g., Base Sepolia, ETH Sepolia).

**Features:**
- Verifies all configuration parameters from BondingConfig
- Checks role assignments (BONDING_ROLE, CREATOR_ROLE, EXECUTOR_ROLE)
- Tests complete token lifecycle:
  1. `preLaunch()` with configurable parameters (launch mode, airdrop, ACF, anti-sniper type)
  2. `launch()` to start trading
  3. `buy()` and `sell()` operations on bonding curve
  4. Graduation trigger when threshold is reached
- Validates fee collection and distribution
- Tests anti-sniper tax decay over time

**Usage:**
```bash
npx hardhat run scripts/launchpadv5/e2e_test.ts --network <network>
```

### 8.2 deploy_agent_tax_swap.ts

**Purpose:** Deploy a mock tax token and set up Uniswap V2 liquidity pool for testing AgentTax swap functionality.

**Features:**
1. Deploys MockERC20 as a test "tax token" (e.g., fake WETH)
2. Creates VIRTUAL/TAX liquidity pool on Uniswap V2
3. Tests bidirectional swaps (VIRTUAL -> TAX and TAX -> VIRTUAL)
4. Verifies AMM functionality for AgentTax's `handleAgentTaxes()` swap logic

**Use Case:** Required for testing AgentTax on chains where the tax token (e.g., WETH) doesn't have sufficient VIRTUAL liquidity.

**Usage:**
```bash
npx hardhat run scripts/launchpadv5/deploy_agent_tax_swap.ts --network <network>
```

### 8.3 handle_agent_tax.ts

**Purpose:** Manual script to call `AgentTax.handleAgentTaxes()` for distributing collected tax to creator and treasury.

**Features:**
- Calls `handleAgentTaxes(agentId, txhashes, amounts, minOutput)` on AgentTax contract
- Validates EXECUTOR_ROLE permission before execution
- Checks if txhashes have already been processed
- Shows before/after tax amounts for verification
- Includes 5-second confirmation delay for safety

**Key Parameters:**
- `AGENT_ID`: NFT token ID from AgentNft (not BondingV5's virtualId)
- `TX_HASHES`: Array of transaction hashes that collected tax (bytes32)
- `AMOUNTS`: Corresponding tax amounts in wei
- `MIN_OUTPUT`: Slippage protection for swap

**Usage:**
```bash
npx hardhat run scripts/launchpadv5/handle_agent_tax.ts --network <network>
```

---

## 9. Files Changed Summary

```
contracts/launchpadv2/BondingConfig.sol     | 362 +++++ (NEW)
contracts/launchpadv2/BondingV5.sol         | 718 +++++ (NEW)
contracts/launchpadv2/FRouterV2.sol         | 129 +- (MODIFIED)
test/launchpadv5/bondingV5.js               | 2274 +++++ (NEW)
scripts/launchpadv5/*.ts                    | ~2000 lines (NEW)
```

---

## 10. Audit Checklist

- [ ] BondingConfig parameter validation and access control
- [ ] BondingV5 launch mode authorization logic
- [ ] Reserve percentage calculations (airdrop + ACF)
- [ ] Graduation threshold calculation per token
- [ ] Fee collection and transfer logic
- [ ] Anti-sniper tax calculation in FRouterV2
- [ ] Backward compatibility with BondingV4 tokens
- [ ] Reentrancy protection
- [ ] Integer overflow/underflow (Solidity 0.8.20)
- [ ] External call safety
- [ ] Event emission correctness

---

## 11. Contact

For questions about this audit scope, please contact the Virtuals Protocol team.
