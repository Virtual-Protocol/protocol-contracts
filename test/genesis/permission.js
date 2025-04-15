const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { setupTest } = require("./setup");

describe("Genesis Permission Tests", function () {
  let virtualToken;
  let agentToken;
  let fGenesis;
  let genesis;
  let owner;
  let admin;
  let beOpsWallet;
  let user1;
  let user2;
  let DEFAULT_ADMIN_ROLE;
  let ADMIN_ROLE;
  let FACTORY_ROLE;
  let params;
  let agentFactory;

  beforeEach(async function () {
    const setup = await setupTest();
    ({
      virtualToken,
      agentToken,
      fGenesis,
      genesis,
      owner,
      admin,
      beOpsWallet,
      user1,
      user2,
      DEFAULT_ADMIN_ROLE,
      ADMIN_ROLE,
      FACTORY_ROLE,
      params,
      agentFactory,
    } = setup);
  });

  describe("FGenesis Role Management", function () {
    it("Should set and verify correct initial roles", async function () {
      // Check initial role setup
      expect(await fGenesis.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be
        .true;
      expect(await fGenesis.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be
        .true;
      expect(await fGenesis.hasRole(ADMIN_ROLE, beOpsWallet.address)).to.be
        .true;
    });

    it("Should allow DEFAULT_ADMIN_ROLE to manage roles", async function () {
      // Grant role
      await expect(fGenesis.connect(admin).grantRole(ADMIN_ROLE, user1.address))
        .to.not.be.reverted;
      expect(await fGenesis.hasRole(ADMIN_ROLE, user1.address)).to.be.true;

      // Revoke role
      await fGenesis.connect(admin).revokeRole(ADMIN_ROLE, user1.address);
      expect(await fGenesis.hasRole(ADMIN_ROLE, user1.address)).to.be.false;
    });

    it("Should not allow non-DEFAULT_ADMIN_ROLE to manage roles", async function () {
      await expect(
        fGenesis.connect(user1).grantRole(ADMIN_ROLE, user2.address)
      ).to.be.revertedWithCustomError(
        fGenesis,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("Genesis Creation and Management", function () {
    it("Should allow ADMIN_ROLE to create Genesis", async function () {
      // First transfer and approve tokens for beOpsWallet
      await virtualToken.transfer(
        beOpsWallet.address,
        ethers.parseEther("100")
      );
      await virtualToken
        .connect(beOpsWallet)
        .approve(await fGenesis.getAddress(), ethers.parseEther("100"));

      const currentTime = await time.latest();
      const newGenesisParams = {
        startTime: currentTime + 3600,
        endTime: currentTime + 86400,
        genesisName: "Test2",
        genesisTicker: "TEST2",
        genesisCores: [1, 2, 3],
        genesisDesc: "Desc",
        genesisImg: "img",
        genesisUrls: ["url1", "url2", "url3", "url4"],
      };

      await expect(
        fGenesis.connect(beOpsWallet).createGenesis(newGenesisParams)
      ).to.not.be.reverted;
    });

    it("Should also allow non-ADMIN_ROLE to create Genesis", async function () {
      // First transfer and approve tokens for user1
      await virtualToken.transfer(user1.address, ethers.parseEther("100"));
      await virtualToken
        .connect(user1)
        .approve(await fGenesis.getAddress(), ethers.parseEther("100"));
      const currentTime = await time.latest();
      const newGenesisParams = {
        startTime: currentTime + 3600,
        endTime: currentTime + 86400,
        genesisName: "Test2",
        genesisTicker: "TEST2",
        genesisCores: [1, 2, 3],
        genesisDesc: "Desc",
        genesisImg: "img",
        genesisUrls: ["url1", "url2", "url3", "url4"],
      };

      await expect(fGenesis.connect(user1).createGenesis(newGenesisParams)).to
        .not.be.reverted;
    });
  });

  describe("Genesis Contract Roles and Operations", function () {
    beforeEach(async function () {
      // Transfer sufficient tokens to user1 for participation
      await virtualToken.transfer(user1.address, ethers.parseEther("100"));
      await virtualToken
        .connect(user1)
        .approve(await genesis.getAddress(), ethers.parseEther("100"));

      // Transfer sufficient tokens to Genesis contract for refunds
      await virtualToken.transfer(
        await genesis.getAddress(),
        ethers.parseEther("200") // Ensure enough balance for refunds
      );

      // Participate in Genesis
      await time.increase(3600); // Ensure Genesis has started
      await genesis
        .connect(user1)
        .participate(1, ethers.parseEther("50"), user1.address);
    });

    it("Should verify correct Genesis contract roles", async function () {
      // Check roles on Genesis contract
      expect(
        await genesis.hasRole(DEFAULT_ADMIN_ROLE, await fGenesis.getAddress())
      ).to.be.true;
      expect(await genesis.hasRole(FACTORY_ROLE, await fGenesis.getAddress()))
        .to.be.true;
    });

    it("Should handle Genesis success correctly", async function () {
      try {
        const endTime = await genesis.endTime();
        await time.increaseTo(endTime);

        // Get reserve amount from params
        const params = await fGenesis.params();
        const reserveAmount = params.reserve;

        console.log("\n=== Genesis Success Test Details ===");
        console.log("Contract Addresses:");
        console.log("- FGenesis:", await fGenesis.getAddress());
        console.log("- Genesis:", await genesis.getAddress());
        console.log("- VirtualToken:", await virtualToken.getAddress());

        // Print initial balances
        console.log("\nInitial Balances:");
        const genesisBalance = await virtualToken.balanceOf(
          await genesis.getAddress()
        );
        const user1Balance = await virtualToken.balanceOf(user1.address);
        console.log("- Genesis contract balance:", genesisBalance.toString());
        console.log("- User1 balance:", user1.Balance);
        console.log("- Required reserve amount:", reserveAmount.toString());

        // Print participation info
        console.log("\nParticipation Info:");
        const userVirtuals = await genesis.mapAddrToVirtuals(user1.address);
        console.log("- User1 virtuals contributed:", userVirtuals.toString());

        // Calculate and transfer required tokens
        const refundAmount = ethers.parseEther("1");
        const totalRequired = BigInt(reserveAmount) + BigInt(refundAmount);
        console.log("\nToken Requirements:");
        console.log("- Refund amount:", refundAmount.toString());
        console.log(
          "- Total required (reserve + refund):",
          totalRequired.toString()
        );

        // Transfer additional tokens if needed
        if (genesisBalance < totalRequired) {
          const additionalAmount = totalRequired - genesisBalance;
          console.log("\nTransferring Additional Tokens:");
          console.log("- Amount to transfer:", additionalAmount.toString());
          await virtualToken.transfer(
            await genesis.getAddress(),
            additionalAmount
          );
        }

        // Verify final balance
        const finalBalance = await virtualToken.balanceOf(
          await genesis.getAddress()
        );
        console.log("\nFinal State:");
        console.log("- Genesis final balance:", finalBalance.toString());

        // Check roles
        console.log("\nRole Verification:");
        console.log(
          "- beOpsWallet has ADMIN_ROLE:",
          await fGenesis.hasRole(ADMIN_ROLE, beOpsWallet.address)
        );
        console.log(
          "- fGenesis has FACTORY_ROLE:",
          await genesis.hasRole(FACTORY_ROLE, await fGenesis.getAddress())
        );

        // Prepare success parameters
        const successParams = {
          refundAddresses: [user1.address],
          refundAmounts: [refundAmount],
          distributeAddresses: [user1.address],
          distributeAmounts: [ethers.parseEther("1")],
          creator: owner.address,
        };

        console.log("\nSuccess Parameters:");
        console.log(successParams);

        await agentToken.transfer(
          genesis.getAddress(),
          ethers.parseEther("1000000000000000000")
        );

        // Call onGenesisSuccess
        console.log("\nCalling onGenesisSuccess...");
        const tx = await fGenesis
          .connect(beOpsWallet)
          .onGenesisSuccess(1, successParams);
        console.log("Transaction sent:", tx.hash);

        const receipt = await tx.wait();
        console.log("Transaction confirmed:", receipt.hash);
        // Verify event emission
        await expect(
          fGenesis.connect(beOpsWallet).onGenesisSuccess(1, successParams)
        )
          .to.emit(genesis, "GenesisSucceeded")
          .withArgs(1);
      } catch (error) {
        console.error("\n=== Test Failed ===");
        console.error("Error message:", error.message);
        if (error.data) {
          console.error("Error data:", error.data);
        }
        if (error.transaction) {
          console.error("Failed transaction:", error.transaction);
        }
        throw error;
      }
    });

    it("Should handle Genesis failure correctly", async function () {
      await genesis
        .connect(user1)
        .participate(
          ethers.parseEther("1"),
          ethers.parseEther("2"),
          user1.address
        );

      // Wait for end time
      const endTime = await genesis.endTime();
      await time.increaseTo(endTime);

      await expect(fGenesis.connect(beOpsWallet).onGenesisFailed(1, [0]))
        .to.emit(genesis, "GenesisFailed")
        .withArgs(1);

      // verify the state
      expect(await genesis.isFailed()).to.be.true;
      expect(await genesis.refundUserCountForFailed()).to.equal(1);
      expect(await genesis.mapAddrToVirtuals(user1.address)).to.equal(0);
    });
  });

  describe("Parameter Management", function () {
    it("Should allow admin to update parameters", async function () {
      const newParams = {
        ...params,
        feeAddr: user1.address,
      };

      await expect(fGenesis.connect(admin).setParams(newParams)).to.not.be
        .reverted;

      const updatedParams = await fGenesis.params();
      expect(updatedParams.feeAddr).to.equal(user1.address);
    });

    it("Should not allow non-admin to update parameters", async function () {
      await expect(
        fGenesis.connect(user1).setParams(params)
      ).to.be.revertedWithCustomError(
        fGenesis,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("FGenesis Permission Tests", function () {
    it("Should only allow ADMIN_ROLE to call onGenesisSuccess", async function () {
      await expect(
        fGenesis.connect(user1).onGenesisSuccess(1, {
          refundAddresses: [],
          refundAmounts: [],
          distributeAddresses: [],
          distributeAmounts: [],
          creator: owner.address,
        })
      ).to.be.revertedWithCustomError(
        fGenesis,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should allow ADMIN_ROLE to call onGenesisSuccess", async function () {
      await time.increaseTo(await genesis.endTime());

      await expect(
        fGenesis.connect(beOpsWallet).onGenesisSuccess(1, {
          refundAddresses: [],
          refundAmounts: [],
          distributeAddresses: [],
          distributeAmounts: [],
          creator: owner.address,
        })
      ).to.be.revertedWith("Insufficient Virtual Token balance");
    });
  });

  describe("Genesis Permission Tests", function () {
    it("Should only allow FACTORY_ROLE to call onGenesisSuccess", async function () {
      await expect(
        genesis.connect(user1).onGenesisSuccess(
          [], // refundAddresses
          [], // refundAmounts
          [], // distributeAddresses
          [], // distributeAmounts
          owner.address // creator
        )
      ).to.be.revertedWithCustomError(
        genesis,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  it("Should allow withdrawal of assets after finalization", async function () {
    await fGenesis.connect(beOpsWallet).cancelGenesis(1);

    // Wait for end time
    const endTime = await genesis.endTime();
    await time.increaseTo(endTime);

    // Transfer 100 tokens to genesis
    await virtualToken.transfer(
      await genesis.getAddress(),
      ethers.parseEther("100")
    );

    // Try to withdraw funds
    const initialBalance = await virtualToken.balanceOf(user1.address);
    await expect(
      fGenesis
        .connect(beOpsWallet)
        .withdrawLeftAssetsAfterFinalized(
          1,
          user1.address,
          await virtualToken.getAddress()
        )
    )
      .to.emit(genesis, "AssetsWithdrawn")
      .withArgs(
        1,
        user1.address,
        await virtualToken.getAddress(),
        ethers.parseEther("100")
      );

    const finalBalance = await virtualToken.balanceOf(user1.address);
    expect(finalBalance).to.be.gt(initialBalance);
  });
});
