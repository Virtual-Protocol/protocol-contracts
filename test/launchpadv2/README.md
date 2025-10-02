# NewLaunchpad Test Suite

This directory contains comprehensive tests for the newLaunchpad system, including BondingV2, FFactoryV2, FRouterV2, and AgentFactoryV6 contracts.

## Test Structure

### Files

- **`const.js`** - Constants and error messages used across all tests
- **`setup.js`** - Test setup and contract deployment utilities
- **`bondingV2.js`** - Tests for the BondingV2 contract
- **`factoryV2.js`** - Tests for the FFactoryV2 contract
- **`routerV2.js`** - Tests for the FRouterV2 contract
- **`agentFactoryV6.js`** - Tests for the AgentFactoryV6 contract
- **`integration.js`** - End-to-end integration tests

### Test Categories

#### 1. Unit Tests
- **Deployment tests** - Verify contracts deploy with correct parameters
- **Access control tests** - Test role-based permissions
- **Functionality tests** - Test individual contract functions
- **Error handling tests** - Test error conditions and edge cases

#### 2. Integration Tests
- **Complete token launch flow** - Test the full process from token creation to graduation
- **Multiple token launches** - Test handling of multiple concurrent tokens
- **Trading operations** - Test buy/sell operations before graduation
- **Gas optimization** - Measure gas costs for key operations

## Contract Deployment Order

The setup follows this specific deployment order:

1. **MockERC20 (Virtual Token)** - Base currency for the system
2. **FFactoryV2** - Factory for creating trading pairs
3. **FRouterV2** - Router for handling trades and liquidity
4. **AgentNftV2** - NFT contract for agent representation
5. **AgentFactoryV6** - Factory for creating agent tokens and applications
6. **BondingV2** - Main bonding curve contract

## Role Configuration

After deployment, the following roles are configured:

- **BondingV2** gets:
  - `EXECUTOR_ROLE` in FRouterV2
  - `BONDING_ROLE` in AgentFactoryV6
  - `CREATOR_ROLE` in FFactoryV2

- **AgentFactoryV6** gets:
  - `MINTER_ROLE` in AgentNftV2

## Key Test Scenarios

### 1. Token Creation and Launch
```javascript
// Create a new token with bonding curve
await bondingV2.preLaunch(
    "Token Name",
    "TICKER",
    [0, 1, 2], // cores
    "Description",
    "https://example.com/image.png",
    ["https://twitter.com/test", "https://t.me/test", "https://youtube.com/test", "https://example.com"],
    ethers.parseEther("1000") // purchase amount
);

// Wait for start time and launch
await time.increase(START_TIME_DELAY + 1);
await bondingV2.launch(tokenAddress);
```

### 2. Token Trading
```javascript
// Buy tokens
await bondingV2.buy(
    ethers.parseEther("100"), // amount
    tokenAddress,
    0, // minAmountOut
    deadline
);

// Sell tokens
await bondingV2.sell(
    sellAmount,
    tokenAddress,
    0, // minAmountOut
    deadline
);
```

### 3. Token Graduation
When the bonding curve reaches the graduation threshold, the token automatically:
- Creates an AgentToken
- Creates a DAO
- Mints an NFT
- Creates a TBA (Token Bound Account)
- Creates a veToken
- Stakes initial liquidity

## Running Tests

### Run All Tests
```bash
npx hardhat test test/newLaunchpad/
```

### Run Specific Test Files
```bash
# Unit tests
npx hardhat test test/newLaunchpad/bondingV2.js
npx hardhat test test/newLaunchpad/factoryV2.js
npx hardhat test test/newLaunchpad/routerV2.js
npx hardhat test test/newLaunchpad/agentFactoryV6.js

# Integration tests
npx hardhat test test/newLaunchpad/integration.js
```

### Run with Gas Reporting
```bash
npx hardhat test test/newLaunchpad/ --gas-report
```

### Run with Coverage
```bash
npx hardhat coverage --testfiles "test/newLaunchpad/**/*.js"
```

## Test Configuration

### Environment Variables
The tests use the following environment variables (with defaults):

- `START_TIME_DELAY`: 86400 (24 hours)
- `DAO_VOTING_PERIOD`: 259200 (3 days)
- `DAO_THRESHOLD`: 0
- `APPLICATION_THRESHOLD`: 100 VIRTUAL tokens
- `TBA_SALT`: Predefined salt for TBA creation
- `TBA_IMPLEMENTATION`: TBA implementation address

### Test Accounts
The setup creates 5 test accounts:
- `owner` - Contract owner with admin privileges
- `admin` - Secondary admin account
- `beOpsWallet` - Backend operations wallet
- `user1` - Regular user account
- `user2` - Regular user account

Each account is minted 100,000 VIRTUAL tokens for testing.

## Expected Test Results

### Unit Tests
- All deployment tests should pass
- Access control tests should verify proper role management
- Functionality tests should cover all public functions
- Error handling tests should verify proper error messages

### Integration Tests
- Complete token launch flow should create all required components
- Multiple token launches should work independently
- Trading operations should execute successfully
- Gas costs should be within reasonable limits

## Troubleshooting

### Common Issues

1. **Insufficient Balance**: Ensure test accounts have enough VIRTUAL tokens
2. **Role Permissions**: Verify all required roles are granted during setup
3. **Time Constraints**: Some tests require time delays (use `time.increase()`)
4. **Gas Limits**: Large operations may require gas limit adjustments

### Debug Tips

1. Use `console.log()` statements in tests for debugging
2. Check contract addresses in setup output
3. Verify role assignments in test setup
4. Monitor gas usage for optimization opportunities

## Contributing

When adding new tests:

1. Follow the existing test structure
2. Use constants from `const.js`
3. Add proper error handling
4. Include both positive and negative test cases
5. Update this README if adding new test categories
