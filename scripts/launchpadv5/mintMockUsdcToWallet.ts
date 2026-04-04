/**
 * Mint mock USDC (or any mintable ERC20) to your wallet.
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev_bsc_testnet npx hardhat run scripts/launchpadv5/mintMockUsdcToWallet.ts --network bsc_testnet
 *
 * Required env:
 *   AGENT_TAX_ASSET_TOKEN      token address (your mock USDC)
 *
 * Optional env:
 *   MINT_TO                    receiver address (default: current signer)
 *   MINT_MOCK_USDC_AMOUNT      human-readable amount (default: "10000")
 */
import { parseUnits } from "ethers";

const hre = require("hardhat");
const { ethers } = hre;

const ERC20_MINTABLE_ABI = [
  "function mint(address to, uint256 amount) external",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function balanceOf(address account) external view returns (uint256)",
] as const;

async function ensureMintFunctionExists(tokenAddress: string, caller: string) {
  const iface = new ethers.Interface([
    "function mint(address to, uint256 amount)",
  ]);
  const probeData = iface.encodeFunctionData("mint", [caller, 0n]);

  try {
    // Pure existence probe: static eth_call to detect selector support before sending tx.
    await ethers.provider.call({
      from: caller,
      to: tokenAddress,
      data: probeData,
    });
  } catch (e: any) {
    const msg = String(e?.shortMessage || e?.message || e || "");
    const noMintSelector =
      msg.includes("function selector was not recognized") ||
      msg.includes("unrecognized selector");
    if (noMintSelector) {
      throw new Error(
        `token ${tokenAddress} does not expose mint(address,uint256)`
      );
    }
    // Any other revert likely means access control/pausable/etc; do not false-negative function existence.
    console.log(
      "mint probe reverted (selector exists likely). Continue to send tx and rely on on-chain revert reason if any."
    );
  }
}

function mustAddress(name: string, value?: string): string {
  const v = String(value || "").trim();
  if (!ethers.isAddress(v)) {
    throw new Error(`${name} is invalid: "${v}"`);
  }
  return v;
}

(async () => {
  try {
    const [signer] = await ethers.getSigners();
    const signerAddress = await signer.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const tokenAddress = mustAddress(
      "AGENT_TAX_ASSET_TOKEN",
      process.env.AGENT_TAX_ASSET_TOKEN
    );
    await ensureMintFunctionExists(tokenAddress, signerAddress);
    const to = mustAddress("MINT_TO", process.env.MINT_TO || signerAddress);
    const humanAmount = (
      process.env.MINT_MOCK_USDC_AMOUNT || "10000000"
    ).trim();

    const token = new ethers.Contract(tokenAddress, ERC20_MINTABLE_ABI, signer);
    const decimals = Number(await token.decimals());
    const symbol = await token.symbol().catch(() => "TOKEN");
    const mintAmount = parseUnits(humanAmount, decimals);

    console.log("\n=== Mint Mock Token ===");
    console.log("Network:", hre.network.name, "chainId:", chainId.toString());
    console.log("Signer:", signerAddress);
    console.log("Token:", tokenAddress, `(${symbol}, decimals=${decimals})`);
    console.log("To:", to);
    console.log("Amount:", humanAmount, `(${mintAmount.toString()} raw)`);

    const before = await token.balanceOf(to);
    const tx = await token.mint(to, mintAmount);
    const receipt = await tx.wait();
    const after = await token.balanceOf(to);

    console.log("mint tx:", receipt?.hash || tx.hash);
    console.log("Balance before:", before.toString());
    console.log("Balance after: ", after.toString());
    console.log("✅ Mint done");
  } catch (e: any) {
    console.error(e);
    process.exit(1);
  }
})();
