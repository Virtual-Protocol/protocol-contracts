/**
 * UniV2 direct swap smoke test on a live testnet (e.g. Base Sepolia) to verify AgentToken tax accrues on the
 * token contract when selling via the same router the token uses post-graduation.
 *
 * You only need to set `AGENT_TOKEN_ADDRESS` below. Quote token and router come from env (same as other launchpadv5 scripts).
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/handle_univ2_buy_sell.ts --network base_sepolia
 *   ENV_FILE=.env.launchpadv5_local npx hardhat run scripts/launchpadv5/handle_univ2_buy_sell.ts --network local
 *
 * When using `--network local`, point Hardhat at a node that forks Base Sepolia (84532), e.g.
 *   npx hardhat node --fork https://sepolia.base.org
 * If `eth_getCode(VIRTUAL)` is empty, `decimals()` fails with BAD_DATA — the fork is not active or the RPC is wrong.
 *
 * Required env:
 *   PRIVATE_KEY
 *   VIRTUAL_TOKEN_ADDRESS  — quote asset (VIRTUAL on Base Sepolia)
 *   UNISWAP_V2_ROUTER        — UniswapV2Router02; must be the same `factory()` that created the agent/VIRTUAL pair
 *
 * Optional env:
 *   BUY_VIRTUAL_AMOUNT  — human string, default "0.1"
 *   SKIP_BUY=true         — only sell (you must already hold agent tokens)
 *   SKIP_SELL=true        — only buy
 *   SELL_GAS_MULTIPLIER_BPS — sell tx gasLimit = eth_estimateGas × (this / 10000); default 15000 (= 1.5×).
 *                             SELL is heavier (AgentTokenV4 tax + optional autoswap → TaxAccountingAdapter → depositTax).
 *
 * Swap paths (AgentToken is fee-on-transfer on sells):
 *   BUY  — swapExactTokensForTokens (quote → agent)
 *   SELL — swapExactTokensForTokensSupportingFeeOnTransferTokens (agent → quote)
 */
import {
  parseUnits,
  formatUnits,
  MaxUint256,
  type Contract,
  type FunctionFragment,
} from "ethers";

type SwapGasStats = {
  gasEstimated?: bigint;
  gasLimitSent?: bigint;
  gasUsed?: bigint;
};
import RouterArtifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";

const { ethers } = require("hardhat");

// ============================================
// Edit only this (agent ERC20)
// ============================================
const AGENT_TOKEN_ADDRESS =
  "0x663a3622B6568Bd7Eb2413553B869EA742a50902" as string;
const buyHuman = process.env.BUY_VIRTUAL_AMOUNT?.trim() || "99";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
] as const;

const AGENT_VIEW_ABI = [
  "function uniswapV2Pair() external view returns (address)",
  "function isLiquidityPool(address) external view returns (bool)",
] as const;

function formatRevertError(err: unknown): string {
  if (err === null || err === undefined) return String(err);
  if (typeof err === "object" && err !== null && "shortMessage" in err) {
    return String((err as { shortMessage?: string }).shortMessage || err);
  }
  return String(err);
}

async function assertContract(
  label: string,
  address: string,
  provider: { getCode: (addr: string) => Promise<string> }
): Promise<void> {
  const code = await provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(
      `${label} (${address}) has no contract code on this RPC. ` +
        `If you use a local node, start it with a Base Sepolia fork, e.g. \`npx hardhat node --fork https://sepolia.base.org\`, ` +
        `then run this script with \`--network local\` while that process is running. ` +
        `Otherwise use \`--network base_sepolia\` with a working RPC.`
    );
  }
}

async function main() {
  if (
    !AGENT_TOKEN_ADDRESS ||
    AGENT_TOKEN_ADDRESS === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error(
      "Set AGENT_TOKEN_ADDRESS at the top of handle_univ2_buy_sell.ts"
    );
  }

  const virtualAddr = process.env.VIRTUAL_TOKEN_ADDRESS?.trim();
  const routerAddr = process.env.UNISWAP_V2_ROUTER?.trim();
  if (!virtualAddr) throw new Error("VIRTUAL_TOKEN_ADDRESS is required");
  if (!routerAddr) throw new Error("UNISWAP_V2_ROUTER is required");

  const skipBuy = process.env.SKIP_BUY === "true";
  const skipSell = process.env.SKIP_SELL === "true";

  const sellGasMultBps = BigInt(
    process.env.SELL_GAS_MULTIPLIER_BPS?.trim() || "15000"
  );
  if (sellGasMultBps < 10000n) {
    throw new Error(
      "SELL_GAS_MULTIPLIER_BPS must be >= 10000 (100% of estimate)"
    );
  }

  const [signer] = await ethers.getSigners();
  const deployerAddress = await signer.getAddress();

  const virtual = new ethers.Contract(virtualAddr, ERC20_ABI, signer);
  const agent = new ethers.Contract(AGENT_TOKEN_ADDRESS, ERC20_ABI, signer);
  const agentView = new ethers.Contract(
    AGENT_TOKEN_ADDRESS,
    AGENT_VIEW_ABI,
    ethers.provider
  );

  const routerIface = new ethers.Interface(RouterArtifact.abi);
  const fragSwapStandard = routerIface.getFunction(
    "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
  )!;
  const fragSwapFeeOnTransfer = routerIface.getFunction(
    "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)"
  )!;

  await assertContract("VIRTUAL_TOKEN_ADDRESS", virtualAddr, ethers.provider);
  await assertContract("UNISWAP_V2_ROUTER", routerAddr, ethers.provider);
  await assertContract("AGENT_TOKEN_ADDRESS", AGENT_TOKEN_ADDRESS, ethers.provider);

  const vd = await virtual.decimals();
  const ad = await agent.decimals();
  const vSym = await virtual.symbol();
  const aSym = await agent.symbol();

  console.log("\nSigner:", deployerAddress);
  console.log("Router:", routerAddr);
  console.log("VIRTUAL:", virtualAddr, `(${vSym}, decimals=${vd})`);
  console.log("Agent:  ", AGENT_TOKEN_ADDRESS, `(${aSym}, decimals=${ad})`);

  let pairAddr: string = ethers.ZeroAddress;
  try {
    pairAddr = await agentView.uniswapV2Pair();
    console.log("agent.uniswapV2Pair:", pairAddr);
  } catch {
    console.log("(no uniswapV2Pair() — pair from factory only)");
  }

  const routerRO = new ethers.Contract(
    routerAddr,
    ["function factory() external view returns (address)"],
    ethers.provider
  );
  const factoryAddr: string = await routerRO.factory();
  const factory = new ethers.Contract(
    factoryAddr,
    ["function getPair(address,address) external view returns (address)"],
    ethers.provider
  );
  const pairFromFactory = await factory.getPair(virtualAddr, AGENT_TOKEN_ADDRESS);
  console.log("factory.getPair(VIRTUAL, agent):", pairFromFactory);
  if (pairFromFactory === ethers.ZeroAddress) {
    console.warn(
      "⚠️ No pair on this factory for VIRTUAL/agent — swaps will likely revert (wrong router or not graduated)."
    );
  }
  if (pairAddr !== ethers.ZeroAddress && pairFromFactory !== ethers.ZeroAddress) {
    console.log("pair matches canonical:", pairAddr.toLowerCase() === pairFromFactory.toLowerCase());
  }

  async function taxOnContract(): Promise<bigint> {
    return agent.balanceOf(AGENT_TOKEN_ADDRESS);
  }

  async function runSwap(
    label: string,
    amountIn: bigint,
    path: string[],
    frag: FunctionFragment,
    swapRole: "buy" | "sell"
  ): Promise<SwapGasStats> {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const args: readonly [bigint, bigint, string[], string, bigint] = [
      amountIn,
      0n,
      path,
      deployerAddress,
      deadline,
    ];
    const calldata = routerIface.encodeFunctionData(frag, args);
    console.log(`\n--- ${label} (${frag.name}) ---`);
    console.log("path:", path.join(" → "));
    console.log("amountIn:", amountIn.toString());
    try {
      await ethers.provider.call({
        to: routerAddr,
        from: deployerAddress,
        data: calldata,
      });
    } catch (e) {
      console.warn("eth_call preview reverted:", formatRevertError(e));
    }

    const txReq = { to: routerAddr, from: deployerAddress, data: calldata };
    let gasEstimated: bigint | undefined;
    try {
      gasEstimated = await ethers.provider.estimateGas(txReq);
    } catch (e) {
      console.warn("estimateGas failed:", formatRevertError(e));
    }

    let gasLimitSent: bigint | undefined;
    if (swapRole === "sell") {
      if (gasEstimated !== undefined) {
        gasLimitSent = (gasEstimated * sellGasMultBps + 9999n) / 10000n;
        console.log(
          `SELL gasLimit = estimate × ${sellGasMultBps}/10000 → estimate=${gasEstimated} gasLimit=${gasLimitSent}`
        );
      } else {
        console.warn(
          "SELL: estimateGas missing; sending without explicit gasLimit (not recommended)"
        );
      }
    } else {
      if (gasEstimated !== undefined) {
        console.log(`BUY gas estimate (informational; tx uses wallet default cap): ${gasEstimated}`);
      }
    }

    const tx = await signer.sendTransaction({
      to: routerAddr,
      data: calldata,
      ...(gasLimitSent !== undefined ? { gasLimit: gasLimitSent } : {}),
    });
    const rc = await tx.wait();
    const gasUsed = rc?.gasUsed !== undefined ? BigInt(rc.gasUsed) : undefined;
    console.log(
      "tx:",
      rc?.hash,
      "status:",
      rc?.status,
      "gasUsed:",
      gasUsed?.toString() ?? "(n/a)"
    );
    return { gasEstimated, gasLimitSent, gasUsed };
  }

  async function approveRouterIfNeeded(
    label: string,
    tokenIn: Contract,
    amountIn: bigint
  ): Promise<void> {
    const allowance = await tokenIn.allowance(deployerAddress, routerAddr);
    if (allowance < amountIn) {
      console.log(`Approving router for ${label}...`);
      const tx = await tokenIn.approve(routerAddr, MaxUint256);
      await tx.wait();
    }
  }

  const virtualBefore = await virtual.balanceOf(deployerAddress);
  const agentBefore = await agent.balanceOf(deployerAddress);
  let tax0 = await taxOnContract();
  console.log("\n--- Balances (before) ---");
  console.log("VIRTUAL:", formatUnits(virtualBefore, vd), vSym);
  console.log("Agent:  ", formatUnits(agentBefore, ad), aSym);
  console.log("Tax on agent contract (balanceOf(agent)):", tax0.toString());

  let buyGas: SwapGasStats = {};
  let sellGas: SwapGasStats = {};

  if (!skipBuy) {
    const buyIn = parseUnits(buyHuman, vd);
    if (virtualBefore < buyIn) {
      throw new Error(
        `Insufficient VIRTUAL: have ${formatUnits(virtualBefore, vd)}, need ${buyHuman}`
      );
    }
    await approveRouterIfNeeded("BUY (VIRTUAL → agent)", virtual, buyIn);
    buyGas = await runSwap(
      "BUY (VIRTUAL → agent)",
      buyIn,
      [virtualAddr, AGENT_TOKEN_ADDRESS],
      fragSwapStandard,
      "buy"
    );
  } else {
    console.log("\n(SKIP_BUY=true)");
  }

  let tax1 = await taxOnContract();
  const agentMid = await agent.balanceOf(deployerAddress);
  console.log("\n--- After buy ---");
  console.log("Agent balance:", formatUnits(agentMid, ad), aSym);
  console.log("Tax on agent contract:", tax1.toString(), `(delta ${tax1 - tax0})`);

  if (!skipSell) {
    const bal = await agent.balanceOf(deployerAddress);
    if (bal === 0n) {
      console.log("Nothing to sell (agent balance 0).");
    } else {
      await approveRouterIfNeeded("SELL (agent → VIRTUAL)", agent, bal);
      sellGas = await runSwap(
        "SELL (agent → VIRTUAL)",
        bal,
        [AGENT_TOKEN_ADDRESS, virtualAddr],
        fragSwapFeeOnTransfer,
        "sell"
      );
    }
  } else {
    console.log("\n(SKIP_SELL=true)");
  }

  const virtualAfter = await virtual.balanceOf(deployerAddress);
  const agentAfter = await agent.balanceOf(deployerAddress);
  let tax2 = await taxOnContract();

  console.log("\n--- Balances (after) ---");
  console.log("VIRTUAL:", formatUnits(virtualAfter, vd), vSym);
  console.log("Agent:  ", formatUnits(agentAfter, ad), aSym);
  console.log("Tax on agent contract (balanceOf(agent)):", tax2.toString());
  console.log(
    "Tax delta (sell should move project tax onto token → often increases before autoswap):",
    (tax2 - tax1).toString()
  );

  console.log("\n" + "=".repeat(72));
  console.log("  Gas comparison: BUY vs SELL");
  console.log("=".repeat(72));
  console.log(
    "BUY:  VIRTUAL → agent via swapExactTokensForTokens. Tax path is buy-side (pool → user); no TaxAccountingAdapter."
  );
  console.log(
    "SELL: agent → VIRTUAL via swapExactTokensForTokensSupportingFeeOnTransferTokens. User→pool sell can trigger"
  );
  console.log(
    "      AgentTokenV4 _autoSwap → TaxAccountingAdapter.swapTaxAndDeposit (router swap + AgentTaxV2.depositTax) — heavier."
  );
  console.log(`SELL gasLimit uses estimate × ${sellGasMultBps}/10000 (SELL_GAS_MULTIPLIER_BPS).`);
  if (buyGas.gasUsed !== undefined || buyGas.gasEstimated !== undefined) {
    console.log(
      `  BUY  eth_estimateGas: ${buyGas.gasEstimated?.toString() ?? "n/a"}  gasUsed: ${buyGas.gasUsed?.toString() ?? "n/a"}`
    );
  }
  if (sellGas.gasUsed !== undefined || sellGas.gasEstimated !== undefined) {
    console.log(
      `  SELL eth_estimateGas: ${sellGas.gasEstimated?.toString() ?? "n/a"}  gasLimit sent: ${sellGas.gasLimitSent?.toString() ?? "n/a"}  gasUsed: ${sellGas.gasUsed?.toString() ?? "n/a"}`
    );
  }
  if (
    buyGas.gasUsed !== undefined &&
    sellGas.gasUsed !== undefined &&
    buyGas.gasUsed > 0n
  ) {
    const ratioBps = (sellGas.gasUsed * 10000n) / buyGas.gasUsed;
    console.log(
      `  Ratio SELL gasUsed / BUY gasUsed ≈ ${(Number(ratioBps) / 10000).toFixed(4)}× (${sellGas.gasUsed} / ${buyGas.gasUsed})`
    );
  }
  console.log("=".repeat(72));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
