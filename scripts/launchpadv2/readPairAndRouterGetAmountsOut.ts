/**
 * Read FPairV2 reserves + kLast on a pair, then call FRouterV2.getAmountsOut.
 *
 * Edit CONFIG below (or set env vars) for pair address and router args.
 *
 * Usage:
 *   npx hardhat run scripts/launchpadv2/readPairAndRouterGetAmountsOut.ts --network <network>
 *
 * Optional:
 *   ENV_FILE=.env.xxx npx hardhat run ...
 *
 * Env overrides (optional, fall back to CONFIG):
 *   PAIR_ADDRESS
 *   FROUTER_V2_ADDRESS
 *   GET_AMOUNTS_OUT_TOKEN
 *   GET_AMOUNTS_OUT_ASSET_TOKEN
 *   GET_AMOUNTS_OUT_AMOUNT_IN   (wei string, e.g. "1000000")
 */

import { parseUnits } from "ethers";

const hre = require("hardhat");
const { ethers } = hre;

/** ---- Edit these (or use env vars above) ---- */
const CONFIG = {
  /** Pair to inspect (FPairV2 / launchpad pair) */
  pairAddress: "0x084E4BEEb7F2f5acf5767A017CfA710a552F35E1" as const,

  /** Deployed FRouterV2 proxy / implementation address you want to query */
  fRouterV2Address: "0xBfCE3fbe9cE3a19adb8DbB096Ea2Cb2bb1073F95" as const,

  /**
   * getAmountsOut(token, assetToken_, amountIn)
   * - token: agent / project token side used by the router’s factory pair lookup
   * - assetToken_: must match router.assetToken() for “sell asset for token” branch,
   *   or the other token address for the opposite direction (see FRouterV2.sol)
   * - amountIn: raw wei (use amountInHuman + decimals below if you prefer)
   */
  getAmountsOut: {
    token: "0xc0cd01E486c0d7f6829e7B4a538806EA281C7905" as `0x${string}`,
    assetToken_: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b" as `0x${string}`,
    /** Set either amountIn (wei string) OR amountInHuman + amountInDecimals */
    amountIn: "1307625000000000000000000" as string, // e.g. "1000000" for 1 USDC if 6 decimals
    amountInHuman: "" as string, // e.g. "1" — used only if amountIn is empty
    amountInDecimals: 18 as number,
  },
};

/** Launchpad FPairV2 — two uint256 reserves */
const FPAIR_V2_ABI = [
  "function getReserves() external view returns (uint256 reserveA, uint256 reserveB)",
  "function kLast() external view returns (uint256)",
] as const;

/** Canonical Uniswap V2 pair — uint112,uint112,uint32 */
const UNIV2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function kLast() external view returns (uint256)",
] as const;

const FROUTER_V2_ABI = [
  "function getAmountsOut(address token, address assetToken_, uint256 amountIn) external view returns (uint256 amountOut)",
  "function assetToken() external view returns (address)",
] as const;

function envOr<T extends string>(key: string, fallback: T): T {
  const v = process.env[key];
  return (v && v.trim() !== "" ? v : fallback) as T;
}

async function main() {
  const pairAddress = envOr("PAIR_ADDRESS", CONFIG.pairAddress);
  const routerAddress = envOr("FROUTER_V2_ADDRESS", CONFIG.fRouterV2Address);

  if (
    pairAddress === "0x0000000000000000000000000000000000000000" ||
    routerAddress === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error(
      "Set CONFIG.pairAddress and CONFIG.fRouterV2Address (or PAIR_ADDRESS / FROUTER_V2_ADDRESS env)."
    );
  }

  const token = envOr(
    "GET_AMOUNTS_OUT_TOKEN",
    CONFIG.getAmountsOut.token
  ) as `0x${string}`;
  const assetToken_ = envOr(
    "GET_AMOUNTS_OUT_ASSET_TOKEN",
    CONFIG.getAmountsOut.assetToken_
  ) as `0x${string}`;

  let amountInStr = envOr("GET_AMOUNTS_OUT_AMOUNT_IN", CONFIG.getAmountsOut.amountIn);
  if (!amountInStr) {
    const human = CONFIG.getAmountsOut.amountInHuman;
    if (!human) {
      throw new Error(
        "Set CONFIG.getAmountsOut.amountIn (wei) or amountInHuman + amountInDecimals, or GET_AMOUNTS_OUT_AMOUNT_IN."
      );
    }
    amountInStr = parseUnits(human, CONFIG.getAmountsOut.amountInDecimals).toString();
  }
  const amountIn = BigInt(amountInStr);

  const pair = new ethers.Contract(pairAddress, FPAIR_V2_ABI, ethers.provider);
  const router = new ethers.Contract(routerAddress, FROUTER_V2_ABI, ethers.provider);

  const [reserveA, reserveB] = await pair.getReserves();
  const kLast = await pair.kLast();

  const routerAssetToken = await router.assetToken();
  const amountOut = await router.getAmountsOut(token, assetToken_, amountIn);

  console.log("\n=== Pair (direct calls) ===");
  console.log("pairAddress:", pairAddress);
  console.log("reserveA:", reserveA.toString());
  console.log("reserveB:", reserveB.toString());
  console.log("kLast:   ", kLast.toString());

  console.log("\n=== FRouterV2 ===");
  console.log("router:      ", routerAddress);
  console.log("assetToken():", routerAssetToken);
  console.log("getAmountsOut args: token=", token, "assetToken_=", assetToken_, "amountIn=", amountIn.toString());
  console.log("getAmountsOut => amountOut:", amountOut.toString());
  console.log(
    "\nNote: On-chain getAmountsOut uses factory.getPair(token, router.assetToken()) for reserves — " +
      "your direct pair read may differ if you pass a different pairAddress."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
