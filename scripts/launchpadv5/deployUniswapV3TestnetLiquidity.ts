/**
 * Deploy minimal Uniswap V3 stack (Factory + WETH9 + SwapRouter + QuoterV2 + NFT descriptor + PositionManager),
 * create a VIRTUAL/stable pool, add liquidity, and run buy/sell smoke swaps.
 *
 * QuoterV2 vs factory/router:
 * - Same constructor immutables as SwapRouter: `(UniswapV3Factory, WETH9)`. It does not use the router.
 * - It quotes by staticcalling `pool.swap` and decoding the synthetic revert payload; pools must match this factory.
 *
 * Usage:
 *   # local hardhat network
 *   ENV_FILE=.env.launchpadv5_dev_bsc_testnet npx hardhat run ./scripts/launchpadv5/deployUniswapV3TestnetLiquidity.ts --network hardhat
 *
 *   # bsc testnet
 *   ENV_FILE=.env.launchpadv5_dev_bsc_testnet npx hardhat run ./scripts/launchpadv5/deployUniswapV3TestnetLiquidity.ts --network bsc_testnet
 *
 * Required env:
 *   VIRTUAL_TOKEN_ADDRESS
 *   AGENT_TAX_ASSET_TOKEN
 *
 * Optional env — reuse existing deployments (same pattern as deployLaunchpadv5_0: set address to skip deploy):
 *   UNISWAP_V3_FACTORY
 *   UNISWAP_V3_WETH9
 *   UNISWAP_V3_POSITION_DESCRIPTOR (MockPositionDescriptor)
 *   UNISWAP_V3_ROUTER
 *   UNISWAP_V3_QUOTER_V2
 *   UNISWAP_V3_POSITION_MANAGER
 *
 * Optional env:
 *   LIQUIDITY_AMOUNT               (default "10")
 *   SWAP_TEST_VIRTUAL_AMOUNT       (default "1")
 *   UNISWAP_V3_FEE                 (default "3000")
 *   TX_CONFIRM_TIMEOUT_MS          (default "240000")
 *   VERIFY_CONTRACTS=true          (verify after each newly deployed contract)
 *
 * Monad: fees scale with gas_limit (not gas_used). Script uses {@link launchpadHeavyTxGasLimit}.
 * Large deploys may take minutes to confirm — progress is logged before each step.
 */
import { Contract, parseUnits } from "ethers";
import { launchpadHeavyTxGasLimit } from "./utils";
import FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SwapRouterArtifact from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import QuoterV2Artifact from "@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json";
import PositionManagerArtifact from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import WethArtifact from "@uniswap/v2-periphery/build/WETH9.json";

const hre = require("hardhat");
const { ethers } = hre;

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
] as const;

const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address)",
  "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address)",
] as const;

const POOL_ABI = [
  "function initialize(uint160 sqrtPriceX96) external",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
] as const;

const Q96 = 2n ** 96n;

/** Capped via {@link launchpadHeavyTxGasLimit} (env: LAUNCHPAD_HEAVY_TX_GAS_LIMIT). */

/** Single env var name (shared names like `VIRTUAL_TOKEN_ADDRESS` stay as-is). */
function envStr(name: string): string {
  return (process.env[name] || "").trim();
}

function mustAddress(name: string, value?: string): string {
  const v = String(value || "").trim();
  if (!ethers.isAddress(v)) {
    throw new Error(`${name} is invalid: "${v}"`);
  }
  return v;
}

function deadlineSec(offset: number = 3600): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offset);
}

async function waitTx(txHash: string, timeoutMs: number) {
  const start = Date.now();
  while (true) {
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (receipt) return receipt;
    const elapsed = Date.now() - start;
    if (elapsed > timeoutMs) {
      throw new Error(`tx pending too long (${Math.floor(timeoutMs / 1000)}s): ${txHash}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function tryVerify(address: string, ctorArgs: any[]) {
  if (String(process.env.VERIFY_CONTRACTS || "").toLowerCase() !== "true") return;
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments: ctorArgs,
    });
    console.log("✅ Verified:", address);
  } catch (e: any) {
    console.log("⚠️ Verify skipped/failed:", address, e?.message || e);
  }
}

(async () => {
  try {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const timeoutMs = Number(process.env.TX_CONFIRM_TIMEOUT_MS || "240000");
    const fee = Number(envStr("UNISWAP_V3_FEE") || "3000");
    const liquidityHuman = process.env.LIQUIDITY_AMOUNT?.trim() || "10";
    const swapVirtualHuman = process.env.SWAP_TEST_VIRTUAL_AMOUNT?.trim() || "1";

    const MAX_SIGNER_GAS_LIMIT = launchpadHeavyTxGasLimit();

    console.log("\n=== Deploy Uniswap V3 + Liquidity + Buy/Sell ===");
    console.log("Network:", hre.network.name, "chainId:", chainId.toString());
    console.log("Deployer:", deployerAddress);
    console.log(
      "(If this line is the last for several minutes: RPC is slow, or a deploy tx is pending — check explorer / RPC.)"
    );

    const virtualRaw = envStr("VIRTUAL_TOKEN_ADDRESS");
    if (!virtualRaw) {
      throw new Error("VIRTUAL_TOKEN_ADDRESS not set in environment");
    }
    const stableRaw = envStr("AGENT_TAX_ASSET_TOKEN");
    if (!stableRaw) {
      throw new Error("AGENT_TAX_ASSET_TOKEN not set in environment");
    }
    const virtualAddr = mustAddress("VIRTUAL_TOKEN_ADDRESS", virtualRaw);
    const stableAddr = mustAddress("AGENT_TAX_ASSET_TOKEN", stableRaw);

    const virtual = new ethers.Contract(virtualAddr, ERC20_ABI, deployer);
    const stable = new ethers.Contract(stableAddr, ERC20_ABI, deployer);
    console.log("Reading token decimals (eth_call)...");
    const virtualDecimals = Number(await virtual.decimals());
    const stableDecimals = Number(await stable.decimals());
    console.log(
      `Token decimals: VIRTUAL=${virtualDecimals}, stable=${stableDecimals}`
    );
    const amountVirtual = parseUnits(liquidityHuman, virtualDecimals);
    const amountStable = parseUnits(liquidityHuman, stableDecimals);
    const amountSwapIn = parseUnits(swapVirtualHuman, virtualDecimals);

    // ============================================
    // Uniswap V3 stack (deployLaunchpadv5_0 style: env set → reuse, else deploy)
    // ============================================
    const Factory = new ethers.ContractFactory(FactoryArtifact.abi, FactoryArtifact.bytecode, deployer);
    let factoryAddr: string;
    const uniswapV3FactoryEnv = envStr("UNISWAP_V3_FACTORY");
    if (!uniswapV3FactoryEnv) {
      console.log("\n--- Deploying UniswapV3Factory ---");
      const factory = await Factory.deploy({ gasLimit: MAX_SIGNER_GAS_LIMIT });
      console.log("  tx:", factory.deploymentTransaction()?.hash ?? "(unknown)");
      await factory.waitForDeployment();
      factoryAddr = await factory.getAddress();
      console.log("  deployed:", factoryAddr);
      await tryVerify(factoryAddr, []);
    } else {
      console.log("\n--- Reusing UNISWAP_V3_FACTORY ---");
      factoryAddr = ethers.getAddress(uniswapV3FactoryEnv);
      console.log(factoryAddr);
    }

    const Weth = new ethers.ContractFactory(WethArtifact.abi, WethArtifact.bytecode, deployer);
    let wethAddr: string;
    const uniswapV3Weth9Env = envStr("UNISWAP_V3_WETH9");
    if (!uniswapV3Weth9Env) {
      console.log("\n--- Deploying WETH9 ---");
      const weth = await Weth.deploy({ gasLimit: MAX_SIGNER_GAS_LIMIT });
      console.log("  tx:", weth.deploymentTransaction()?.hash ?? "(unknown)");
      await weth.waitForDeployment();
      wethAddr = await weth.getAddress();
      console.log("  deployed:", wethAddr);
      await tryVerify(wethAddr, []);
    } else {
      console.log("\n--- Reusing UNISWAP_V3_WETH9 ---");
      wethAddr = ethers.getAddress(uniswapV3Weth9Env);
      console.log(wethAddr);
    }

    const Descriptor = await ethers.getContractFactory("MockPositionDescriptor");
    let descriptorAddr: string;
    const uniswapV3DescriptorEnv = envStr("UNISWAP_V3_POSITION_DESCRIPTOR");
    if (!uniswapV3DescriptorEnv) {
      console.log("\n--- Deploying MockPositionDescriptor ---");
      const descriptor = await Descriptor.deploy({ gasLimit: MAX_SIGNER_GAS_LIMIT });
      console.log("  tx:", descriptor.deploymentTransaction()?.hash ?? "(unknown)");
      await descriptor.waitForDeployment();
      descriptorAddr = await descriptor.getAddress();
      console.log("  deployed:", descriptorAddr);
      await tryVerify(descriptorAddr, []);
    } else {
      console.log("\n--- Reusing UNISWAP_V3_POSITION_DESCRIPTOR ---");
      descriptorAddr = ethers.getAddress(uniswapV3DescriptorEnv);
      console.log(descriptorAddr);
    }

    const Router = new ethers.ContractFactory(SwapRouterArtifact.abi, SwapRouterArtifact.bytecode, deployer);
    let routerAddr: string;
    const uniswapV3RouterEnv = envStr("UNISWAP_V3_ROUTER");
    if (!uniswapV3RouterEnv) {
      console.log("\n--- Deploying SwapRouter ---");
      const routerDeployed = await Router.deploy(factoryAddr, wethAddr, { gasLimit: MAX_SIGNER_GAS_LIMIT });
      console.log("  tx:", routerDeployed.deploymentTransaction()?.hash ?? "(unknown)");
      await routerDeployed.waitForDeployment();
      routerAddr = await routerDeployed.getAddress();
      console.log("  deployed:", routerAddr);
      await tryVerify(routerAddr, [factoryAddr, wethAddr]);
    } else {
      console.log("\n--- Reusing UNISWAP_V3_ROUTER ---");
      routerAddr = ethers.getAddress(uniswapV3RouterEnv);
      console.log(routerAddr);
    }

    const QuoterV2 = new ethers.ContractFactory(QuoterV2Artifact.abi, QuoterV2Artifact.bytecode, deployer);
    let quoterV2Addr: string;
    const uniswapV3QuoterEnv = envStr("UNISWAP_V3_QUOTER_V2");
    if (!uniswapV3QuoterEnv) {
      console.log("\n--- Deploying QuoterV2 ---");
      const quoterV2 = await QuoterV2.deploy(factoryAddr, wethAddr, { gasLimit: MAX_SIGNER_GAS_LIMIT });
      console.log("  tx:", quoterV2.deploymentTransaction()?.hash ?? "(unknown)");
      await quoterV2.waitForDeployment();
      quoterV2Addr = await quoterV2.getAddress();
      console.log("  deployed:", quoterV2Addr);
      await tryVerify(quoterV2Addr, [factoryAddr, wethAddr]);
    } else {
      console.log("\n--- Reusing UNISWAP_V3_QUOTER_V2 ---");
      quoterV2Addr = ethers.getAddress(uniswapV3QuoterEnv);
      console.log(quoterV2Addr);
    }

    const PositionManager = new ethers.ContractFactory(
      PositionManagerArtifact.abi,
      PositionManagerArtifact.bytecode,
      deployer
    );
    let positionManagerAddr: string;
    let positionManager: Contract;
    const uniswapV3PmEnv = envStr("UNISWAP_V3_POSITION_MANAGER");
    if (!uniswapV3PmEnv) {
      console.log("\n--- Deploying NonfungiblePositionManager ---");
      const pm = await PositionManager.deploy(factoryAddr, wethAddr, descriptorAddr, {
        gasLimit: MAX_SIGNER_GAS_LIMIT,
      });
      console.log("  tx:", pm.deploymentTransaction()?.hash ?? "(unknown)");
      await pm.waitForDeployment();
      positionManagerAddr = await pm.getAddress();
      console.log("  deployed:", positionManagerAddr);
      positionManager = pm;
      await tryVerify(positionManagerAddr, [factoryAddr, wethAddr, descriptorAddr]);
    } else {
      console.log("\n--- Reusing UNISWAP_V3_POSITION_MANAGER ---");
      positionManagerAddr = ethers.getAddress(uniswapV3PmEnv);
      console.log(positionManagerAddr);
      positionManager = new Contract(positionManagerAddr, PositionManagerArtifact.abi, deployer);
    }

    const router = new Contract(routerAddr, SwapRouterArtifact.abi, deployer);

    console.log("UniswapV3Factory:", factoryAddr);
    console.log("WETH9:", wethAddr);
    console.log("SwapRouter:", routerAddr);
    console.log("QuoterV2:", quoterV2Addr);
    console.log("PositionDescriptor:", descriptorAddr);
    console.log("PositionManager:", positionManagerAddr);

    // Create and initialize pool (1:1)
    const factoryRW = new ethers.Contract(factoryAddr, V3_FACTORY_ABI, deployer);
    let createPoolTxHash: string | undefined;
    let initializePoolTxHash: string | undefined;
    let poolAddr = await factoryRW.getPool(virtualAddr, stableAddr, fee);
    if (poolAddr === ethers.ZeroAddress) {
      console.log("\n--- Factory.createPool ---");
      const txCreate = await factoryRW.createPool(virtualAddr, stableAddr, fee, {
        gasLimit: MAX_SIGNER_GAS_LIMIT,
      });
      const r = await waitTx(txCreate.hash, timeoutMs);
      createPoolTxHash = r.hash;
      console.log("createPool tx:", r.hash);
      poolAddr = await factoryRW.getPool(virtualAddr, stableAddr, fee);
    }
    console.log("Pool:", poolAddr);
    const pool = new ethers.Contract(poolAddr, POOL_ABI, deployer);
    const slot0 = await pool.slot0().catch(() => null);
    if (!slot0 || slot0[0] === 0n) {
      console.log("\n--- Pool.initialize ---");
      const txInit = await pool.initialize(Q96, { gasLimit: MAX_SIGNER_GAS_LIMIT });
      const r = await waitTx(txInit.hash, timeoutMs);
      initializePoolTxHash = r.hash;
      console.log("initialize pool tx:", r.hash);
    }

    // Approve + mint liquidity position
    console.log("\n--- Approving NonfungiblePositionManager ---");
    const needVirtual = amountVirtual + amountSwapIn;
    if ((await virtual.allowance(deployerAddress, positionManagerAddr)) < needVirtual) {
      await (await virtual.approve(positionManagerAddr, needVirtual)).wait();
      console.log(
        `Approved VIRTUAL for PositionManager (${needVirtual} base units = liquidity + swap test)`
      );
    }
    if ((await stable.allowance(deployerAddress, positionManagerAddr)) < amountStable) {
      await (await stable.approve(positionManagerAddr, amountStable)).wait();
      console.log("Approved stable for PositionManager");
    }

    const token0 = virtualAddr.toLowerCase() < stableAddr.toLowerCase() ? virtualAddr : stableAddr;
    const token1 = token0 === virtualAddr ? stableAddr : virtualAddr;
    const amount0Desired = token0 === virtualAddr ? amountVirtual : amountStable;
    const amount1Desired = token1 === stableAddr ? amountStable : amountVirtual;

    const tickLower = -600;
    const tickUpper = 600;
    const mintParams = {
      token0,
      token1,
      fee,
      tickLower,
      tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min: 0n,
      amount1Min: 0n,
      recipient: deployerAddress,
      deadline: deadlineSec(),
    };
    console.log("\n--- NonfungiblePositionManager.mint ---");
    console.log(
      `VIRTUAL: ${amountVirtual} base units (${liquidityHuman} * 10^${virtualDecimals}) | stable: ${amountStable} base units (${liquidityHuman} * 10^${stableDecimals}) | ticks [${tickLower}, ${tickUpper}] fee ${fee}`
    );
    const txMint = await positionManager.mint(mintParams, { gasLimit: MAX_SIGNER_GAS_LIMIT });
    const rcMint = await waitTx(txMint.hash, timeoutMs);
    console.log("mint tx:", rcMint.hash);

    // Swap smoke: virtual -> stable (buy) then stable -> virtual (sell)
    console.log("\n--- Approving SwapRouter (swap smoke) ---");
    if ((await virtual.allowance(deployerAddress, routerAddr)) < amountSwapIn) {
      await (await virtual.approve(routerAddr, amountSwapIn)).wait();
      console.log(`Approved VIRTUAL for Router (${amountSwapIn} base units for swap test)`);
    }
    const buyParams = {
      tokenIn: virtualAddr,
      tokenOut: stableAddr,
      fee,
      recipient: deployerAddress,
      deadline: deadlineSec(),
      amountIn: amountSwapIn,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    };
    console.log("\n--- router.exactInputSingle (VIRTUAL → stable) ---");
    console.log(
      `Swapping ${swapVirtualHuman} VIRTUAL (${amountSwapIn} base units) → stable, amountOutMinimum=0 (dev only)`
    );
    const txBuy = await router.exactInputSingle(buyParams, { gasLimit: MAX_SIGNER_GAS_LIMIT });
    const rcBuy = await waitTx(txBuy.hash, timeoutMs);
    console.log("exactInputSingle buy tx:", rcBuy.hash);

    const stableBal = await stable.balanceOf(deployerAddress);
    if (stableBal <= 0n) throw new Error("buy smoke failed: zero stable received");
    if ((await stable.allowance(deployerAddress, routerAddr)) < stableBal) {
      await (await stable.approve(routerAddr, stableBal)).wait();
      console.log("Approved stable for Router (full balance for sell-back smoke)");
    }
    const sellParams = {
      tokenIn: stableAddr,
      tokenOut: virtualAddr,
      fee,
      recipient: deployerAddress,
      deadline: deadlineSec(),
      amountIn: stableBal,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    };
    console.log("\n--- router.exactInputSingle (stable → VIRTUAL) ---");
    console.log(
      `Swapping full stable balance (${stableBal} base units) → VIRTUAL, amountOutMinimum=0 (dev only)`
    );
    const txSell = await router.exactInputSingle(sellParams, { gasLimit: MAX_SIGNER_GAS_LIMIT });
    const rcSell = await waitTx(txSell.hash, timeoutMs);
    console.log("exactInputSingle sell tx:", rcSell.hash);

    console.log("\n✅ Uniswap V3 deploy + liquidity + buy/sell smoke passed");

    console.log("\n--- Paste into env if needed ---");
    console.log(`UNISWAP_V3_FACTORY=${factoryAddr}`);
    console.log(`UNISWAP_V3_WETH9=${wethAddr}`);
    console.log(`UNISWAP_V3_POSITION_DESCRIPTOR=${descriptorAddr}`);
    console.log(`UNISWAP_V3_ROUTER=${routerAddr}`);
    console.log(`UNISWAP_V3_QUOTER_V2=${quoterV2Addr}`);
    console.log(`UNISWAP_V3_POSITION_MANAGER=${positionManagerAddr}`);
    console.log(`UNISWAP_V3_POOL=${poolAddr}`);
    console.log(`VIRTUAL_TOKEN_ADDRESS=${virtualAddr}`);
    console.log(`AGENT_TAX_ASSET_TOKEN=${stableAddr}`);
    console.log("");
    console.log(
      `# createPool tx: ${createPoolTxHash ?? "(skipped — pool already existed)"}`
    );
    console.log(`# Pool: ${poolAddr}`);
    console.log(
      `# initialize pool tx: ${initializePoolTxHash ?? "(skipped — already initialized)"}`
    );
    console.log(`# mint liquidity tx: ${rcMint.hash}`);
    console.log(`# buy swap tx: ${rcBuy.hash}`);
    console.log(`# sell swap tx: ${rcSell.hash}`);
  } catch (e: any) {
    console.error(e);
    process.exit(1);
  }
})();