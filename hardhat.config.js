/** @type import('hardhat/config').HardhatUserConfig */
// Env loading (runs before `networks` — independent of `--network`):
// - If process.env.ENV_FILE is set (shell), only that file is loaded into process.env.
// - Else if root `.env` exists and defines ENV_FILE=..., only that target file is loaded
//   (`.env` is parsed for ENV_FILE only — other keys in `.env` are NOT applied).
// - Else load default `.env` as usual.
// `--network abstract_testnet` does NOT switch ENV_FILE; root `.env` may still point at e.g. bsc_testnet.
// Override per command: ENV_FILE=.env.launchpadv5_dev_abstract_testnet npx hardhat verify ... --network abstract_testnet
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
require("@okxweb3/hardhat-explorer-verify"); // OKLink `okverify` for X Layer (chainId 1952 / 196). See okxweb3explorer below.
require("hardhat-deploy");
require("@openzeppelin/hardhat-upgrades");
require("@fireblocks/hardhat-fireblocks");
require("hardhat-contract-sizer");

const { ApiBaseUrl } = require("@fireblocks/fireblocks-web3-provider");

module.exports = {
  // Multiple compilers: verify (okverify / etherscan) must include every solc version present in on-chain bytecode metadata.
  // Deploys may use 0.8.29 while day-to-day sources target 0.8.26 — list both with the same optimizer/viaIR so verification matches.
  // Hardhat picks the highest pragma-compatible compiler per file; use `overrides` below to pin 0.8.26 where bytecode must stay fixed.
  // Uni V2 npm artifacts: @uniswap/v2-core 0.5.16; @uniswap/v2-periphery 0.6.6.
  solidity: {
    compilers: [
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
          evmVersion: "istanbul",
        },
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
          evmVersion: "istanbul",
        },
      },
      {
        version: "0.8.26",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      // {
      //   version: "0.8.29",
      //   settings: {
      //     viaIR: true,
      //     optimizer: {
      //       enabled: true,
      //       runs: 200,
      //     },
      //   },
      // },
    ],
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
    // Etherscan API V2 (single key, multichain via chainid): https://docs.etherscan.io/v2-migration
    // Do not use legacy api.basescan.org/api — Hardhat-verify reports deprecated V1 / log fetch failures.
    //
    // X Layer (OKLink): uses `okverify` task from @okxweb3/hardhat-explorer-verify (Method 1).
    // Method 2 (customChains + verify:verify/verify:etherscan) does NOT work — OKLink's plugin
    // endpoint rejects standard Etherscan POST format ("Missing or unsupported chainid parameter").
    // The xlayer_* entries below are kept for reference but verification goes through okxweb3explorer below.
    // Set OKLINK_API_KEY (or ETHERSCAN_API_KEY) to your OKLink API key when verifying on xlayer_*.
    // https://www.oklink.com/docs/zh/#explorer-api-tools-contract-verification-verify-source-code-using-hardhat
    apiKey: process.env.OKLINK_API_KEY || process.env.ETHERSCAN_API_KEY,
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://basescan.org/",
        },
      },
      {
        network: "base_sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sepolia.basescan.org/",
        },
      },
      // Abstract L2 — https://docs.abs.xyz/build-on-abstract/smart-contracts/hardhat/verifying-contracts
      {
        network: "abstract_testnet",
        chainId: 11124,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sepolia.abscan.org/",
        },
      },
      {
        network: "abstract_mainnet",
        chainId: 2741,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://abscan.org/",
        },
      },
      // Monad — https://docs.monad.xyz/guides/verify-smart-contract/hardhat
      // MonadScan uses Etherscan v2 (api.etherscan.io; Hardhat passes chainid). Monad Vision uses Sourcify
      // (see scripts/launchpadv5/utils.ts verifyContract for monad_* networks).
      {
        network: "monad_testnet",
        chainId: 10143,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://testnet.monadscan.com/",
        },
      },
      {
        network: "monad_mainnet",
        chainId: 143,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://monadscan.com/",
        },
      },
      {
        network: "arbitrum_sepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sepolia.arbiscan.io/",
        },
      },
      // X Layer (OKLink) — kept for reference only. Verification uses okxweb3explorer (okverify) below.
      // Standard Etherscan format (verify:verify / verify:etherscan) fails with "Missing or unsupported chainid parameter".
      {
        network: "xlayer_testnet",
        chainId: 1952,
        urls: {
          apiURL:
            "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET",
          browserURL: "https://www.oklink.com/xlayer-test",
        },
      },
      {
        network: "xlayer_mainnet",
        chainId: 196,
        urls: {
          apiURL:
            "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER",
          browserURL: "https://www.oklink.com/xlayer",
        },
      },
    ],
  },
  // @okxweb3/hardhat-explorer-verify: primary verification for X Layer (okverify task, Method 1).
  // Uses OKLink-specific request format — the only format OKLink's plugin endpoint accepts.
  okxweb3explorer: {
    apiKey:
      process.env.OKLINK_API_KEY ||
      process.env.ETHERSCAN_API_KEY ||
      "OKLINK",
    customChains: [
      {
        network: "xlayer_testnet",
        chainId: 1952,
        urls: {
          apiURL:
            "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET",
          browserURL: "https://www.oklink.com/zh-hans/xlayer-test/explorer",
        },
      },
      {
        network: "xlayer_mainnet",
        chainId: 196,
        urls: {
          apiURL:
            "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER",
          browserURL: "https://www.oklink.com/zh-hans/xlayer/explorer",
        },
      },
    ],
  },
  // Do not set a global Monad Sourcify URL here: `verify` would send every chain’s chainId to that server.
  // Monad Sourcify is applied only in `scripts/launchpadv5/utils.ts` when network is monad_*.
  sourcify: {
    enabled: false,
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
    // Abstract L2 testnet (see https://docs.abs.xyz/connect-to-abstract)
    abstract_testnet: {
      url:
        process.env.ABSTRACT_TESTNET_RPC_URL ||
        process.env.RPC_URL ||
        "https://api.testnet.abs.xyz",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 11124,
    },
    // Abstract L2 mainnet (see https://docs.abs.xyz/connect-to-abstract)
    abstract_mainnet: {
      url:
        process.env.ABSTRACT_MAINNET_RPC_URL ||
        process.env.RPC_URL ||
        "https://api.mainnet.abs.xyz",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 2741,
    },
    monad_testnet: {
      url:
        process.env.MONAD_TESTNET_RPC_URL ||
        process.env.RPC_URL ||
        "https://testnet-rpc.monad.xyz",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 10143,
    },
    monad_mainnet: {
      url:
        process.env.MONAD_MAINNET_RPC_URL ||
        process.env.RPC_URL ||
        "https://mainnet.monad.xyz",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 143,
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
    // Do not fall back to RPC_URL — it often points at another chain (e.g. mainnet) in shared .env files.
    arbitrum_sepolia: {
      url:
        process.env.ARBITRUM_SEPOLIA_RPC_URL ||
        "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 421614,
    },
    // X Layer (OKX)
    // Do not fall back to RPC_URL to avoid accidental cross-chain deploys.
    xlayer_testnet: {
      url:
        process.env.XLAYER_TESTNET_RPC_URL ||
        "https://xlayertestrpc.okx.com/terigon",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 1952,
    },
    xlayer_mainnet: {
      url:
        process.env.XLAYER_RPC_URL ||
        "https://xlayerrpc.okx.com",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 196,
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
        11124: {
          hardforkHistory: {
            cancun: 0,
          },
        },
        2741: {
          hardforkHistory: {
            cancun: 0,
          },
        },
        10143: {
          hardforkHistory: {
            cancun: 0,
          },
        },
        421614: {
          hardforkHistory: {
            cancun: 0,
          },
        },
        1952: {
          hardforkHistory: {
            cancun: 0,
          },
        },
        196: {
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