/**
 * Deploy TaxAccountingAdapter (OpenZeppelin transparent proxy).
 *
 * Next steps (manual): upgrade AgentFactoryV7, `setTaxAccountingAdapter`, `setImplementations` for AgentTokenV4,
 * then test `upgradeTaxAccountingAdapter` from scripts/dev.
 *
 * Usage:
 *   ENV_FILE=.env.launchpadv5_dev npx hardhat run scripts/launchpadv5/deployTaxAccountingAdapter.ts --network base_sepolia
 *
 * Env:
 *   CONTRACT_CONTROLLER   Required. Used for both (1) ProxyAdmin owner — upgrades, same as deployLaunchpadv5_1 /
 *                         upgradeTaxAccountingAdapter.ts — and (2) `initialize(address)` → TaxAccountingAdapter Ownable
 *                         (emergency withdraw).
 *
 * If TAX_ACCOUNTING_ADAPTER_ADDRESS is already set in the environment, deployment is skipped (set
 * TAX_ACCOUNTING_ADAPTER_FORCE_DEPLOY=true to deploy anyway).
 *
 * When ENV_FILE is set, appends TAX_ACCOUNTING_ADAPTER_ADDRESS to that file.
 */
import {
  verifyContract,
  upsertLaunchpadEnvFile,
} from "./utils";

const hre = require("hardhat");
const { ethers, upgrades } = hre;

export async function deployTaxAccountingAdapterSuite(): Promise<{
  proxyAddress: string;
  owner: string;
}> {
  if (
    process.env.TAX_ACCOUNTING_ADAPTER_ADDRESS &&
    process.env.TAX_ACCOUNTING_ADAPTER_FORCE_DEPLOY !== "true"
  ) {
    console.log(
      "\n=== TAX_ACCOUNTING_ADAPTER_ADDRESS already set; skipping deploy ==="
    );
    console.log("Address:", process.env.TAX_ACCOUNTING_ADAPTER_ADDRESS);
    console.log(
      "Unset it or set TAX_ACCOUNTING_ADAPTER_FORCE_DEPLOY=true to deploy a new proxy."
    );
    return {
      proxyAddress: process.env.TAX_ACCOUNTING_ADAPTER_ADDRESS,
      owner: "",
    };
  }

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  const contractController = (process.env.CONTRACT_CONTROLLER || "").trim();
  if (!contractController) {
    throw new Error(
      "CONTRACT_CONTROLLER not set — required for ProxyAdmin owner and initialize(owner)."
    );
  }
  if (!ethers.isAddress(contractController)) {
    throw new Error(`Invalid CONTRACT_CONTROLLER: "${contractController}"`);
  }

  console.log("\n=== Deploy TaxAccountingAdapter (proxy) ===");
  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployerAddress);
  console.log(
    "Contract controller (ProxyAdmin owner + Ownable owner):",
    contractController
  );

  const Factory = await ethers.getContractFactory("TaxAccountingAdapter");
  const proxy = await upgrades.deployProxy(Factory, [contractController], {
    initializer: "initialize",
    initialOwner: contractController,
  });
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  const impl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("Proxy:         ", proxyAddress);
  console.log("Implementation:", impl);

  await verifyContract(proxyAddress, []);

  const envFile = process.env.ENV_FILE?.trim();
  upsertLaunchpadEnvFile(envFile, "TAX_ACCOUNTING_ADAPTER_ADDRESS", proxyAddress);

  console.log("\n--- Paste into .env ---");
  console.log(`TAX_ACCOUNTING_ADAPTER_ADDRESS=${proxyAddress}`);

  return { proxyAddress, owner: contractController };
}

const isHardhatRunThisScript = process.argv.some(
  (x) =>
    typeof x === "string" &&
    x.replace(/\\/g, "/").endsWith("deployTaxAccountingAdapter.ts")
);
if (isHardhatRunThisScript) {
  (async () => {
    try {
      await deployTaxAccountingAdapterSuite();
    } catch (e: unknown) {
      console.error(e);
      process.exit(1);
    }
  })();
}
