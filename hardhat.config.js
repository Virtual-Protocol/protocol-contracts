/** @type import('hardhat/config').HardhatUserConfig */
// Load env file: defaults to .env, or specify via ENV_FILE
// Usage: ENV_FILE=.env.launchpadv5_local npx hardhat run ...
const envFile = process.env.ENV_FILE;
if (envFile) {
  require("dotenv").config({ path: envFile });
  console.log(`Loaded env file: ${envFile}`);
} else {
  require("dotenv").config(); // defaults to .env
}
require("@nomicfoundation/hardhat-toolbox");
require("hardhat-deploy");
require("@openzeppelin/hardhat-upgrades");
require("@fireblocks/hardhat-fireblocks");
require("hardhat-contract-sizer");

const { ApiBaseUrl } = require("@fireblocks/fireblocks-web3-provider");

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  overrides: {
    "contracts/genesis/FGenesis.sol": {
      version: "0.8.26",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        viaIR: false,
      },
    },
    "contracts/genesis/Genesis.sol": {
      version: "0.8.26",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        viaIR: false,
      },
    },
    "contracts/launchpadv2/BondingV2.sol": {
      version: "0.8.26",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        viaIR: false,
      },
    },
    "contracts/launchpadv2/BondingV4.sol": {
      version: "0.8.26",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        viaIR: false,
      },
    },
  },
  namedAccounts: {
    deployer: `privatekey://${process.env.PRIVATE_KEY}`,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "base_sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sepolia.basescan.org/",
        },
      },
    ],
  },
  networks: {
    eth_mainnet: {
      url: process.env.ETH_MAINNET_RPC_URL || "https://eth.drpc.org",
      accounts: [process.env.PRIVATE_KEY],
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org",
      accounts: [process.env.PRIVATE_KEY],
    },
    eth_sepolia: {
      url: process.env.ETH_SEPOLIA_RPC_URL || "https://sepolia.drpc.org",
      accounts: [process.env.PRIVATE_KEY],
    },
    base: {
      url:
        process.env.BASE_RPC_URL ||
        process.env.RPC_URL ||
        "https://mainnet.base.org",
      accounts: [process.env.PRIVATE_KEY],
    },
    base_fire: {
      url: "https://mainnet.base.org",
      accounts: [process.env.PRIVATE_KEY],
      fireblocks: {
        privateKey: process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH,
        apiKey: process.env.FIREBLOCKS_API_KEY,
        vaultAccountIds: process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS,
      },
    },
    base_sepolia: {
      url:
        process.env.BASE_SEPOLIA_RPC_URL ||
        process.env.RPC_URL ||
        "https://base-sepolia.drpc.org",
      accounts: [process.env.PRIVATE_KEY],
    },
    base_sepolia_fire: {
      url: "https://sepolia.base.org",
      accounts: [process.env.PRIVATE_KEY],
      fireblocks: {
        apiBaseUrl: ApiBaseUrl.Sandbox,
        privateKey: process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH,
        apiKey: process.env.FIREBLOCKS_API_KEY,
        vaultAccountIds: process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS,
      },
    },
    local: {
      url: "http://127.0.0.1:8545",
      // For forked node: npx hardhat node --fork <rpc_url> --fork-block-number <block>
    },
    // Local fork of base_sepolia for testing with real env
    hardhat: {
      forking: {
        url: process.env.BASE_SEPOLIA_RPC_URL || "https://base-sepolia.drpc.org",
        enabled: process.env.FORK_ENABLED === "true",
        blockNumber: process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : 
        39256635,
      },
      // Don't restrict accounts for hardhat network - use default 20 test accounts
      // This ensures tests have enough signers available
      chains: {
        84532: {  // base_sepolia chainId
          hardforkHistory: {
            cancun: 0,
          },
        },
      },
    },
    polygon: {
      url: "https://rpc-mainnet.maticvigil.com/",
      accounts: [process.env.PRIVATE_KEY],
    },
    mumbai: {
      url: "https://rpc.ankr.com/polygon_mumbai",
      accounts: [process.env.PRIVATE_KEY],
    },
    goerli: {
      url: "https://rpc.ankr.com/eth_goerli",
      accounts: [process.env.PRIVATE_KEY],
    },
  },
  mocha: {
    timeout: 100000000,
  },
};
