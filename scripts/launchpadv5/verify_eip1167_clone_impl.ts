/**
 * Verifies EIP-1167 minimal-proxy implementation parsing — same layout as OpenZeppelin `Clones`
 * and `AgentFactoryV7.getCloneImplementation`.
 *
 * Use this before relying on `legacyAgentTokenV3Implementation` checks on a given network.
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev_arbitrum_sepolia npx hardhat run scripts/launchpadv5/verify_eip1167_clone_impl.ts --network arbitrum_sepolia
 *
 * Env:
 *   AGENT_FACTORY_V7_ADDRESS — required (on-chain `getCloneImplementation` cross-check)
 *   CLONE_ADDRESS_V3 — optional; an agent **clone** (proxy) that should point at legacy V3 implementation
 *   CLONE_ADDRESS_V4 — optional; an agent **clone** that should point at V4 implementation
 *   EXPECTED_V3_IMPLEMENTATION — optional; defaults to `AGENT_TOKEN_V3_IMPLEMENTATION` env or hardcoded fallback
 *   EXPECTED_V4_IMPLEMENTATION — optional; defaults to `AGENT_TOKEN_V4_IMPLEMENTATION` env
 *
 * Note: "Implementation" addresses (e.g. `AGENT_TOKEN_V3_IMPLEMENTATION`) are **delegate targets** (long bytecode).
 * Agent **token instances** you interact with are **clones** (~45 bytes runtime). Example: on Arbitrum Sepolia
 * `0x85A02c33aced66eD39a0fD07FB0cd8d75290939D` is a clone; it delegates to `AGENT_TOKEN_V3_IMPLEMENTATION`
 * (e.g. `0x28DA9E5D949B0cc162796769bd03beD106f370B1`), not to itself. `0x17742fa86139ed9dB81B2ec8037b2525061F97B9`
 * is a V4 **implementation** — use a deployed V4 **agent token clone** for `CLONE_ADDRESS_V4`, not the impl.
 */
import { ethers } from "ethers";

const hre = require("hardhat");
const { ethers: hreEthers } = hre;

/** OpenZeppelin Clones EIP-1167 runtime length. */
const EIP1167_RUNTIME_BYTE_LENGTH = 45;

const FACTORY_ABI = [
  "function getCloneImplementation(address instance) external view returns (address impl)",
] as const;

/** Parse implementation address from runtime `0x` code; returns null if not a standard EIP-1167 clone. */
export function parseEip1167ImplementationFromCode(runtimeHex: string): string | null {
  if (!runtimeHex || runtimeHex === "0x") return null;
  const hex = runtimeHex.startsWith("0x") ? runtimeHex.slice(2) : runtimeHex;
  if (hex.length !== EIP1167_RUNTIME_BYTE_LENGTH * 2) return null;
  // Bytes 10–29 of runtime = 20-byte implementation address (see OZ Clones / AgentFactoryV7).
  const implHex = ("0x" + hex.slice(20, 60)) as `0x${string}`;
  try {
    return ethers.getAddress(implHex);
  } catch {
    return null;
  }
}

function envAddr(key: string): string {
  return String(process.env[key] || "").trim();
}

async function verifyOne(options: {
  label: string;
  cloneAddress: string;
  expectedImpl: string;
  factory: { getCloneImplementation: (a: string) => Promise<string> };
}): Promise<void> {
  const { label, cloneAddress, expectedImpl, factory } = options;
  const code = await hreEthers.provider.getCode(cloneAddress);
  const byteLen = (code.length - 2) / 2;
  const local = parseEip1167ImplementationFromCode(code);

  let onChain: string | undefined;
  let factoryNote = "";
  try {
    onChain = await factory.getCloneImplementation(cloneAddress);
  } catch (e) {
    factoryNote =
      e instanceof Error ? e.message : String(e);
  }

  console.log(`\n--- ${label} ---`);
  console.log("Clone address:     ", cloneAddress);
  console.log("Runtime code bytes:", byteLen, byteLen === EIP1167_RUNTIME_BYTE_LENGTH ? "(EIP-1167 clone shape)" : "(not OZ clone length — wrong address type?)");
  console.log("Parsed locally:    ", local ?? "(null — not parseable as EIP-1167)");
  console.log("Expected impl:     ", ethers.getAddress(expectedImpl));
  if (onChain !== undefined) {
    console.log("Factory on-chain:  ", onChain);
  } else {
    console.log(
      "Factory on-chain:  (call failed — deploy may predate `getCloneImplementation`; local parse still valid)"
    );
    console.log("  → ", factoryNote);
  }

  if (local == null) {
    console.log("Result:            FAIL (could not parse clone bytecode)");
    return;
  }

  const matchesExpected =
    local.toLowerCase() === ethers.getAddress(expectedImpl).toLowerCase();
  console.log(
    "Local vs expected: ",
    matchesExpected ? "OK" : "MISMATCH (wrong EXPECTED_* or clone address)"
  );

  if (onChain !== undefined) {
    const matchesFactory =
      local.toLowerCase() === onChain.toLowerCase();
    console.log(
      "Local vs factory:  ",
      matchesFactory ? "OK" : "FAIL (Solidity `getCloneImplementation` differs — bug)"
    );
  }
}

async function main() {
  const factoryAddr = envAddr("AGENT_FACTORY_V7_ADDRESS");
  if (!factoryAddr || !hreEthers.isAddress(factoryAddr)) {
    throw new Error("Set AGENT_FACTORY_V7_ADDRESS in ENV_FILE");
  }

  const expectedV3 = envAddr("AGENT_TOKEN_V3_IMPLEMENTATION") || "0x28DA9E5D949B0cc162796769bd03beD106f370B1";
  const expectedV4 = envAddr("AGENT_TOKEN_V4_IMPLEMENTATION") || "0xdfc000635776d152236b002D25F95fd34B3753a2";

  // const cloneV3 = "0x85A02c33aced66eD39a0fD07FB0cd8d75290939D";
  const cloneV3 = "0x1cD8eD80aA4479920D8C74b62677b161F7eC2F46";
  const cloneV4 = "0x17742fa86139ed9dB81B2ec8037b2525061F97B9";

  const factory = new hreEthers.Contract(factoryAddr, FACTORY_ABI, hreEthers.provider);

  console.log("Network:", hre.network.name);
  console.log("Factory:", factoryAddr);

  await verifyOne({
    label: "V3 clone (default / CLONE_ADDRESS_V3)",
    cloneAddress: ethers.getAddress(cloneV3),
    expectedImpl: ethers.getAddress(expectedV3),
    factory,
  });

  if (cloneV4 && hreEthers.isAddress(cloneV4)) {
    if (!expectedV4) {
      console.log("\n--- V4 clone ---\nSkip: set EXPECTED_V4_IMPLEMENTATION or AGENT_TOKEN_V4_IMPLEMENTATION");
    } else {
      await verifyOne({
        label: "V4 clone (CLONE_ADDRESS_V4)",
        cloneAddress: ethers.getAddress(cloneV4),
        expectedImpl: ethers.getAddress(expectedV4),
        factory,
      });
    }
  } else {
    console.log(
      "\n--- V4 clone ---\nOptional: set CLONE_ADDRESS_V4 to a deployed AgentTokenV4 **instance** to verify V4 implementation mismatch vs V3."
    );
  }

  console.log(
    "\nTip: your `legacyAgentTokenV3Implementation` on the factory should equal EXPECTED_V3_IMPLEMENTATION once verified."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
