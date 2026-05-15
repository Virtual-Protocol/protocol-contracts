/**
 * BSC Testnet (or any EVM) deploy — DpnmV2Template + 6 sub-implementations,
 * registered as `keccak256("dpnm-v2")` on an existing LaunchpadFactory.
 *
 * What this script DOES NOT do:
 *   - Launch any tenant clone. Use the factory's `launch` after this — the
 *     wizard / agentflow-api owns that flow.
 *   - Touch the legacy `dpnm` template registration. The two coexist; the
 *     legacy id can be paused via `factory.pauseTemplate(keccak256("dpnm"), true)`
 *     when ready to retire it.
 *
 * Pipeline:
 *   1. Resolve LaunchpadFactory address from FACTORY_ADDRESS env or the
 *      `deployment-bsc-testnet.json` artefact (addresses.LaunchpadFactory).
 *   2. Deploy implementations: DPNMToken, DPNMGrowToken, DPNMTree,
 *      BuybackPools, Whitelist, DPNMProtocol, DpnmV2Template.
 *   3. Compute init selector for the new 12-arg signature.
 *   4. Call factory.registerTemplate(keccak256("dpnm-v2"), templateImpl,
 *      initSelector). Reverts if `dpnm-v2` is already registered — register
 *      a new id (e.g. `dpnm-v2.1`) instead of upgrading in-place.
 *   5. Persist `deployment-dpnm-v2-template-bsc-testnet.json`.
 *
 * Env (all optional except PRIVATE_KEY):
 *   - FACTORY_ADDRESS   : skip artefact lookup, use this LaunchpadFactory
 *   - DEPLOY_LOG_PATH   : override output JSON path (default per-network)
 *
 * Funds required: ~0.05 BNB on deployer. Note: `registerTemplate` is
 * onlyRole(ADMIN_ROLE) on the factory, so the deployer must hold ADMIN_ROLE
 * (or run the registration tx from a signer that does).
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const TEMPLATE_ID_LABEL = "dpnm-v2";
const TEMPLATE_ID = ethers.id(TEMPLATE_ID_LABEL); // keccak256(utf-8("dpnm-v2"))

function loadFactoryAddressFromArtefact(): string | null {
  const artefactPath = path.join(
    process.cwd(),
    `deployment-${network.name === "bsc_testnet" ? "bsc-testnet" : network.name}.json`,
  );
  try {
    const j = JSON.parse(fs.readFileSync(artefactPath, "utf-8"));
    return j?.addresses?.LaunchpadFactory ?? null;
  } catch {
    return null;
  }
}

async function deploy(name: string): Promise<{ address: string; contract: any }> {
  const F = await ethers.getContractFactory(name);
  const c = await F.deploy();
  await c.waitForDeployment();
  return { address: await c.getAddress(), contract: c };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(
    `[dpnm-v2-template] network=${network.name} chainId=${network.config.chainId} deployer=${deployer.address}`,
  );

  // ----- 1. Resolve factory ---------------------------------------------
  const factoryAddr =
    process.env.FACTORY_ADDRESS ?? loadFactoryAddressFromArtefact();
  if (!factoryAddr) {
    throw new Error(
      `LaunchpadFactory address not provided. Set FACTORY_ADDRESS env or ` +
        `ensure deployment-${network.name}.json contains addresses.LaunchpadFactory`,
    );
  }
  console.log(`[dpnm-v2-template] factory=${factoryAddr}`);
  const factory = await ethers.getContractAt("LaunchpadFactory", factoryAddr);

  // Sanity-check: does this id already exist?
  const existing = await factory.templates(TEMPLATE_ID);
  if (existing.registered) {
    throw new Error(
      `Template id "${TEMPLATE_ID_LABEL}" (${TEMPLATE_ID}) already registered ` +
        `(implementation=${existing.implementation}). ` +
        `Use a fresh id (e.g. dpnm-v2.1) for an upgrade.`,
    );
  }

  // ----- 2. Deploy 6 sub-impls + template -------------------------------
  const dpnmToken = await deploy("DPNMToken");
  console.log(`[dpnm-v2-template] DPNMToken impl=${dpnmToken.address}`);

  const gwt = await deploy("DPNMGrowToken");
  console.log(`[dpnm-v2-template] DPNMGrowToken impl=${gwt.address}`);

  const tree = await deploy("DPNMTree");
  console.log(`[dpnm-v2-template] DPNMTree impl=${tree.address}`);

  const buyback = await deploy("BuybackPools");
  console.log(`[dpnm-v2-template] BuybackPools impl=${buyback.address}`);

  const whitelist = await deploy("Whitelist");
  console.log(`[dpnm-v2-template] Whitelist impl=${whitelist.address}`);

  const protocol = await deploy("DPNMProtocol");
  console.log(`[dpnm-v2-template] DPNMProtocol impl=${protocol.address}`);

  const template = await deploy("DpnmV2Template");
  console.log(`[dpnm-v2-template] DpnmV2Template impl=${template.address}`);

  // ----- 3. Init selector -----------------------------------------------
  const TemplateF = await ethers.getContractFactory("DpnmV2Template");
  const initSelector = TemplateF.interface.getFunction("initialize").selector;
  console.log(`[dpnm-v2-template] initSelector=${initSelector}`);

  // ----- 4. Register on factory -----------------------------------------
  const tx = await factory
    .connect(deployer)
    .registerTemplate(TEMPLATE_ID, template.address, initSelector);
  const receipt = await tx.wait();
  console.log(
    `[dpnm-v2-template] registered template id=${TEMPLATE_ID} ` +
      `(label="${TEMPLATE_ID_LABEL}") tx=${receipt?.hash}`,
  );

  // ----- 5. Persist artefact --------------------------------------------
  const out = {
    chain: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    factory: factoryAddr,
    template: {
      id: TEMPLATE_ID,
      label: TEMPLATE_ID_LABEL,
      implementation: template.address,
      initSelector,
    },
    subImpls: {
      DPNMToken:     dpnmToken.address,
      DPNMGrowToken: gwt.address,
      DPNMTree:      tree.address,
      BuybackPools:  buyback.address,
      Whitelist:     whitelist.address,
      DPNMProtocol:  protocol.address,
    },
    registeredAt: new Date().toISOString(),
    todo: [
      "Surface the 6 sub-impls in agentflow-api so wizard launches can pass them as `impls`.",
      "Once a tenant launches, store its template-clone address as the canonical instance.",
      "Verify all 7 contracts on BscScan via `npx hardhat verify --network bsc_testnet <addr>`.",
      "Optional: pause the legacy `dpnm` template id when `dpnm-v2` is the new default.",
    ],
  };

  const outPath =
    process.env.DEPLOY_LOG_PATH ??
    path.join(
      process.cwd(),
      `deployment-dpnm-v2-template-${
        network.name === "bsc_testnet" ? "bsc-testnet" : network.name
      }.json`,
    );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[dpnm-v2-template] wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
