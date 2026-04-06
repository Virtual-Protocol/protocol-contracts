/** @type import('hardhat/config').HardhatUserConfig */
// Env loading:
// - If process.env.ENV_FILE is set (shell), only that file is loaded into process.env.
// - Else if root `.env` exists and defines ENV_FILE=..., only that target file is loaded
//   (`.env` is parsed for ENV_FILE only — other keys in `.env` are NOT applied).
// - Else load default `.env` as usual.
// Usage: put `ENV_FILE=.env.launchpadv5_local` in `.env`, or `ENV_FILE=.env.launchpadv5_local npx hardhat ...`
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const projectRoot = __dirname;
const rootDotEnv = path.join(projectRoot, ".env");

function resolveEnvPath(p) {
  const s = (p || "").trim();
  if (!s) return null;
  return path.isAbsolute(s) ? s : path.join(projectRoot, s);
}

let target = process.env.ENV_FILE?.trim() || null;
if (!target && fs.existsSync(rootDotEnv)) {
  const parsed = dotenv.parse(fs.readFileSync(rootDotEnv, "utf8"));
  target = (parsed.ENV_FILE || "").trim() || null;
}

if (target) {
  const resolved = resolveEnvPath(target);
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(
      `ENV_FILE "${target}" resolved to missing path: ${resolved || "(empty)"}`
    );
  }
  dotenv.config({ path: resolved });
  console.log(`Loaded env file: ${resolved}`);
} else if (fs.existsSync(rootDotEnv)) {
  dotenv.config({ path: rootDotEnv });
  console.log(`Loaded env file: ${rootDotEnv}`);
} else {
  dotenv.config(); // cwd `.env`, same as dotenv default
  console.log("Loaded env via dotenv default (cwd .env if present)");
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
    "contracts/launchpadv2/BondingV5.sol": {
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
    bsc_mainnet: {
      url:
        process.env.BSC_RPC_URL ||
        process.env.RPC_URL ||
        "https://bsc.drpc.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 56,
    },
    bsc_testnet: {
      url:
        process.env.BSC_TESTNET_RPC_URL ||
        process.env.RPC_URL ||
        "https://bsc-testnet.drpc.org",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 97,
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
      // Forked `hardhat node`: use PRIVATE_KEY so deployer matches the address that holds
      // tokens on the forked chain (default Hardhat account #0 is usually empty on real forks).
      ...(process.env.PRIVATE_KEY
        ? { accounts: [process.env.PRIVATE_KEY] }
        : {}),
      // For forked node: npx hardhat node --fork <rpc_url> [--fork-block-number <n>]
    },
    // Fork RPC:
    // - `npx hardhat node --fork <url>`: Hardhat uses that URL. Nothing below overrides it.
    // - `npx hardhat test --network hardhat` with FORK_ENABLED=true: uses `forking.url` here
    //   (no separate node; no --fork on the CLI).
    hardhat: {
      // // Test-only: BondingV5 implementation currently exceeds EIP-170 size limit.
      // // Keep production networks constrained; only relax in local hardhat runtime.
      // allowUnlimitedContractSize: true,
      forking: {
        // Prefer FORK_RPC_URL when set. `run_local_deploy.sh --network local` requires FORK_RPC_URL in the env file.
        url:
          process.env.FORK_RPC_URL ||
          process.env.BASE_SEPOLIA_RPC_URL ||
          "https://base-sepolia.drpc.org",
        enabled: process.env.FORK_ENABLED === "true",
        // Omit blockNumber → Hardhat uses latest block from the fork RPC.
        // Set FORK_BLOCK_NUMBER only when you need a pinned height (reproducible state).
        ...(process.env.FORK_BLOCK_NUMBER
          ? { blockNumber: parseInt(process.env.FORK_BLOCK_NUMBER, 10) }
          : {}),
      },
      // Don't restrict accounts for hardhat network - use default 20 test accounts
      // This ensures tests have enough signers available
      // `chains` is the local EVM hardfork schedule, not “which RPC”. Hardhat reads chainId
      // from the fork, but execution still needs a known activation history for some networks;
      // add an entry here only if you hit that error (see Hardhat “chains” docs).
      chains: {
        84532: {
          hardforkHistory: {
            cancun: 0,
          },
        },
        97: {
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
