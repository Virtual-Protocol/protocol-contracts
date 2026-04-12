const fs = require("fs");
const path = require("path");
const readline = require("readline");
const hre = require("hardhat");
const { run } = hre;

/** Same idea as run_local_deploy.sh `update_env_var`: upsert KEY=value in a dotenv file. */
export function upsertLaunchpadEnvFile(
  envPath: string | undefined,
  key: string,
  value: string
): void {
  if (!envPath) {
    console.warn(`upsertLaunchpadEnvFile: skip ${key} (ENV_FILE not set)`);
    return;
  }
  const abs = path.isAbsolute(envPath)
    ? envPath
    : path.join(process.cwd(), envPath);
  if (!fs.existsSync(abs)) {
    console.warn(`upsertLaunchpadEnvFile: file missing: ${abs}`);
    return;
  }
  let content = fs.readFileSync(abs, "utf8");
  const line = `${key}=${value}`;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) content += "\n";
    content += `${line}\n`;
  }
  fs.writeFileSync(abs, content, "utf8");
  console.log(`  (env) ${key}=${value}  ← ${abs}`);
}

/** False when CI / LAUNCHPAD_NON_INTERACTIVE or no TTY. */
export function isLaunchpadInteractive(): boolean {
  if (
    process.env.LAUNCHPAD_NON_INTERACTIVE === "true" ||
    process.env.CI === "true"
  ) {
    return false;
  }
  return (
    process.stdin.isTTY === true && process.stdout.isTTY === true
  );
}

export async function promptYes(question: string): Promise<boolean> {
  if (!isLaunchpadInteractive()) return false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * Central gas defaults for Hardhat + `@nomicfoundation/hardhat-ethers` signers.
 *
 * Hardhat's LocalAccountsProvider (micro-eth-signer) rejects `gasLimit` above 30_000_000.
 * Many L2s return `eth_estimateGas` above that for large txs — cap explicitly instead of
 * re-implementing per script.
 *
 * **Monad (monad_testnet / monad_mainnet):** fees use `gas_limit × gas_price`, not `gas_used`
 * (see Monad docs — async execution / block space). Defaults here are **lower** so you do not
 * overpay by setting a huge limit. Override with LAUNCHPAD_TX_GAS_LIMIT / LAUNCHPAD_HEAVY_TX_GAS_LIMIT
 * or the MONAD_* aliases below if a tx reverts with out-of-gas.
 *
 * Optional env (protocol-contracts, all numeric):
 *   LAUNCHPAD_TX_GAS_LIMIT — bonding buy/sell, `launch()`, typical swaps (default 3_000_000; lower on Monad)
 *   LAUNCHPAD_HEAVY_TX_GAS_LIMIT — big deploys, Uni createPool/mint, etc. (default 30_000_000 non-Monad; lower on Monad)
 *   LAUNCHPAD_BATCH_SWAP_MIN_GAS / LAUNCHPAD_BATCH_SWAP_GAS_PER_TOKEN — batch tax swap (tighter defaults on Monad)
 *   LAUNCHPAD_MONAD_* — same semantics, read only on Monad if the non-MONAD var is unset
 *   LAUNCHPAD_MONAD_GAS_LIMIT_CEILING — max gas for preLaunch cap (default 12_000_000 on Monad vs 30M)
 */
export const HARDHAT_SIGNER_GAS_CEILING = 30_000_000;
export const HARDHAT_SIGNER_GAS_CEILING_BIGINT = 30_000_000n;

/** https://docs.monad.xyz — fee = gas_limit × price (not gas_used). */
export function isMonadHardhatNetwork(): boolean {
  try {
    const n = hre.network?.name as string | undefined;
    return n === "monad_testnet" || n === "monad_mainnet";
  } catch {
    return false;
  }
}

/** Upper bound for preLaunch `gasLimit` (estimate × buffer). Lower on Monad. */
export function launchpadGasLimitCeilingBigint(): bigint {
  if (isMonadHardhatNetwork()) {
    const raw = process.env.LAUNCHPAD_MONAD_GAS_LIMIT_CEILING;
    if (raw !== undefined && raw !== "") {
      return BigInt(raw);
    }
    return 12_000_000n;
  }
  return HARDHAT_SIGNER_GAS_CEILING_BIGINT;
}

/**
 * preLaunch uses `estimateGas * bufferBps / 100`. Tighter on Monad (fee ∝ gas_limit).
 * Override: LAUNCHPAD_MONAD_PRELAUNCH_BUFFER_BPS (Monad) or LAUNCHPAD_PRELAUNCH_BUFFER_BPS (any).
 */
export function preLaunchGasBufferBps(): bigint {
  if (isMonadHardhatNetwork()) {
    const v = process.env.LAUNCHPAD_MONAD_PRELAUNCH_BUFFER_BPS;
    if (v !== undefined && v !== "") return BigInt(v);
    return 120n;
  }
  const v = process.env.LAUNCHPAD_PRELAUNCH_BUFFER_BPS;
  if (v !== undefined && v !== "") return BigInt(v);
  return 150n;
}

const MONAD_DEFAULT_TX = 1_200_000;
const MONAD_DEFAULT_HEAVY = 14_000_000;
const MONAD_DEFAULT_BATCH_FLOOR = 1_000_000;
const MONAD_DEFAULT_BATCH_PER = 500_000;

function clampGasInt(n: number): number {
  if (!Number.isFinite(n)) return 3_000_000;
  return Math.min(Math.max(Math.floor(n), 21_000), HARDHAT_SIGNER_GAS_CEILING);
}

function envNumPreferMonad(
  generalKey: string,
  monadKey: string,
  monadDefault: number,
  nonMonadDefault: number
): number {
  const g = process.env[generalKey];
  if (g !== undefined && g !== "") return Number(g);
  if (isMonadHardhatNetwork()) {
    const m = process.env[monadKey];
    if (m !== undefined && m !== "") return Number(m);
    return monadDefault;
  }
  return nonMonadDefault;
}

/** Default gas for BondingV5 buy/sell, `launch()`, and similar medium txs. */
export function launchpadDefaultTxGasLimit(): bigint {
  const def = envNumPreferMonad(
    "LAUNCHPAD_TX_GAS_LIMIT",
    "LAUNCHPAD_MONAD_TX_GAS_LIMIT",
    MONAD_DEFAULT_TX,
    3_000_000
  );
  return BigInt(clampGasInt(def));
}

/** Gas for heavy deploys / factory / V3 mint (capped at Hardhat signer max). */
export function launchpadHeavyTxGasLimit(): number {
  const def = envNumPreferMonad(
    "LAUNCHPAD_HEAVY_TX_GAS_LIMIT",
    "LAUNCHPAD_MONAD_HEAVY_TX_GAS_LIMIT",
    MONAD_DEFAULT_HEAVY,
    HARDHAT_SIGNER_GAS_CEILING
  );
  return clampGasInt(def);
}

/** Total gas for AgentTaxV2.batchSwapForTokenAddress (scales with token count). */
export function launchpadBatchSwapGasLimit(tokenCount: number): bigint {
  const n = Math.max(1, tokenCount);
  const per = Number(
    envNumPreferMonad(
      "LAUNCHPAD_BATCH_SWAP_GAS_PER_TOKEN",
      "LAUNCHPAD_MONAD_BATCH_SWAP_GAS_PER_TOKEN",
      MONAD_DEFAULT_BATCH_PER,
      1_500_000
    )
  );
  const floor = Number(
    envNumPreferMonad(
      "LAUNCHPAD_BATCH_SWAP_MIN_GAS",
      "LAUNCHPAD_MONAD_BATCH_SWAP_MIN_GAS",
      MONAD_DEFAULT_BATCH_FLOOR,
      3_000_000
    )
  );
  return BigInt(clampGasInt(Math.max(floor, per * n)));
}

/**
 * Monad Sourcify server (Monad Vision). See:
 * https://docs.monad.xyz/guides/verify-smart-contract/hardhat
 */
const MONAD_SOURCIFY = {
  apiUrl: "https://sourcify-api-monad.blockvision.org",
  browserUrl: "https://monadvision.com",
};

/**
 * Verify a contract: Etherscan-compatible explorers and/or Sourcify.
 * On monad_testnet / monad_mainnet: runs Sourcify first (verify:verify would stop if Etherscan fails), then MonadScan.
 */
export async function verifyContract(
  address: string,
  constructorArguments: any[] = [],
  opts?: { contract?: string }
) {
  console.log(`\n--- Verifying contract at ${address} ---`);
  const net = hre.network.name;
  const isMonad = net === "monad_testnet" || net === "monad_mainnet";

  if (isMonad) {
    const s = hre.config.sourcify;
    const prev = {
      enabled: s.enabled,
      apiUrl: s.apiUrl,
      browserUrl: s.browserUrl,
    };
    s.enabled = true;
    s.apiUrl = MONAD_SOURCIFY.apiUrl;
    s.browserUrl = MONAD_SOURCIFY.browserUrl;
    try {
      await run("verify:sourcify", {
        address,
        ...(opts?.contract ? { contract: opts.contract } : {}),
      });
      console.log("✅ Sourcify OK (Monad Vision / public repo)");
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (/already been verified|Already verified/i.test(msg)) {
        console.log("✅ Already verified on Sourcify");
      } else {
        console.log("⚠️ Sourcify failed:", msg);
      }
    } finally {
      s.enabled = prev.enabled;
      s.apiUrl = prev.apiUrl;
      s.browserUrl = prev.browserUrl;
    }

    try {
      await run("verify:etherscan", {
        address,
        constructorArgsParams: constructorArguments,
        libraries: {},
        ...(opts?.contract ? { contract: opts.contract } : {}),
      });
      console.log("✅ MonadScan (Etherscan v2) OK");
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes("Already Verified")) {
        console.log("✅ Already verified on MonadScan");
      } else {
        console.log(
          "⚠️ MonadScan failed (Sourcify above may still be enough):",
          msg
        );
      }
    }
    return;
  }

  try {
    await run("verify:verify", {
      address,
      constructorArguments,
      ...(opts?.contract ? { contract: opts.contract } : {}),
    });
    console.log("✅ Contract verified");
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    if (msg.includes("Already Verified")) {
      console.log("✅ Contract already verified");
    } else {
      console.log("⚠️ Verification failed:", msg);
    }
  }
}