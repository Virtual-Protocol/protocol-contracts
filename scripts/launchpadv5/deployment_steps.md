### New EVM Chain (ETH Mainnet, BSC Mainnet, etc) ###
1. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_0.ts --network <network>`
2. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_1.ts --network <network>`
3. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_2.ts --network <network>`
4. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network <network>`
5. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_4.ts --network <network>`


### Existing Chain (only BASE Mainnet/Sepolia) ###
1. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network <network>`
2. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_4.ts --network <network>`, but expect to have no actions cuz all contract's roles are alr revoked previously




