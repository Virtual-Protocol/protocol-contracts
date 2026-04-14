/**
 * Calls `AgentFactoryV7.sweepV3ProjectTaxToVirtualAndDeposit(agentToken)` (legacy AgentTokenV3 project-tax sweep).
 *
 * The signer must have `SWEEP_V3_PROJECT_TAX_ROLE` on the factory. Use `PRIVATE_KEY` (or Hardhat network accounts).
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/sweep_v3_project_tax.ts --network base_sepolia
 *
 * Env:
 *   AGENT_FACTORY_V7_ADDRESS — required
 *   TX_CONFIRM_TIMEOUT_MS — optional (default 180000)
 *
 * Edit `AGENT_TOKEN` below (V3 clone) per network / test.
 *
 * Gas: `estimateGas` × buffer (default 130%), capped (default 15M). Many L2 testnet RPCs reject 30M (`launchpadHeavyTxGasLimit`).
 *   SWEEP_TX_GAS_LIMIT — optional fixed gas (bypasses estimate)
 *   SWEEP_GAS_BUFFER_BPS — default 13000 (= 1.3×)
 *   SWEEP_GAS_LIMIT_CEILING — default 15000000 (raise if your chain allows)
 */
import { type TransactionReceipt } from "ethers";

const hre = require("hardhat");
const { ethers } = hre;

const FACTORY_ABI = [
  "function sweepV3ProjectTaxToVirtualAndDeposit(address agentToken) external",
] as const;

/** Read-only checks when estimateGas reverts (same conditions as the real tx). */
const FACTORY_VIEW_ABI = [
  "function legacyAgentTokenV3Implementation() view returns (address)",
  "function getCloneImplementation(address) view returns (address)",
  "function taxAccountingAdapter() view returns (address)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
] as const;

const SWEEP_V3_PROJECT_TAX_ROLE = ethers.keccak256(
  ethers.toUtf8Bytes("SWEEP_V3_PROJECT_TAX_ROLE")
);

// ============================================
// Agent token to sweep — hardcoded (change per regression / network)
// ============================================
const AGENT_TOKEN = "0xf11e998C52AB2860693337A31244E3C4312B449d";

function assertSuccessfulReceipt(
  receipt: TransactionReceipt | null,
  label: string,
  txHash: string
): asserts receipt is TransactionReceipt {
  if (receipt == null) {
    throw new Error(`${label} tx has no receipt (null), txHash=${txHash}`);
  }
  if (receipt.status !== 1) {
    throw new Error(
      `${label} failed on-chain (status=${String(receipt.status)}). txHash=${txHash}`
    );
  }
}

async function waitWithProgress(
  txHash: string,
  label: string,
  timeoutMs: number
): Promise<TransactionReceipt> {
  const startedAt = Date.now();
  while (true) {
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (receipt) return receipt;
    const elapsed = Date.now() - startedAt;
    if (elapsed > timeoutMs) {
      throw new Error(
        `${label} pending > ${Math.floor(timeoutMs / 1000)}s, txHash=${txHash}`
      );
    }
    console.log(`⏳ ${label}… ${Math.floor(elapsed / 1000)}s  tx=${txHash}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function logSweepDiagnostics(
  factoryAddr: string,
  agentToken: string,
  signerAddr: string
): Promise<void> {
  const c = new ethers.Contract(factoryAddr, FACTORY_VIEW_ABI, ethers.provider);
  try {
    const legacy = await c.legacyAgentTokenV3Implementation();
    const cloneImpl = await c.getCloneImplementation(agentToken);
    const adapter = await c.taxAccountingAdapter();
    const hasRole = await c.hasRole(SWEEP_V3_PROJECT_TAX_ROLE, signerAddr);
    console.error("[sweep diagnostic] legacyAgentTokenV3Implementation:", legacy);
    console.error("[sweep diagnostic] getCloneImplementation(agentToken):", cloneImpl);
    console.error("[sweep diagnostic] taxAccountingAdapter:", adapter);
    console.error("[sweep diagnostic] signer has SWEEP_V3_PROJECT_TAX_ROLE:", hasRole);
    if (legacy === ethers.ZeroAddress) {
      console.error(
        "[sweep diagnostic] -> set legacy via setLegacyAgentTokenV3Implementation (else LegacyV3ImplementationNotSet)"
      );
    }
    if (
      legacy !== ethers.ZeroAddress &&
      cloneImpl !== legacy
    ) {
      console.error(
        "[sweep diagnostic] -> clone impl !== legacy (NotLegacyV3AgentToken or not EIP-1167 clone)"
      );
    }
    if (adapter === ethers.ZeroAddress) {
      console.error("[sweep diagnostic] -> TaxAccountingAdapterNotSet");
    }
    if (!hasRole) {
      console.error(
        "[sweep diagnostic] -> grant SWEEP_V3_PROJECT_TAX_ROLE to signer on factory"
      );
    }
  } catch (e) {
    console.error("[sweep diagnostic] read failed:", e);
  }
}

/** Base / OP stack testnets often cap below Hardhat's 30M; use estimate + sane ceiling. */
async function resolveSweepGasLimit(
  factoryAddr: string,
  factory: { sweepV3ProjectTaxToVirtualAndDeposit: { estimateGas: (a: string) => Promise<bigint> } },
  agentToken: string,
  signerAddr: string
): Promise<bigint> {
  const fixed = process.env.SWEEP_TX_GAS_LIMIT?.trim();
  if (fixed) return BigInt(fixed);

  const ceiling = BigInt(process.env.SWEEP_GAS_LIMIT_CEILING || "15000000");
  const bufferBps = BigInt(process.env.SWEEP_GAS_BUFFER_BPS || "13000");

  let estimated: bigint;
  try {
    estimated =
      await factory.sweepV3ProjectTaxToVirtualAndDeposit.estimateGas(agentToken);
  } catch (e) {
    console.error(
      "\nestimateGas reverted: the sweep would fail on-chain for the same reason (not an RPC bug).\n"
    );
    await logSweepDiagnostics(factoryAddr, agentToken, signerAddr);
    throw e;
  }
  let buffered = (estimated * bufferBps) / 10000n;
  if (buffered > ceiling) buffered = ceiling;
  if (buffered < estimated) {
    throw new Error(
      `eth_estimateGas=${estimated} exceeds SWEEP_GAS_LIMIT_CEILING=${ceiling}; raise SWEEP_GAS_LIMIT_CEILING or set SWEEP_TX_GAS_LIMIT`
    );
  }
  return buffered;
}

async function main() {
  const factoryAddr = (process.env.AGENT_FACTORY_V7_ADDRESS || "").trim();
  if (!factoryAddr || !ethers.isAddress(factoryAddr)) {
    throw new Error("Set AGENT_FACTORY_V7_ADDRESS in ENV_FILE");
  }

  const agentToken = ethers.getAddress(AGENT_TOKEN);
  const timeoutMs = Number(process.env.TX_CONFIRM_TIMEOUT_MS || "180000");

  const [signer] = await ethers.getSigners();
  const signerAddr = await signer.getAddress();

  console.log("Network:", hre.network.name);
  console.log("Signer: ", signerAddr);
  console.log("Factory:", factoryAddr);
  console.log("Agent token (V3 clone):", agentToken);

  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, signer);

  const gasLimit = await resolveSweepGasLimit(factoryAddr, factory, agentToken, signerAddr);
  console.log("gasLimit:", gasLimit.toString());

  const tx = await factory.sweepV3ProjectTaxToVirtualAndDeposit(agentToken, {
    gasLimit,
  });
  console.log("Submitted:", tx.hash);

  const receipt = await waitWithProgress(tx.hash, "sweepV3ProjectTaxToVirtualAndDeposit", timeoutMs);
  assertSuccessfulReceipt(receipt, "Sweep", tx.hash);

  console.log("✅ Sweep tx succeeded. gasUsed:", receipt.gasUsed.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
