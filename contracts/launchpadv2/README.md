# LaunchpadV2 Technical Solution

## Overview

LaunchpadV2 is a comprehensive upgrade to the original launchpad system (fun folder), introducing pre-launch scheduling, anti-sniper protection, and simplified token mechanics. The key improvement is a **single-token model** that eliminates the complex dual-token system used in V1.

## Core Architecture

### Smart Contracts
- **BondingV2.sol** - Main bonding curve contract with pre-launch and launch phases
- **FFactoryV2.sol** - Factory for creating trading pairs with anti-sniper tax support  
- **FRouterV2.sol** - Router handling trades with dynamic tax calculation
- **FPairV2.sol** - Trading pair contract with time-based features

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

### 3. Anti-Sniper Protection

**Buy Operations Only:**
- 99% tax → 1% tax linear decay over 30 minutes
- Creator's initial purchase always uses 1% tax

**Sell Operations:**
- Always 1% tax (no anti-sniper needed)
- Rationale: Snipers selling doesn't harm other users; they already paid higher buy tax

```solidity
// Tax calculation formula
buyTaxRate = 99% - (timeElapsed × 98%) / 30 minutes
sellTaxRate = 1% (fixed)
```

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
    uint256 virtualId;      // Integration with virtual persona
}
```

### Time Controls
- **Flexible Start Times**: Configurable launch scheduling
- **Reset Capability**: `resetTime()` for pre-launch adjustments
- **Validation**: Multiple timestamp checks prevent manipulation

### Security Features
1. **Reentrancy Protection**: All state-changing functions protected
2. **Role-Based Access Control**: Multi-signature administrative functions
3. **Time Validation**: Prevents timestamp manipulation
4. **Slippage Protection**: `amountOutMin` parameters in trading

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
```

## Migration Guide

### Breaking Changes
1. **Single Token Model**: No more dual-token system or unwrapping
2. **Pre-Launch Phase**: New two-phase launch process
3. **Anti-Sniper Tax**: Only applies to buy operations
4. **Event Structure**: Updated event parameters
5. **State Management**: New token lifecycle tracking

### Migration Steps
1. Deploy LaunchpadV2 contracts
2. Update frontend for pre-launch phase handling
3. Remove unwrapping UI components
4. Implement anti-sniper tax display (buy only)
5. Add launch scheduling interface
6. Update event listeners for new structures

## Conclusion

LaunchpadV2 significantly simplifies the token launch process while adding sophisticated protection mechanisms. The single-token model eliminates user confusion and complex migration processes, while the pre-launch system and anti-sniper protection create a fairer, more organized launch environment.

Key benefits:
- **Simplified UX**: No token unwrapping or migration needed
- **Fair Launch**: Pre-launch scheduling and anti-sniper protection
- **Better Economics**: Optimized bonding curve and graduation threshold
- **Enhanced Security**: Comprehensive protection mechanisms
- **Seamless Integration**: Direct AgentToken system integration