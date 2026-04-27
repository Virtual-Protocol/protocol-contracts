### New EVM Chain (ETH Mainnet, BSC Mainnet, etc) ###
1. `npx hardhat run deployTBA.ts`
2. `./scripts/launchpadv5/run_local_deploy.sh --network xlayer_testnet --env .env.launchpadv5_dev_xlayer_testnet`
   1. `npx hardhat run deployMockVirtualToken.ts`
   2. `npx hardhat run deployUniswapV2TestentLiquidity.ts`
   3. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_0.ts --network <network>`
   4. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_1.ts --network <network>`
   5. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_2.ts --network <network>`
   6. `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_3.ts --network <network>`
   7.  `npx hardhat run scripts/launchpadv5/deployLaunchpadv5_4.ts --network <network>`
3. `npx hardhat run deployUniswapV3TestnetLiquidity.ts`
4. `npx hardhat run scripts/launchpadv5/deployMulticall3.ts --network <network>`