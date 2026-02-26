import { ethers, upgrades } from "hardhat";

(async () => {
  try {
    const args = [process.env.BRIDGED_TOKEN, 104];
    const Contract = await ethers.getContractFactory("veVirtual");
    const contract = await upgrades.deployProxy(Contract, args, {
      initialOwner: process.env.CONTRACT_CONTROLLER,
    });
    await contract.waitForDeployment();
    console.log("veVirtual deployed to:", contract.target);

    // Note: initialOwner only sets ProxyAdmin owner, not AccessControl roles
    // We need to manually grant roles to CONTRACT_CONTROLLER and ADMIN
    const CONTRACT_CONTROLLER = process.env.CONTRACT_CONTROLLER;
    const ADMIN = process.env.ADMIN;
    
    const DEFAULT_ADMIN_ROLE = await contract.DEFAULT_ADMIN_ROLE();
    const ADMIN_ROLE = await contract.ADMIN_ROLE();

    if (CONTRACT_CONTROLLER) {
      // Grant DEFAULT_ADMIN_ROLE to CONTRACT_CONTROLLER
      const tx1 = await contract.grantRole(DEFAULT_ADMIN_ROLE, CONTRACT_CONTROLLER);
      await tx1.wait();
      console.log("Granted DEFAULT_ADMIN_ROLE to CONTRACT_CONTROLLER:", CONTRACT_CONTROLLER);

      // Grant ADMIN_ROLE to CONTRACT_CONTROLLER
      const tx2 = await contract.grantRole(ADMIN_ROLE, CONTRACT_CONTROLLER);
      await tx2.wait();
      console.log("Granted ADMIN_ROLE to CONTRACT_CONTROLLER:", CONTRACT_CONTROLLER);
    }

    if (ADMIN) {
      // Grant DEFAULT_ADMIN_ROLE to ADMIN
      const tx3 = await contract.grantRole(DEFAULT_ADMIN_ROLE, ADMIN);
      await tx3.wait();
      console.log("Granted DEFAULT_ADMIN_ROLE to ADMIN:", ADMIN);

      // Grant ADMIN_ROLE to ADMIN
      const tx4 = await contract.grantRole(ADMIN_ROLE, ADMIN);
      await tx4.wait();
      console.log("Granted ADMIN_ROLE to ADMIN:", ADMIN);
    }
  } catch (e) {
    console.log(e);
  }
})();
