# LaunchpadV2 Technical Solution

## Overview

LaunchpadV2 is a comprehensive upgrade to the original launchpad system (fun folder), introducing pre-launch scheduling, anti-sniper protection, and simplified token mechanics. The key improvement is a **single-token model** that eliminates the complex dual-token system used in V1.

## Core Architecture

### Smart Contracts
- **BondingV2.sol** - Main bonding curve contract with pre-launch and launch phases
- **FFactoryV2.sol** - Factory for creating trading pairs with anti-sniper tax support  
- **FRouterV2.sol** - Router handling trades with dynamic tax calculation
- **FPairV2.sol** - Trading pair contract with time-based features
- **AgentTokenV2.sol** - Enhanced agent token with blacklist functionality
- **AgentVeTokenV2.sol** - VeToken contract with LP liquidity management
- **AgentFactoryV6.sol** - Factory contract with LP removal capabilities
- **IUniswapV2Router03.sol** - Extended router interface for liquidity operations

## Key Improvements from LaunchpadV1

### 1. Single Token Model (Major Change)

**LaunchpadV1 (Complex):**
- Created two tokens: temporary bonding token + final AgentToken
- Required `unwrapToken()` function to burn/mint between tokens after graduation
- Complex token migration process

**LaunchpadV2 (Simplified):**
- **Single AgentToken** used throughout entire lifecycle
- No token migration or unwrapping needed
- Direct integration with AgentToken.sol from the start
- Removes suffix "by Virtuals" when calling `initFromBondingCurve`

### 2. Pre-Launch Phase System

**New Two-Phase Launch:**
1. **Pre-Launch**: `preLaunch()` creates token but delays trading
2. **Launch**: `launch()` enables trading at scheduled time

```solidity
function preLaunch(
    string memory _name,
    string memory _ticker,
    uint8[] memory cores,
    string memory desc,
    string memory img,
    string[4] memory urls,
    uint256 purchaseAmount,
    uint256 startTime
) public nonReentrant

function launch(address _tokenAddress) public nonReentrant
```

**Benefits:**
- Allows marketing and preparation before trading starts
- 550M tokens (55%) reserved for team, distributed only after launch
- Prevents immediate sniping

### 3. Enhanced Anti-Sniper Protection

**Buy Operations:**
- 99% tax → 1% tax linear decay over 30 minutes
- Creator's initial purchase always uses 1% tax
- **Tax Distribution**: Anti-sniper tax is split between multiple vaults for better fund management

**Sell Operations:**
- Always 1% tax (no anti-sniper needed)
- Rationale: Snipers selling doesn't harm other users; they already paid higher buy tax

```solidity
// Tax calculation formula
buyTaxRate = 99% - (timeElapsed × 98%) / 30 minutes
sellTaxRate = 1% (fixed)
```

### 4. Token Blacklist System

**Pre-Graduation Protection:**
- Blacklist functionality available before token graduation
- Prevents malicious actors from participating during bonding curve phase
- Automatically disabled after graduation to maintain decentralization

```solidity
// Blacklist management (pre-graduation only)
function addBlacklistAddress(address _address) external onlyOwner
function removeBlacklistAddress(address _address) external onlyOwner
function isBlacklisted(address _address) external view returns (bool)
```

### 5. LP Liquidity Management

**AgentVeTokenV2 Integration:**
- New `AgentVeTokenV2` contract for enhanced veToken functionality
- LP liquidity removal capability for graduated tokens
- Role-based access control with `REMOVE_LIQUIDITY_ROLE`

```solidity
// LP liquidity removal (post-graduation)
function removeLpLiquidity(
    address veToken,
    address recipient,
    uint256 veTokenAmount,
    uint256 amountAMin,
    uint256 amountBMin,
    uint256 deadline
) public onlyRole(REMOVE_LIQUIDITY_ROLE)
```

**Key Features:**
- Secure LP token management through veToken system
- Uniswap V2 integration for liquidity operations
- Event tracking for transparency: `LiquidityRemoved` events

## Token Economics

### Core Parameters
- **Total Supply**: 1,000,000,000 tokens (1B)
- **Trading Supply**: 450,000,000 tokens (45% available for bonding curve)
- **Team Reserve**: 550,000,000 tokens (55% reserved, distributed after launch)
- **Bonding Curve**: X × Y = K where K = 1.35 × 10^12

### Mathematical Foundation

**Initial Setup:**
```
K = 1.35 × 10^12
assetRate = 5000
initialFakeVirtualLiquidity = 14,000 VIRTUAL tokens
tradingSupply = 450,000,000 tokens
```

**Graduation Economics:**
```
Target at graduation: 200,000 real VIRTUAL tokens accumulated
Graduation threshold: 29,439,252 tokens remaining

Calculation:
Pre-graduation: 14,000 × 450,000,000 = K
Post-graduation: (200,000 + 14,000) × Y = K
Solving: Y = 29,439,252 tokens

FDV at graduation:
Assuming $VIRTUAL = $1.2 USD
Price per token = (214,000 × 1.2) / 29,439,252 = $0.0087
FDV = $0.0087 × 10^9 = $8.7M USD
```

**Key Improvements:**
- Reduced graduation threshold from 125M to 29.4M tokens
- Increased initial fake liquidity from 6K to 14K VIRTUAL
- More efficient bonding curve progression

## Technical Features

### State Management
```solidity
struct Token {
    address creator;
    address token;           // Single AgentToken (no dual tokens)
    address pair;
    bool trading;           // Enabled after launch()
    bool launchExecuted;    // Track launch completion
    uint256 initialPurchase; // Creator's initial buy amount
    uint256 virtualId;      // Integration with virtual persona (reset after graduation)
}
```

### Enhanced Security Features
```solidity
// Blacklist management (pre-graduation only)
mapping(address => bool) public blacklisted;

// LP liquidity management roles
bytes32 public constant REMOVE_LIQUIDITY_ROLE = keccak256("REMOVE_LIQUIDITY_ROLE");

// Tax vault distribution
address public normalTaxVault;
address public antiSniperTaxVault;
```

### Time Controls
- **Flexible Start Times**: Configurable launch scheduling
- **Reset Capability**: `resetTime()` for pre-launch adjustments
- **Validation**: Multiple timestamp checks prevent manipulation

### Security Features
1. **Reentrancy Protection**: All state-changing functions protected
2. **Role-Based Access Control**: Multi-signature administrative functions with specialized roles
3. **Time Validation**: Prevents timestamp manipulation
4. **Slippage Protection**: `amountOutMin` parameters in trading
5. **Blacklist System**: Pre-graduation protection against malicious actors
6. **LP Security**: Secure liquidity management through veToken system
7. **Tax Vault Separation**: Anti-sniper and normal taxes distributed to separate vaults

## Integration Improvements

### AgentFactoryV6 Integration
- Direct AgentToken creation (no intermediate tokens)
- Seamless virtual persona system integration
- Token-bound account (TBA) support
- Automatic DAO creation and configuration

### Simplified Graduation Process
**LaunchpadV1:**
1. Bonding curve trading with temporary token
2. Graduation triggers new AgentToken creation
3. Users must call `unwrapToken()` to migrate
4. Complex balance tracking and migration

**LaunchpadV2:**
1. Direct AgentToken trading from start
2. Graduation simply opens Uniswap trading
3. No token migration needed
4. Seamless user experience

## VirtualId Management

### Overview
The VirtualId system manages the integration between LaunchpadV2 tokens and the Virtual Persona ecosystem. This system handles the lifecycle of virtual identities from token creation through graduation.

### VirtualId Lifecycle

**Pre-Launch and Launch Phases:**
- `preLaunchedEvent.virtualId` and `launchedEvent.virtualId` are emitted but **not currently used by Backend**
- But still make them start from 20_000_000_000 cuz it's BondingV2
- These events are reserved for future functionality and backward compatibility

**Graduation Phase:**
- Backend retrieves `onchainVirtualId` using `agentNftV2.totalSupply()` when `graduatedEvent` is received
- This `onchainVirtualId` is used to populate the `virtual.virtualId` field in the database
- Because we are still reusing the same agentNftV2 contract, so no need to change here, totalSupply won't duplicate the id
- Ensures accurate mapping between graduated tokens and their virtual persona

### Application ID Management

**NewApplicationEvent Integration:**
- Backend populates `virtual.personaProposalId` using `NewApplicationEvent.id`
- `AgentFactoryV6` starts application IDs from **60,000,000,000** to avoid conflicts
- This high starting number ensures separation from other ID systems

## Events and Monitoring

```solidity
// Lifecycle events
event PreLaunched(address indexed token, address indexed pair, uint tokenInfoLength, uint initialBoughtAgentTokensAmt);
event Launched(address indexed token, address indexed pair, uint initialBoughtAgentTokensAmt);

// Trading events  
event Buy(address indexed user, address indexed token, uint256 virtualAmount, uint256 tokenAmount, uint256 supply, uint256 virtualBalance, uint256 timestamp);
event Sell(address indexed user, address indexed token, uint256 tokenAmount, uint256 virtualAmount, uint256 supply, uint256 virtualBalance, uint256 timestamp);

// Administrative events
event TimeReset(address indexed token, uint256 oldStartTime, uint256 newStartTime);

// Security events
event BlacklistAdded(address indexed account);
event BlacklistRemoved(address indexed account);

// LP Management events
event LiquidityRemoved(
    address indexed veTokenHolder,
    uint256 veTokenAmount,
    uint256 amountA,
    uint256 amountB,
    address indexed recipient
);

// Tax distribution events
event TaxDistributed(address indexed vault, uint256 amount, bool isAntiSniper);
```

## Migration Guide

### Breaking Changes
1. **Single Token Model**: No more dual-token system or unwrapping
2. **Pre-Launch Phase**: New two-phase launch process
3. **Enhanced Anti-Sniper Tax**: Split tax distribution to multiple vaults
4. **Event Structure**: Updated event parameters with new security events
5. **State Management**: New token lifecycle tracking with virtualId reset
6. **Blacklist System**: Pre-graduation blacklist functionality
7. **LP Management**: New veToken-based liquidity removal system
8. **Role-Based Access**: New REMOVE_LIQUIDITY_ROLE for LP operations

### Migration Steps
1. Deploy LaunchpadV2 contracts with new interfaces
2. Update frontend for pre-launch phase handling
3. Remove unwrapping UI components
4. Implement enhanced anti-sniper tax display with vault separation
5. Add launch scheduling interface
6. Implement blacklist management UI (pre-graduation only)
7. Add LP liquidity management interface for graduated tokens
8. Update event listeners for new security and LP management events
9. Configure role-based access control for administrative functions

## Conclusion

LaunchpadV2 significantly simplifies the token launch process while adding sophisticated protection mechanisms. The single-token model eliminates user confusion and complex migration processes, while the enhanced security features and LP management capabilities create a more robust and secure launch environment.

Key benefits:
- **Simplified UX**: No token unwrapping or migration needed
- **Fair Launch**: Pre-launch scheduling and enhanced anti-sniper protection
- **Better Economics**: Optimized bonding curve and graduation threshold
- **Enhanced Security**: Comprehensive protection with blacklist and role-based access
- **Advanced LP Management**: Secure liquidity operations through veToken system
- **Tax Optimization**: Separated vault system for better fund management
- **Seamless Integration**: Direct AgentToken system integration with virtual persona
- **Flexible Administration**: Role-based access control for different operational needs

### Recent Enhancements (Latest Commits)
1. **Blacklist System**: Pre-graduation protection against malicious actors
2. **Tax Vault Separation**: Anti-sniper and normal taxes distributed to different vaults
3. **LP Liquidity Management**: Secure removal of LP tokens through AgentVeTokenV2
4. **Role-Based Access**: REMOVE_LIQUIDITY_ROLE for controlled LP operations
5. **Enhanced Testing**: Comprehensive test coverage for all new features