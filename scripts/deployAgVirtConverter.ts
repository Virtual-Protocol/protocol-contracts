import { ethers, upgrades } from "hardhat";

// Deploys AgVirtConverter as a UUPS proxy.
// Env: VIRTUAL_TOKEN_ADDRESS, AGVIRT_TOKEN_ADDRESS, AGVIRT_TREASURY_ADDRESS
(async () => {
  try {
    const virtualToken = process.env.VIRTUAL_TOKEN_ADDRESS;
    const agVirtToken = process.env.AGVIRT_TOKEN_ADDRESS;
    const treasury = process.env.AGVIRT_TREASURY_ADDRESS;
    if (!virtualToken || !agVirtToken || !treasury) {
      throw new Error(
        "Set VIRTUAL_TOKEN_ADDRESS, AGVIRT_TOKEN_ADDRESS and AGVIRT_TREASURY_ADDRESS"
      );
    }
    const Contract = await ethers.getContractFactory("AgVirtConverter");
    const contract = await upgrades.deployProxy(
      Contract,
      [virtualToken, agVirtToken, treasury],
      { kind: "uups" }
    );
    await contract.waitForDeployment();
    console.log("AgVirtConverter proxy deployed to:", contract.target);
  } catch (e) {
    console.log(e);
  }
})();
