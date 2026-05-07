/**
 * Batch-verify V5 Abstract / launchpad-related addresses loaded from ENV_FILE.
 * Covers the same keys as `.env.launchpadv5_dev_abstract_testnet` (VIRTUAL, UniV2 router,
 * mocks, proxies, implementations, Multicall3). Deduplicates equal addresses
 * (e.g. VIRTUAL = AGENT_TAX_TAX_TOKEN, AgentTaxV2 = FFactoryV3_TAX_VAULT).
 *
 * Usage (from protocol-contracts):
 *   ENV_FILE=.env.launchpadv5_dev_abstract_testnet npx hardhat run scripts/launchpadv5/verifyLaunchpadv5FromEnv.ts --network abstract_testnet
 *   ENV_FILE=.env.launchpadv5_dev_monad_testnet npx hardhat run scripts/launchpadv5/verifyLaunchpadv5FromEnv.ts --network monad_testnet
 *   ENV_FILE=.env.launchpadv5_dev_xlayer_testnet npx hardhat run scripts/launchpadv5/verifyLaunchpadv5FromEnv.ts --network xlayer_testnet
 *   ENV_FILE=.env.launchpadv5_prod_xlayer npx hardhat run scripts/launchpadv5/verifyLaunchpadv5FromEnv.ts --network xlayer_mainnet
 *
 * X Layer (OKLink): Method 1 — uses `okverify` task from @okxweb3/hardhat-explorer-verify plugin.
 * Method 2 (etherscan.customChains + verify:verify/verify:etherscan) does NOT work — OKLink's endpoint
 * rejects standard Etherscan POST format ("Missing or unsupported chainid parameter").
 * API key: set `OKLINK_API_KEY` or `ETHERSCAN_API_KEY` to your OKLink API key.
 * https://www.oklink.com/docs/zh/#explorer-api-tools-contract-verification-verify-source-code-using-hardhat
 *
 * Compiler / env gotchas:
 * - hardhat.config.js lists 0.5.16 / 0.6.6 (Uni V2 npm artifacts: v2-core vs v2-periphery) plus 0.8.26 / 0.8.29.
 *   Rare bytecode still needs matching optimizer/runs — adjust `solidity.compilers` / `overrides` or verify manually on explorer.
 * - OKX verify plugin fetches solc list.json — `patches/@okxweb3+hardhat-explorer-verify+*.patch` prefers binaries.soliditylang.org,
 *   then solc-bin.ethereum.org (pure ENOTFOUND on the old host is common). Run `yarn` / `npm install` so patch-package applies.
 * - OKLink HTTP 429: patch retries POST/GET with backoff (see OKVERIFY_HTTP429_* env); or wait and re-run one address.
 * - OZ proxies (env rows marked “proxy”): on X Layer we call okverify with `proxy: true` (same as CLI `--proxy`).
 *   Implementation `contract` is optional — okverify matches implementation bytecode automatically when unique.
 *   If you see “More than one contract was found…”, set `VERIFY_CONTRACT_<ENV_KEY>=contracts/.../File.sol:Name`
 *   (e.g. VERIFY_CONTRACT_BONDING_V5_ADDRESS=contracts/launchpadv2/BondingV5.sol:BondingV5).
 * - Mock ERC20 verification needs DEPLOYER or MINT_TO / MOCK_USDC_MINT_TO set to the mint recipient used at deploy.
 *
 * Constructor hints (if your deploy differed from defaults, set these in env):
 *   Mock VIRTUAL (deployMockVirtualToken.ts): MOCK_VIRTUAL_NAME, MOCK_VIRTUAL_SYMBOL,
 *     MOCK_VIRTUAL_DECIMALS, MOCK_VIRTUAL_INITIAL_SUPPLY or INITIAL_SUPPLY, MINT_TO or DEPLOYER
 *   Mock mUSDC (deployUniswapV2TestnetLiquidity.ts): MOCK_USDC_NAME, MOCK_USDC_SYMBOL,
 *     MOCK_USDC_DECIMALS, MOCK_USDC_INITIAL_SUPPLY_HUMAN (default 1000000), MOCK_USDC_MINT_TO or DEPLOYER
 *   TBA (deployTBA.ts): ENTRY_POINT (default ERC-4337 v0.6 address), MULTICALL_FORWARDER (default zero),
 *     ACCOUNT_GUARDIAN (default zero), TBA_REGISTRY (registry address used when deploying TBA_IMPLEMENTATION)
 *
 * Skip tokens/router if not deployed from our scripts (e.g. bridged VIRTUAL):
 *   VERIFY_SKIP_VIRTUAL_TOKEN=true | VERIFY_SKIP_ASSET_TOKEN=true | VERIFY_SKIP_UNISWAP_ROUTER=true
 */
import { parseUnits } from "ethers";
import { verifyContract } from "./utils";

const hre = require("hardhat");
const { ethers } = hre;

const ROUTER_MIN_ABI = [
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)",
] as const;

/** UniswapV2Router02 from npm artifact (same bytecode as deployUniswapV2TestnetLiquidity). */
const UNISWAP_V2_ROUTER02_FQN =
  "@uniswap/v2-periphery/contracts/UniswapV2Router02.sol:UniswapV2Router02";

/**
 * OpenZeppelin transparent / UUPS proxy row: pass `proxy: true` into okverify (X Layer).
 * Optional implementation FQN only if bytecode matches multiple contracts:
 *   VERIFY_CONTRACT_<ENV_KEY>=contracts/path/File.sol:ContractName
 */
function proxyVerifyOpts(envVarKey: string): { proxy: true; contract?: string } {
  const contract = process.env[`VERIFY_CONTRACT_${envVarKey}`]?.trim();
  return contract ? { proxy: true, contract } : { proxy: true };
}

function envAddr(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v && ethers.isAddress(v) ? v : undefined;
}

(async () => {
  try {
    const net = await ethers.provider.getNetwork();
    console.log("\n" + "=".repeat(72));
    console.log("  verifyLaunchpadv5FromEnv");
    console.log("=".repeat(72));
    console.log("Network:", hre.network.name, "chainId:", net.chainId.toString());
    if (
      hre.network.name === "xlayer_testnet" ||
      hre.network.name === "xlayer_mainnet"
    ) {
      console.log(
        "X Layer: okverify via @okxweb3/hardhat-explorer-verify (OKLink Method 1) — see hardhat.config.js okxweb3explorer."
      );
    }

    const seen = new Set<string>();

    const runOnce = async (
      label: string,
      address: string | undefined,
      fn: (addr: string) => Promise<void>
    ) => {
      if (!address) {
        console.log(`\n--- Skip (${label}): no address in env ---`);
        return;
      }
      const k = address.toLowerCase();
      if (seen.has(k)) {
        console.log(`\n--- Skip (${label}): duplicate address ${address} ---`);
        return;
      }
      seen.add(k);
      const code = await ethers.provider.getCode(address);
      if (code === "0x") {
        console.log(`\n--- Skip (${label}): no bytecode at ${address} ---`);
        return;
      }
      await fn(address);
    };

    // 1) VIRTUAL / tax token (MockERC20Decimals from deployMockVirtualToken defaults)
    if (process.env.VERIFY_SKIP_VIRTUAL_TOKEN === "true") {
      console.log("\n--- Skip VIRTUAL_TOKEN: VERIFY_SKIP_VIRTUAL_TOKEN=true ---");
    } else {
      await runOnce("VIRTUAL_TOKEN (MockERC20Decimals)", envAddr("VIRTUAL_TOKEN_ADDRESS"), async (addr) => {
        const name = (process.env.MOCK_VIRTUAL_NAME || "Mock VIRTUAL").trim();
        const symbol = (process.env.MOCK_VIRTUAL_SYMBOL || "mVIRTUAL").trim();
        const decimals = Number((process.env.MOCK_VIRTUAL_DECIMALS || "18").trim());
        const supplyHuman = (
          process.env.MOCK_VIRTUAL_INITIAL_SUPPLY ||
          process.env.INITIAL_SUPPLY ||
          "1000000000"
        ).trim();
        const recipient = (process.env.MINT_TO || process.env.DEPLOYER || "").trim();
        if (!recipient || !ethers.isAddress(recipient)) {
          throw new Error(
            "Set DEPLOYER or MINT_TO in env for VIRTUAL_TOKEN verification (constructor recipient)"
          );
        }
        const initialBalance = parseUnits(supplyHuman, decimals);
        await verifyContract(addr, [name, symbol, decimals, recipient, initialBalance]);
      });
    }

    // 2) Stable / asset token for AgentTax (default: mUSDC from deployUniswapV2TestnetLiquidity)
    if (process.env.VERIFY_SKIP_ASSET_TOKEN === "true") {
      console.log("\n--- Skip AGENT_TAX_ASSET_TOKEN: VERIFY_SKIP_ASSET_TOKEN=true ---");
    } else {
      await runOnce("AGENT_TAX_ASSET_TOKEN (MockERC20Decimals)", envAddr("AGENT_TAX_ASSET_TOKEN"), async (addr) => {
        const name = (process.env.MOCK_USDC_NAME || "Mock USDC").trim();
        const symbol = (process.env.MOCK_USDC_SYMBOL || "mUSDC").trim();
        const decimals = Number((process.env.MOCK_USDC_DECIMALS || "6").trim());
        const supplyHuman = (process.env.MOCK_USDC_INITIAL_SUPPLY_HUMAN || "1000000").trim();
        const recipient = (process.env.MOCK_USDC_MINT_TO || process.env.DEPLOYER || "").trim();
        if (!recipient || !ethers.isAddress(recipient)) {
          throw new Error(
            "Set DEPLOYER or MOCK_USDC_MINT_TO for AGENT_TAX_ASSET_TOKEN verification"
          );
        }
        const initialBalance = parseUnits(supplyHuman, decimals);
        await verifyContract(addr, [name, symbol, decimals, recipient, initialBalance]);
      });
    }

    // 3) UniswapV2Router02 — constructor args from on-chain factory() / WETH()
    if (process.env.VERIFY_SKIP_UNISWAP_ROUTER === "true") {
      console.log("\n--- Skip UNISWAP_V2_ROUTER: VERIFY_SKIP_UNISWAP_ROUTER=true ---");
    } else {
      await runOnce("UNISWAP_V2_ROUTER (UniswapV2Router02)", envAddr("UNISWAP_V2_ROUTER"), async (addr) => {
        const router = new ethers.Contract(addr, ROUTER_MIN_ABI, ethers.provider);
        const factory = await router.factory();
        const weth = await router.WETH();
        await verifyContract(addr, [factory, weth], { contract: UNISWAP_V2_ROUTER02_FQN });
      });
    }

    // 4–14) OZ proxies & plain implementations (proxies: okverify `proxy` — impl + proxy + ProxyAdmin on OKLink)
    await runOnce("AGENT_NFT_V2 (proxy)", envAddr("AGENT_NFT_V2_ADDRESS"), async (addr) => {
      await verifyContract(addr, [], proxyVerifyOpts("AGENT_NFT_V2_ADDRESS"));
    });

    await runOnce("AGENT_NFT_V2_IMPLEMENTATION (AgentNftV2)", envAddr("AGENT_NFT_V2_IMPLEMENTATION"), async (addr) => {
      await verifyContract(addr, []);
    });

    await runOnce("AGENT_VE_TOKEN_V2_IMPLEMENTATION", envAddr("AGENT_VE_TOKEN_V2_IMPLEMENTATION"), async (addr) => {
      await verifyContract(addr, []);
    });

    await runOnce("AGENT_DAO_IMPLEMENTATION", envAddr("AGENT_DAO_IMPLEMENTATION"), async (addr) => {
      await verifyContract(addr, []);
    });

    await runOnce("AGENT_TAX_V2 (proxy)", envAddr("AGENT_TAX_V2_CONTRACT_ADDRESS"), async (addr) => {
      await verifyContract(addr, [], proxyVerifyOpts("AGENT_TAX_V2_CONTRACT_ADDRESS"));
    });

    await runOnce("FFactoryV3 (proxy)", envAddr("FFactoryV3_ADDRESS"), async (addr) => {
      await verifyContract(addr, [], proxyVerifyOpts("FFactoryV3_ADDRESS"));
    });

    await runOnce("FRouterV3 (proxy)", envAddr("FRouterV3_ADDRESS"), async (addr) => {
      await verifyContract(addr, [], proxyVerifyOpts("FRouterV3_ADDRESS"));
    });

    await runOnce("AGENT_TOKEN_V4_IMPLEMENTATION", envAddr("AGENT_TOKEN_V4_IMPLEMENTATION"), async (addr) => {
      await verifyContract(addr, []);
    });

    await runOnce("AGENT_FACTORY_V7 (proxy)", envAddr("AGENT_FACTORY_V7_ADDRESS"), async (addr) => {
      await verifyContract(addr, [], proxyVerifyOpts("AGENT_FACTORY_V7_ADDRESS"));
    });

    await runOnce("BONDING_CONFIG (proxy)", envAddr("BONDING_CONFIG_ADDRESS"), async (addr) => {
      await verifyContract(addr, [], proxyVerifyOpts("BONDING_CONFIG_ADDRESS"));
    });

    await runOnce("BONDING_V5 (proxy)", envAddr("BONDING_V5_ADDRESS"), async (addr) => {
      await verifyContract(addr, [], proxyVerifyOpts("BONDING_V5_ADDRESS"));
    });

    await runOnce("TAX_ACCOUNTING_ADAPTER (proxy)", envAddr("TAX_ACCOUNTING_ADAPTER_ADDRESS"), async (addr) => {
      await verifyContract(addr, [], proxyVerifyOpts("TAX_ACCOUNTING_ADAPTER_ADDRESS"));
    });

    // 15) TBA Registry — ERC6551Registry (no constructor args)
    await runOnce("TBA_REGISTRY (ERC6551Registry)", envAddr("TBA_REGISTRY"), async (addr) => {
      await verifyContract(addr, [], {
        contract: "contracts/tba/ERC6551Registry.sol:ERC6551Registry",
      });
    });

    // 16) TBA Implementation — AccountV3Upgradable (4 constructor args matching deployTBA.ts defaults)
    await runOnce("TBA_IMPLEMENTATION (AccountV3Upgradable)", envAddr("TBA_IMPLEMENTATION"), async (addr) => {
      const DEFAULT_ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
      const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
      const entryPoint = (process.env.ENTRY_POINT ?? DEFAULT_ENTRY_POINT).trim();
      const multicallForwarder = (process.env.MULTICALL_FORWARDER ?? ZERO_ADDRESS).trim();
      const registryAddr = (process.env.TBA_REGISTRY ?? "").trim();
      const accountGuardian = (process.env.ACCOUNT_GUARDIAN ?? ZERO_ADDRESS).trim();
      if (!registryAddr || !ethers.isAddress(registryAddr)) {
        throw new Error("Set TBA_REGISTRY in env for TBA_IMPLEMENTATION verification (constructor arg)");
      }
      await verifyContract(
        addr,
        [entryPoint, multicallForwarder, registryAddr, accountGuardian],
        { contract: "contracts/tba/AccountV3Upgradable.sol:AccountV3Upgradable" }
      );
    });

    await runOnce("MULTICALL3", envAddr("MULTICALL3_ADDRESS"), async (addr) => {
      await verifyContract(addr, []);
    });

    console.log("\n" + "=".repeat(72));
    console.log("  Done (check messages above for any failures)");
    console.log("=".repeat(72) + "\n");
  } catch (e) {
    console.error("verifyLaunchpadv5FromEnv failed:", e);
    process.exit(1);
  }
})();