# NewLaunchpad Deployment Guide

## 📋 Overview

This guide explains how to deploy the NewLaunchpad contracts to any EVM network. The deployment includes:

- **FFactoryV2** - Factory contract with anti-sniper tax support
- **FRouterV2** - Router contract for handling trades
- **AgentToken** - Agent token implementation
- **AgentVeToken** - Voting escrow token implementation  
- **AgentDAO** - DAO implementation
- **ERC6551Registry** - Token-bound account registry
- **AgentFactoryV6** - Agent factory for creating new agents
- **BondingV2** - Bonding curve contract

## 🧪 Local Testing

Before deploying to mainnet/testnet, always test locally:

```bash
# Run local deployment test
npx hardhat run scripts/newLaunchpad/testLocalDeployment.ts --network hardhat
```

This will:
- ✅ Deploy all prerequisite contracts
- ✅ Test the full deployment flow
- ✅ Verify all role assignments
- ✅ Validate contract interactions
- ✅ Check for syntax/compilation errors

## 🚀 Production Deployment

### 1. Set Environment Variables

Create a `.env` file with the following variables:

```bash
# === Basic Configuration ===
DEPLOYER=0x...                    # Deployer wallet address
NEW_LAUNCHPAD_BE_OPS_WALLET=0x... # Backend operations wallet
CONTRACT_CONTROLLER=0x...         # Contract controller address
ADMIN=0x...                       # Admin wallet address

# === Existing Contract Addresses ===
VIRTUAL_TOKEN=0x...               # Virtual token contract address
AGENT_NFT_V2=0x...               # AgentNftV2 contract address  
UNISWAP_V2_FACTORY=0x...         # UniswapV2Factory address
UNISWAP_V2_ROUTER=0x...          # UniswapV2Router02 address

# === Fee Configuration ===
NEW_LAUNCHPAD_FEE_ADDRESS=0x...   # Fee recipient address
NEW_LAUNCHPAD_FEE_AMOUNT=100000000000000000000  # 100 tokens

# === Tax Configuration ===
BUY_TAX=1                         # 1% buy tax
SELL_TAX=1                        # 1% sell tax
ANTI_SNIPER_BUY_TAX_START_VALUE=99 # 99% anti-sniper tax

# === Token Configuration ===
INITIAL_SUPPLY=1000000000         # 1B tokens
ASSET_RATE=5000                   # Asset rate
MAX_TX=100                        # Max transaction percentage
GRAD_THRESHOLD=29439252000000000000000000 # Graduation threshold

# === Time Configuration ===
START_TIME_DELAY=86400            # 24 hours delay

# === TBA Configuration ===
TBA_SALT=0xa7647ac9429fdce477ebd9a95510385b756c757c26149e740abbab0ad1be2f16
TBA_IMPLEMENTATION=0x55266d75D1a14E4572138116aF39863Ed6596E7F

# === DAO Configuration ===
DAO_VOTING_PERIOD=259200          # 3 days
DAO_THRESHOLD=0                   # No threshold

# === Team Configuration ===
TEAM_TOKEN_RESERVED_SUPPLY=550000000 # 550M tokens

# === Application Configuration ===
APPLICATION_THRESHOLD=100000000000000000000 # 100 VIRTUAL tokens
```

### 2. Deploy to Network

```bash
# Deploy to Sepolia testnet
npx hardhat run scripts/newLaunchpad/deployNewLaunchPad.ts --network sepolia

# Deploy to mainnet (when ready)
npx hardhat run scripts/newLaunchpad/deployNewLaunchPad.ts --network mainnet
```

## 🔧 Key Features

### Anti-Sniper Tax System
- **Start Value**: 99% tax immediately after pair creation
- **End Value**: 1% normal tax after 30 minutes
- **Linear Decay**: Tax decreases linearly over 30 minutes
- **Creator Exemption**: Initial purchases always use 1% tax

### Role-Based Access Control
- **ADMIN_ROLE**: Configuration management
- **EXECUTOR_ROLE**: Transaction execution
- **CREATOR_ROLE**: Pair creation
- **BONDING_ROLE**: Bonding curve operations
- **MINTER_ROLE**: NFT minting

### Security Features
- **Ownership Transfer**: Deployer roles are revoked after deployment
- **Multi-Sig Ready**: Supports multi-signature wallets
- **Upgradeable**: Uses OpenZeppelin's upgradeable proxy pattern

## 📊 Deployment Flow

1. **Prerequisites** - Deploy Virtual Token, AgentNftV2, Uniswap contracts
2. **Core Contracts** - Deploy FFactoryV2, FRouterV2
3. **Implementations** - Deploy AgentToken, AgentVeToken, AgentDAO, ERC6551Registry
4. **Factory** - Deploy and configure AgentFactoryV6
5. **Bonding** - Deploy and configure BondingV2
6. **Roles** - Assign all necessary roles
7. **Security** - Revoke deployer permissions

## ⚠️ Important Notes

- Always test locally first using `testLocalDeployment.ts`
- Verify all environment variables are set correctly
- Double-check contract addresses for existing dependencies
- Monitor gas usage during deployment
- Keep deployment transaction hashes for verification

## 🔍 Verification

After deployment, verify:
- ✅ All contracts deployed successfully
- ✅ Role assignments are correct
- ✅ Parameters are configured properly
- ✅ Anti-sniper tax is working
- ✅ Creator exemption is functional

## 📞 Support

For deployment issues or questions, refer to:
- Local test results for debugging
- Hardhat documentation for network configuration
- OpenZeppelin docs for upgradeable contracts
