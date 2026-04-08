/**
 * Deploy minimal Uniswap V3 stack (Factory + WETH9 + SwapRouter + NFT descriptor + PositionManager),
 * create a VIRTUAL/stable pool, add liquidity, and run buy/sell smoke swaps.
 *
 * Usage:
 *   # local hardhat network
 *   ENV_FILE=.env.launchpadv5_dev_bsc_testnet npx hardhat run ./scripts/launchpadv5/deployUniswapV3TestnetLiquidity.ts --network hardhat
 *
 *   # bsc testnet
 *   ENV_FILE=.env.launchpadv5_dev_bsc_testnet npx hardhat run ./scripts/launchpadv5/deployUniswapV3TestnetLiquidity.ts --network bsc_testnet
 *
 * Required env (for testnet):
 *   VIRTUAL_TOKEN_ADDRESS
 *
 * Optional env:
 *   AGENT_TAX_ASSET_TOKEN          (existing stable token; if empty script deploys MockERC20Decimals)
 *   LIQUIDITY_AMOUNT               (default "10")
 *   SWAP_TEST_VIRTUAL_AMOUNT       (default "1")
 *   V3_FEE                         (default "3000")
 *   TX_CONFIRM_TIMEOUT_MS          (default "240000")
 *   VERIFY_CONTRACTS=true          (auto verify on explorer when possible)
 *
 * Monad: fees scale with gas_limit (not gas_used). Script uses {@link launchpadHeavyTxGasLimit}.
 * Large deploys may take minutes to confirm — progress is logged before each step.
 */
import { parseUnits } from "ethers";
import { launchpadHeavyTxGasLimit } from "./utils";
import FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SwapRouterArtifact from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
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
    const fee = Number(process.env.V3_FEE || "3000");
    const liquidityHuman = process.env.LIQUIDITY_AMOUNT?.trim() || "10";
    const swapVirtualHuman = process.env.SWAP_TEST_VIRTUAL_AMOUNT?.trim() || "1";

    const MAX_SIGNER_GAS_LIMIT = launchpadHeavyTxGasLimit();

    console.log("\n=== Deploy Uniswap V3 + Liquidity + Buy/Sell ===");
    console.log("Network:", hre.network.name, "chainId:", chainId.toString());
    console.log("Deployer:", deployerAddress);
    console.log(
      "(If this line is the last for several minutes: RPC is slow, or a deploy tx is pending — check explorer / RPC.)"
    );

    let virtualAddr = (process.env.VIRTUAL_TOKEN_ADDRESS || "").trim();
    const hardhatNeedsMockVirtual =
      hre.network.name === "hardhat" &&
      (!ethers.isAddress(virtualAddr) ||
        (await ethers.provider.getCode(virtualAddr)) === "0x");
    if (hardhatNeedsMockVirtual) {
      console.log("VIRTUAL_TOKEN_ADDRESS missing on hardhat, deploying mock VIRTUAL...");
      const Mock = await ethers.getContractFactory("MockERC20Decimals");
      const m = await Mock.deploy(
        "Mock VIRTUAL",
        "mVIRTUAL",
        18,
        deployerAddress,
        parseUnits("1000000", 18),
        { gasLimit: MAX_SIGNER_GAS_LIMIT }
      );
      await m.waitForDeployment();
      virtualAddr = await m.getAddress();
    }
    virtualAddr = mustAddress("VIRTUAL_TOKEN_ADDRESS", virtualAddr);

    let stableAddr = (process.env.AGENT_TAX_ASSET_TOKEN || "").trim();
    const hardhatNeedsMockStable =
      hre.network.name === "hardhat" &&
      (!ethers.isAddress(stableAddr) ||
        (ethers.isAddress(stableAddr) &&
          (await ethers.provider.getCode(stableAddr)) === "0x"));
    if (!ethers.isAddress(stableAddr) || hardhatNeedsMockStable) {
      console.log("AGENT_TAX_ASSET_TOKEN missing, deploying mock stable (6 decimals)...");
      const Mock = await ethers.getContractFactory("MockERC20Decimals");
      const s = await Mock.deploy(
        "Mock USDC",
        "mUSDC",
        6,
        deployerAddress,
        parseUnits("1000000", 6),
        { gasLimit: MAX_SIGNER_GAS_LIMIT }
      );
      await s.waitForDeployment();
      stableAddr = await s.getAddress();
    }
    stableAddr = mustAddress("AGENT_TAX_ASSET_TOKEN", stableAddr);

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

    // Deploy v3 core/periphery minimal set
    const Factory = new ethers.ContractFactory(FactoryArtifact.abi, FactoryArtifact.bytecode, deployer);
    console.log("\n1/5 Deploying UniswapV3Factory...");
    const factory = await Factory.deploy({ gasLimit: MAX_SIGNER_GAS_LIMIT });
    console.log("  tx:", factory.deploymentTransaction()?.hash ?? "(unknown)");
    await factory.waitForDeployment();
    const factoryAddr = await factory.getAddress();
    console.log("  confirmed:", factoryAddr);

    const Weth = new ethers.ContractFactory(WethArtifact.abi, WethArtifact.bytecode, deployer);
    console.log("2/5 Deploying WETH9...");
    const weth = await Weth.deploy({ gasLimit: MAX_SIGNER_GAS_LIMIT });
    console.log("  tx:", weth.deploymentTransaction()?.hash ?? "(unknown)");
    await weth.waitForDeployment();
    const wethAddr = await weth.getAddress();
    console.log("  confirmed:", wethAddr);

    const Descriptor = await ethers.getContractFactory("MockPositionDescriptor");
    console.log("3/5 Deploying MockPositionDescriptor...");
    const descriptor = await Descriptor.deploy({ gasLimit: MAX_SIGNER_GAS_LIMIT });
    console.log("  tx:", descriptor.deploymentTransaction()?.hash ?? "(unknown)");
    await descriptor.waitForDeployment();
    const descriptorAddr = await descriptor.getAddress();
    console.log("  confirmed:", descriptorAddr);

    const Router = new ethers.ContractFactory(SwapRouterArtifact.abi, SwapRouterArtifact.bytecode, deployer);
    console.log("4/5 Deploying SwapRouter...");
    const router = await Router.deploy(factoryAddr, wethAddr, { gasLimit: MAX_SIGNER_GAS_LIMIT });
    console.log("  tx:", router.deploymentTransaction()?.hash ?? "(unknown)");
    await router.waitForDeployment();
    const routerAddr = await router.getAddress();
    console.log("  confirmed:", routerAddr);

    const PositionManager = new ethers.ContractFactory(
      PositionManagerArtifact.abi,
      PositionManagerArtifact.bytecode,
      deployer
    );
    console.log("5/5 Deploying NonfungiblePositionManager (largest bytecode)...");
    const positionManager = await PositionManager.deploy(factoryAddr, wethAddr, descriptorAddr, {
      gasLimit: MAX_SIGNER_GAS_LIMIT,
    });
    console.log("  tx:", positionManager.deploymentTransaction()?.hash ?? "(unknown)");
    await positionManager.waitForDeployment();
    const positionManagerAddr = await positionManager.getAddress();
    console.log("  confirmed:", positionManagerAddr);

    console.log("UniswapV3Factory:", factoryAddr);
    console.log("WETH9:", wethAddr);
    console.log("SwapRouter:", routerAddr);
    console.log("PositionDescriptor:", descriptorAddr);
    console.log("PositionManager:", positionManagerAddr);

    // Create and initialize pool (1:1)
    const factoryRW = new ethers.Contract(factoryAddr, V3_FACTORY_ABI, deployer);
    let poolAddr = await factoryRW.getPool(virtualAddr, stableAddr, fee);
    if (poolAddr === ethers.ZeroAddress) {
      const txCreate = await factoryRW.createPool(virtualAddr, stableAddr, fee, {
        gasLimit: MAX_SIGNER_GAS_LIMIT,
      });
      const r = await waitTx(txCreate.hash, timeoutMs);
      console.log("createPool tx:", r.hash);
      poolAddr = await factoryRW.getPool(virtualAddr, stableAddr, fee);
    }
    console.log("Pool:", poolAddr);
    const pool = new ethers.Contract(poolAddr, POOL_ABI, deployer);
    const slot0 = await pool.slot0().catch(() => null);
    if (!slot0 || slot0[0] === 0n) {
      const txInit = await pool.initialize(Q96, { gasLimit: MAX_SIGNER_GAS_LIMIT });
      const r = await waitTx(txInit.hash, timeoutMs);
      console.log("initialize pool tx:", r.hash);
    }

    // Approve + mint liquidity position
    const needVirtual = amountVirtual + amountSwapIn;
    if ((await virtual.allowance(deployerAddress, positionManagerAddr)) < needVirtual) {
      await (await virtual.approve(positionManagerAddr, needVirtual)).wait();
    }
    if ((await stable.allowance(deployerAddress, positionManagerAddr)) < amountStable) {
      await (await stable.approve(positionManagerAddr, amountStable)).wait();
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
    const txMint = await positionManager.mint(mintParams, { gasLimit: MAX_SIGNER_GAS_LIMIT });
    const rcMint = await waitTx(txMint.hash, timeoutMs);
    console.log("mint liquidity tx:", rcMint.hash);

    // Swap smoke: virtual -> stable (buy) then stable -> virtual (sell)
    if ((await virtual.allowance(deployerAddress, routerAddr)) < amountSwapIn) {
      await (await virtual.approve(routerAddr, amountSwapIn)).wait();
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
    const txBuy = await router.exactInputSingle(buyParams, { gasLimit: MAX_SIGNER_GAS_LIMIT });
    const rcBuy = await waitTx(txBuy.hash, timeoutMs);
    console.log("buy swap tx:", rcBuy.hash);

    const stableBal = await stable.balanceOf(deployerAddress);
    if (stableBal <= 0n) throw new Error("buy smoke failed: zero stable received");
    if ((await stable.allowance(deployerAddress, routerAddr)) < stableBal) {
      await (await stable.approve(routerAddr, stableBal)).wait();
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
    const txSell = await router.exactInputSingle(sellParams, { gasLimit: MAX_SIGNER_GAS_LIMIT });
    const rcSell = await waitTx(txSell.hash, timeoutMs);
    console.log("sell swap tx:", rcSell.hash);

    console.log("\n✅ Uniswap V3 deploy + liquidity + buy/sell smoke passed");

    // Optional verify
    await tryVerify(factoryAddr, []);
    await tryVerify(wethAddr, []);
    await tryVerify(descriptorAddr, []);
    await tryVerify(routerAddr, [factoryAddr, wethAddr]);
    await tryVerify(positionManagerAddr, [factoryAddr, wethAddr, descriptorAddr]);

    console.log("\n--- Paste into env if needed ---");
    console.log(`UNISWAP_V3_FACTORY=${factoryAddr}`);
    console.log(`UNISWAP_V3_ROUTER=${routerAddr}`);
    console.log(`UNISWAP_V3_POSITION_MANAGER=${positionManagerAddr}`);
    console.log(`UNISWAP_V3_POOL=${poolAddr}`);
    console.log(`AGENT_TAX_ASSET_TOKEN=${stableAddr}`);
    console.log(`VIRTUAL_TOKEN_ADDRESS=${virtualAddr}`);
  } catch (e: any) {
    console.error(e);
    process.exit(1);
  }
})();
