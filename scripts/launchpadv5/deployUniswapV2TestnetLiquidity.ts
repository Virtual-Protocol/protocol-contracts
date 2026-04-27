/**
 * Deploy minimal Uniswap V2 (Factory + WETH9 + Router02), deploy MockERC20Decimals (6 decimals) as mUSDC,
 * and add ERC20–ERC20 liquidity (default: 10 VIRTUAL + 10 mUSDC in human units; VIRTUAL uses on-chain decimals).
 *
 * Works on any EVM chain where Hardhat can send txs (testnets without an official Uniswap).
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev_abstract_testnet npx hardhat run scripts/launchpadv5/deployUniswapV2TestnetLiquidity.ts --network <your_network>
 *
 * Required env:
 *   VIRTUAL_TOKEN_ADDRESS   — existing ERC20 you already have on this chain (e.g. VIRTUAL).
 *                             To deploy a mock with 1B supply: run deployMockVirtualToken.ts on this chain first,
 *                             or set LAUNCHPAD_AUTO_DEPLOY_MOCK_VIRTUAL=1 / LAUNCHPAD_AUTO_UNIV2=1 so this script
 *                             deploys mock when stdin/stdout are not a TTY (e.g. piped through `tee`).
 *
 * Optional env:
 *   UNISWAP_V2_ROUTER       — if set, skip deploying Factory/WETH/Router and use this router
 *                             (must point to UniswapV2Router02 on this chain; factory() must match pairs you use)
 *   AGENT_TAX_ASSET_TOKEN   — (e.g. AgentTax stable / mUSDC on testnet)
 *   LIQUIDITY_AMOUNT        — human amount per side (default "10"): VIRTUAL uses token.decimals(); mUSDC uses 6 (deployed) or existing token.decimals() if stable from env
 *   SWAP_TEST_VIRTUAL_AMOUNT — after addLiquidity, swap this many VIRTUAL → mUSDC via Router (default "1"); deployer must hold LIQUIDITY + this much VIRTUAL
 *   SKIP_SWAP_SMOKE=true    — skip the post-deploy swap smoke test (or set SWAP_TEST_VIRTUAL_AMOUNT=0)
 *
 * Swap failures (after successful addLiquidity) are usually one of:
 *   - Insufficient allowance for the Router after addLiquidity (script logs + can re-approve).
 *   - Pair invariant `UniswapV2: K` if the token credits less to the pair than the Router expects (classic
 *     fee-on-transfer, OR AgentToken-style sell tax when `isLiquidityPool(pair)` is true — not the same as
 *     "fee on transfer" in the ERC20 sense).
 *   - Other: decode revert from diagnostics below or BscScan “internal tx” for the failed tx hash.
 * Swap smoke test: encodes Router02 by explicit function signature (ABI duplicates `swapExactTokensForTokens`),
 * re-approves MaxUint256, sends raw calldata (avoids ethers overload binding issues), then falls back to
 * `swapExactTokensForTokensSupportingFeeOnTransferTokens` if needed. Preflights with eth_call per path.
 *
 * Printed at end: addresses to paste into .env (UNISWAP_V2_ROUTER, AGENT_TAX_*, WETH, FACTORY, PAIR).
 *
 * -----------------------------------------------------------------------------
 * Uniswap V2 — what each piece does (why "only Router" is not enough)
 * -----------------------------------------------------------------------------
 *
 * 1) UniswapV2Factory
 *    - Stores the bytecode used to CREATE2-deploy new Pair contracts.
 *    - createPair(tokenA, tokenB) deploys one Pair per unordered pair (sorted by address).
 *
 * 2) UniswapV2Pair (instance per pool)
 *    - Holds reserves of token0/token1, mints LP shares, swap(), sync(), skim().
 *    - Swaps are NOT executed inside the Router’s storage; they transfer through the Pair.
 *
 * 3) UniswapV2Router02
 *    - Stateless helper: safeTransferFrom user → Pair, then pair.swap / addLiquidity / removeLiquidity.
 *    - Constructor takes (factory, WETH) so it can also wrap native gas token and route ETH↔ERC20.
 *    - For ERC20↔ERC20 swaps: router pulls tokens from you, sends to Pair, Pair.swap(...).
 *
 * 4) WETH9
 *    - Wrapped native token. Router requires it in the constructor even if you only use addLiquidity(A,B);
 *      ETH-specific entrypoints (swapExactETHForTokens, etc.) deposit native into WETH first.
 *
 * Minimal example (conceptual):
 *   approve(Router, amountIn) on tokenIn
 *   router.swapExactTokensForTokens(amountIn, amountOutMin, [tokenIn, tokenOut], to, deadline)
 *   → router transfers tokenIn to Pair, Pair.swap pushes tokenOut to `to`.
 *
 * Artifacts: @uniswap/v2-core (Factory), @uniswap/v2-periphery (WETH9, UniswapV2Router02).
 */
import { parseUnits, dataSlice, MaxUint256, type FunctionFragment } from "ethers";
import {
  launchpadHeavyTxGasLimit,
  upsertLaunchpadEnvFile,
  promptYes,
  isLaunchpadInteractive,
} from "./utils";
import FactoryArtifact from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WethArtifact from "@uniswap/v2-periphery/build/WETH9.json";
import RouterArtifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";

const { ethers } = require("hardhat");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
] as const;

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
] as const;

const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
] as const;

/** Optional: Virtual Protocol AgentToken exposes this; harmless if absent. */
const AGENT_TOKEN_ABI = [
  "function isLiquidityPool(address) external view returns (bool)",
  "function uniswapV2Pair() external view returns (address)",
] as const;

function formatRevertError(err: unknown): string {
  if (err === null || err === undefined) return String(err);
  if (typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof e.shortMessage === "string") parts.push(e.shortMessage);
  if (typeof e.message === "string" && e.message !== e.shortMessage) {
    parts.push(e.message);
  }
  const data = e.data as string | undefined;
  if (data && typeof data === "string" && data.length > 10) {
    parts.push(`revertData=${data}`);
    try {
      const iface = new ethers.Interface([
        "error Error(string message)",
        "error Panic(uint256 code)",
      ]);
      const parsed = iface.parseError(data);
      if (parsed) {
        parts.push(`decoded=${parsed.name}(${parsed.args})`);
      }
    } catch {
      if (data.startsWith("0x08c379a0")) {
        try {
          const [msg] = ethers.AbiCoder.defaultAbiCoder().decode(
            ["string"],
            dataSlice(data, 4)
          );
          parts.push(`Error(string): ${msg}`);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return parts.join(" | ");
}

(async () => {
  try {
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    console.log("\n" + "=".repeat(72));
    console.log("  Deploy Uniswap V2 (test) + Mock USDC + add liquidity");
    console.log("=".repeat(72));
    console.log("Deployer:", deployerAddress);
    console.log("Chain ID:", chainId.toString());

    const envFile = process.env.ENV_FILE?.trim();
    const virtualFromEnv = process.env.VIRTUAL_TOKEN_ADDRESS?.trim();
    const taxFromEnv = process.env.AGENT_TAX_TAX_TOKEN?.trim();

    const autoDeployMockVirtual =
      process.env.LAUNCHPAD_AUTO_DEPLOY_MOCK_VIRTUAL === "1" ||
      process.env.LAUNCHPAD_AUTO_DEPLOY_MOCK_VIRTUAL === "true" ||
      process.env.LAUNCHPAD_AUTO_UNIV2 === "1";

    let virtualToken: string;
    if (!virtualFromEnv) {
      const ok =
        autoDeployMockVirtual ||
        (await promptYes(
          "VIRTUAL_TOKEN_ADDRESS is not set.\n" +
            "Deploy mock VIRTUAL (MockERC20Decimals) and write VIRTUAL_TOKEN_ADDRESS + AGENT_TAX_TAX_TOKEN to ENV_FILE? [y/N] "
        ));
      if (!ok) {
        if (!isLaunchpadInteractive()) {
          throw new Error(
            "VIRTUAL_TOKEN_ADDRESS missing: add it to ENV_FILE (or deploy mock via deployMockVirtualToken.ts). " +
              "Non-interactive / no TTY: set LAUNCHPAD_AUTO_DEPLOY_MOCK_VIRTUAL=1 or LAUNCHPAD_AUTO_UNIV2=1 to auto-deploy mock."
          );
        }
        throw new Error(
          "VIRTUAL_TOKEN_ADDRESS is required (existing ERC20 on this chain, or accept mock deploy prompt)."
        );
      }
      const { deployMockVirtualTokenSuite } = await import(
        "./deployMockVirtualToken"
      );
      const { address } = await deployMockVirtualTokenSuite();
      virtualToken = address;
    } else {
      virtualToken = virtualFromEnv;
      if (!taxFromEnv) {
        upsertLaunchpadEnvFile(
          envFile,
          "AGENT_TAX_TAX_TOKEN",
          virtualToken
        );
        process.env.AGENT_TAX_TAX_TOKEN = virtualToken;
      }
    }

    const liquidityHuman = process.env.LIQUIDITY_AMOUNT?.trim() || "10";

    const virtualRO = new ethers.Contract(
      virtualToken,
      ERC20_ABI,
      ethers.provider
    );
    const virtualDecimals = Number(await virtualRO.decimals());
    const amountVirtual = parseUnits(liquidityHuman, virtualDecimals);
    const swapTestVirtualHuman =
      process.env.SWAP_TEST_VIRTUAL_AMOUNT?.trim() ?? "1";
    const amountSwapIn = parseUnits(swapTestVirtualHuman, virtualDecimals);

    let factoryAddr: string;
    let wethAddr: string;
    let routerAddr: string;

    const reuseRouter = process.env.UNISWAP_V2_ROUTER?.trim();
    if (reuseRouter) {
      console.log("\n--- Reusing existing UniswapV2Router02:", reuseRouter);
      const routerRO = new ethers.Contract(
        reuseRouter,
        RouterArtifact.abi,
        ethers.provider
      );
      factoryAddr = await routerRO.factory();
      wethAddr = await routerRO.WETH();
      routerAddr = reuseRouter;
      console.log("Factory (from router):", factoryAddr);
      console.log("WETH (from router):     ", wethAddr);
    } else {
      console.log("\n--- Deploying UniswapV2Factory ---");
      const Factory = new ethers.ContractFactory(
        FactoryArtifact.abi,
        FactoryArtifact.bytecode,
        deployer
      );
      const factory = await Factory.deploy(deployerAddress);
      await factory.waitForDeployment();
      factoryAddr = await factory.getAddress();
      console.log("UniswapV2Factory:", factoryAddr);

      console.log("\n--- Deploying WETH9 ---");
      const Weth = new ethers.ContractFactory(
        WethArtifact.abi,
        WethArtifact.bytecode,
        deployer
      );
      const weth = await Weth.deploy();
      await weth.waitForDeployment();
      wethAddr = await weth.getAddress();
      console.log("WETH9:", wethAddr);

      console.log("\n--- Deploying UniswapV2Router02 ---");
      const Router = new ethers.ContractFactory(
        RouterArtifact.abi,
        RouterArtifact.bytecode,
        deployer
      );
      const router = await Router.deploy(factoryAddr, wethAddr, {
        gasLimit: launchpadHeavyTxGasLimit(),
      });
      await router.waitForDeployment();
      routerAddr = await router.getAddress();
      console.log("UniswapV2Router02:", routerAddr);
    }

    let usdcAddr =
      process.env.AGENT_TAX_ASSET_TOKEN?.trim();
    let usdcDecimals: number;
    let amountUsdc: bigint;

    if (!usdcAddr) {
      usdcDecimals = 6;
      amountUsdc = parseUnits(liquidityHuman, usdcDecimals);
      console.log("\n--- Deploying MockERC20Decimals (mUSDC, 6 decimals) ---");
      const MockUSDC = await ethers.getContractFactory("MockERC20Decimals");
      const initialMint = parseUnits("1000000", usdcDecimals);
      const usdc = await MockUSDC.deploy(
        "Mock USDC",
        "mUSDC",
        usdcDecimals,
        deployerAddress,
        initialMint
      );
      await usdc.waitForDeployment();
      usdcAddr = await usdc.getAddress();
      console.log("Mock USDC (6 decimals):", usdcAddr);
    } else {
      console.log("\n--- Using existing mock/stable token:", usdcAddr);
      const usdcRO = new ethers.Contract(usdcAddr, ERC20_ABI, ethers.provider);
      usdcDecimals = Number(await usdcRO.decimals());
      amountUsdc = parseUnits(liquidityHuman, usdcDecimals);
      console.log(`Existing token decimals: ${usdcDecimals}`);
    }

    const virtual = new ethers.Contract(virtualToken, ERC20_ABI, deployer);
    const usdc = new ethers.Contract(usdcAddr!, ERC20_ABI, deployer);

    const vBal = await virtual.balanceOf(deployerAddress);
    const uBal = await usdc.balanceOf(deployerAddress);
    if (vBal < amountVirtual + amountSwapIn) {
      const isDefaultHardhatSigner =
        deployerAddress.toLowerCase() ===
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
      throw new Error(
        `Deployer VIRTUAL balance too low: have ${vBal}, need ${amountVirtual} (liquidity) + ${amountSwapIn} (swap test = ${swapTestVirtualHuman} token). Fund ${deployerAddress}.` +
          (isDefaultHardhatSigner
            ? ` You are using Hardhat's default account #0; BscScan balance is for your own address. Set PRIVATE_KEY in env (and use "local" with fork — see hardhat.config) or run --network bsc_testnet with the funded key.`
            : "")
      );
    }
    if (uBal < amountUsdc) {
      throw new Error(
        `Deployer mUSDC balance too low: have ${uBal}, need ${amountUsdc}. Mint or fund ${deployerAddress}.`
      );
    }

    const router = new ethers.Contract(
      routerAddr,
      RouterArtifact.abi,
      deployer
    );

    console.log("\n--- Approving Router ---");
    const virtualAllowNeed = amountVirtual + amountSwapIn;
    if (
      (await virtual.allowance(deployerAddress, routerAddr)) < virtualAllowNeed
    ) {
      const tx1 = await virtual.approve(routerAddr, virtualAllowNeed);
      await tx1.wait();
      console.log(
        `Approved VIRTUAL for Router (${virtualAllowNeed} base units = liquidity + swap test)`
      );
    }
    if ((await usdc.allowance(deployerAddress, routerAddr)) < amountUsdc) {
      const tx2 = await usdc.approve(routerAddr, amountUsdc);
      await tx2.wait();
      console.log("Approved mUSDC for Router");
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    console.log("\n--- router.addLiquidity ---");
    console.log(
      `VIRTUAL: ${amountVirtual} base units (${liquidityHuman} * 10^${virtualDecimals}) | mUSDC: ${amountUsdc} base units (${liquidityHuman} * 10^${usdcDecimals})`
    );
    const txAdd = await router.addLiquidity(
      virtualToken,
      usdcAddr!,
      amountVirtual,
      amountUsdc,
      0n,
      0n,
      deployerAddress,
      deadline
    );
    const receipt = await txAdd.wait();
    console.log("addLiquidity tx:", receipt?.hash);

    const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, deployer);
    const pairAddr = await factory.getPair(virtualToken, usdcAddr!);
    console.log("Pair address:", pairAddr);

    // --- Optional swap smoke test: VIRTUAL → mUSDC (Router02)
    // Tax / fee-on-transfer tokens break standard UniV2 swap (pair K check); preflight with eth_call avoids a reverted on-chain tx.
    const swapDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const swapPath = [virtualToken, usdcAddr!] as const;
    const skipSwapSmoke =
      process.env.SKIP_SWAP_SMOKE === "true" || amountSwapIn === 0n;

    if (skipSwapSmoke) {
      console.log("\n--- Swap smoke test skipped ---");
      if (amountSwapIn === 0n) {
        console.log("  (SWAP_TEST_VIRTUAL_AMOUNT is 0)");
      }
    } else {
      console.log("\n--- Swap smoke test diagnostics ---");
      const alw = await virtual.allowance(deployerAddress, routerAddr);
      console.log(
        "VIRTUAL allowance (deployer→Router):",
        alw.toString(),
        "| need for swap:",
        amountSwapIn.toString()
      );
      if (alw < amountSwapIn) {
        console.log("Re-approving Router (allowance < swap amount)...");
        const txAp = await virtual.approve(routerAddr, virtualAllowNeed);
        await txAp.wait();
        console.log("New allowance:", (await virtual.allowance(deployerAddress, routerAddr)).toString());
      }
      if (pairAddr !== ethers.ZeroAddress) {
        const pairRO = new ethers.Contract(pairAddr, PAIR_ABI, ethers.provider);
        const [r0, r1] = await pairRO.getReserves();
        const t0 = await pairRO.token0();
        const t1 = await pairRO.token1();
        console.log("Pair token0:", t0, "token1:", t1);
        console.log("Pair reserves (r0, r1):", r0.toString(), r1.toString());
      }
      try {
        const amts = await router.getAmountsOut(amountSwapIn, [...swapPath]);
        console.log(
          "router.getAmountsOut:",
          amts.map((x: bigint) => x.toString()).join(" → ")
        );
      } catch (e) {
        console.error("getAmountsOut reverted:", formatRevertError(e));
      }
      try {
        const agentRO = new ethers.Contract(
          virtualToken,
          AGENT_TOKEN_ABI,
          ethers.provider
        );
        const isLp = await agentRO.isLiquidityPool(pairAddr);
        console.log("token.isLiquidityPool(this pair):", isLp);
        try {
          const regPair = await agentRO.uniswapV2Pair();
          console.log("token.uniswapV2Pair (canonical):", regPair);
        } catch {
          console.log("(no uniswapV2Pair() on this token)");
        }
        if (isLp) {
          console.log(
            "Note: if this token applies sell tax on transfers TO a registered LP, the Pair can receive less VIRTUAL than UniV2 math expects → UniswapV2: K on swap."
          );
        }
      } catch {
        console.log(
          "(VIRTUAL token does not expose isLiquidityPool — skip AgentToken hints)"
        );
      }

      const usdcBefore = await usdc.balanceOf(deployerAddress);
      const virtualBeforeSwap = await virtual.balanceOf(deployerAddress);
      console.log("\n--- swapExactTokensForTokens (smoke test) ---");
      console.log(
        `Swapping ${swapTestVirtualHuman} VIRTUAL (${amountSwapIn} base units) → mUSDC, amountOutMin=0 (dev only)`
      );

      // UniswapV2Router02.json lists duplicate `swapExactTokensForTokens` entries; ethers Contract
      // method calls can bind the wrong fragment. Encode by explicit signature and send raw calldata.
      const routerIface = new ethers.Interface(RouterArtifact.abi);
      const fragSwapStandard = routerIface.getFunction(
        "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
      )!;
      const fragSwapFeeOnTransfer = routerIface.getFunction(
        "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)"
      )!;
      const swapPathArr = [...swapPath];
      const swapArgs: readonly [bigint, bigint, string[], string, bigint] = [
        amountSwapIn,
        0n,
        swapPathArr,
        deployerAddress,
        swapDeadline,
      ];

      console.log(
        "Re-approving VIRTUAL (Router) with MaxUint256 (avoids exact-allowance edge cases after addLiquidity)..."
      );
      const txApMax = await virtual.approve(routerAddr, MaxUint256);
      await txApMax.wait();

      async function trySwapSmoke(
        label: string,
        frag: FunctionFragment
      ): Promise<boolean> {
        const calldata = routerIface.encodeFunctionData(frag, swapArgs);
        console.log(
          `${label} calldata selector ${calldata.slice(0, 10)} (byteLen=${calldata.length})`
        );
        try {
          await ethers.provider.call({
            to: routerAddr,
            from: deployerAddress,
            data: calldata,
          });
        } catch (e) {
          console.warn(`⚠️ ${label} eth_call reverted:`, formatRevertError(e));
          return false;
        }
        try {
          const txSwap = await deployer.sendTransaction({
            to: routerAddr,
            data: calldata,
          });
          const receiptSwap = await txSwap.wait();
          console.log(`${label} tx:`, receiptSwap?.hash);
          return true;
        } catch (e) {
          console.warn(`⚠️ ${label} on-chain tx failed:`, formatRevertError(e));
          return false;
        }
      }

      let swapOk =
        (await trySwapSmoke("swapExactTokensForTokens", fragSwapStandard)) ||
        (await trySwapSmoke(
          "swapExactTokensForTokensSupportingFeeOnTransferTokens",
          fragSwapFeeOnTransfer
        ));

      if (!swapOk) {
        console.warn(
          "⚠️ Swap smoke test skipped after standard + fee-on-transfer paths failed."
        );
        console.warn(
          "   Common causes: UniswapV2: K (taxed transfer to pair), TRANSFER_FROM_FAILED, deadline."
        );
        console.warn(
          "   addLiquidity and the pair are still valid; use SKIP_SWAP_SMOKE=true to silence."
        );
      } else {
        const usdcAfter = await usdc.balanceOf(deployerAddress);
        const virtualAfterSwap = await virtual.balanceOf(deployerAddress);
        const usdcReceived = usdcAfter - usdcBefore;
        const virtualSpent = virtualBeforeSwap - virtualAfterSwap;
        console.log("VIRTUAL spent (base units):", virtualSpent.toString());
        console.log("mUSDC received (base units):", usdcReceived.toString());
        if (usdcReceived <= 0n) {
          throw new Error(
            "Swap smoke test failed: zero mUSDC received (check pair reserves / path)"
          );
        }
        console.log("✅ Swap smoke test OK");
      }
    }

    console.log("\n" + "=".repeat(72));
    console.log("  Paste into .env");
    console.log("=".repeat(72));
    // Lines parsed by scripts/launchpadv5/run_local_deploy.sh (save_univ2_env_from_log)
    console.log(`UNISWAP_V2_ROUTER=${routerAddr}`);
    console.log(`AGENT_TAX_DEX_ROUTER=${routerAddr}`);
    console.log(`AGENT_TAX_ASSET_TOKEN=${usdcAddr}`);
    console.log(`# Optional reference:`);
    console.log(`# UNISWAP_V2_FACTORY=${factoryAddr}`);
    console.log(`# WETH9=${wethAddr}`);
    console.log(`# VIRTUAL_STABLE_PAIR=${pairAddr}`);
    console.log("=".repeat(72) + "\n");

    if (envFile) {
      upsertLaunchpadEnvFile(envFile, "UNISWAP_V2_ROUTER", routerAddr);
      upsertLaunchpadEnvFile(envFile, "AGENT_TAX_DEX_ROUTER", routerAddr);
      upsertLaunchpadEnvFile(envFile, "AGENT_TAX_ASSET_TOKEN", usdcAddr!);
    }
  } catch (e: any) {
    console.error(e);
    process.exit(1);
  }
})();