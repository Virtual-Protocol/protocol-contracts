import { ethers } from "hardhat";

// Wires an existing veVirtual to the AgVirtConverter.
// Env: VEVIRTUAL_ADDRESS, AGVIRT_CONVERTER_ADDRESS (caller must be veVirtual's admin)
(async () => {
  try {
    const ve = await ethers.getContractAt(
      "veVirtual",
      process.env.VEVIRTUAL_ADDRESS as string
    );
    const tx = await ve.setAgVirtConverter(
      process.env.AGVIRT_CONVERTER_ADDRESS as string
    );
    await tx.wait();
    console.log("setAgVirtConverter done, tx:", tx.hash);
  } catch (e) {
    console.log(e);
  }
})();
