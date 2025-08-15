const { ethers, upgrades } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { setupTest } = require("./setup");
const {
  ERR_NOT_STARTED,
  ERR_ALREADY_STARTED,
  ERR_NOT_ENDED,
  ERR_ALREADY_ENDED,
  ERR_ALREADY_FAILED,
  ERR_ALREADY_CANCELLED,
  ERR_START_TIME_FUTURE,
  ERR_END_AFTER_START,
  ERR_TOKEN_LAUNCHED,
  ERR_TOKEN_NOT_LAUNCHED,
} = require("./const");

describe("Genesis Business Logic Tests", function () {
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
  let OPERATION_ROLE;
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
      OPERATION_ROLE,
      FACTORY_ROLE,
      params,
      agentFactory,
    } = setup);

    // Get 5 participant accounts
    participants = (await ethers.getSigners()).slice(5, 10);

    // Transfer 100 tokens to each participant and approve
    for (const participant of participants) {
      await virtualToken.transfer(
        participant.address,
        ethers.parseEther("1000")
      );
      await virtualToken
        .connect(participant)
        .approve(await genesis.getAddress(), ethers.parseEther("1000"));
    }

    maxContribution = await genesis.maxContributionVirtualAmount();
  });

  describe("Genesis Business Logic Tests", function () {
    it("Should return correct Genesis information", async function () {
      const genesisInfo = await genesis.getGenesisInfo();
      expect(genesisInfo.genesisId).to.equal(1);
      expect(genesisInfo.genesisName).to.equal("Test Genesis");
      expect(genesisInfo.genesisTicker).to.equal("TEST");
      expect(genesisInfo.virtualTokenAddress).to.equal(
        await virtualToken.getAddress()
      );
    });

    it("Should handle multiple participants with different contribution amounts", async function () {
      await time.increase(3600); // Ensure Genesis has started

      // edit the contribution amount, ensure it does not exceed the max limit
      const contributions = [2, 3, 1, 2, 1].map((x) =>
        ethers.parseEther(x.toString())
      );

      console.log("\n=== Participation Phase ===");
      for (let i = 0; i < participants.length; i++) {
        await genesis
          .connect(participants[i])
          .participate(ethers.parseEther("1"), contributions[i]);

        console.log(
          `Participant ${i + 1} contributed:`,
          ethers.formatEther(contributions[i])
        );

        // Verify participation record
        const participated = await genesis.mapAddrToVirtuals(
          participants[i].address
        );
        expect(participated).to.equal(contributions[i]);
      }

      // Verify participant information
      const participantCount = await genesis.getParticipantCount();
      expect(participantCount).to.equal(5);

      const participantsInfo = await genesis.getParticipantsInfo([
        0, 1, 2, 3, 4,
      ]);
      console.log("\nParticipants Information:");
      participantsInfo.forEach((info, index) => {
        console.log(`Participant ${index + 1}:`, {
          address: info.userAddress,
          virtuals: ethers.formatEther(info.virtuals),
        });
      });

      // Test pagination of participants
      const pageSize = 2;
      const page1 = await genesis.getParticipantsPaginated(0, pageSize);
      expect(page1.length).to.equal(pageSize);
      expect(page1[0]).to.equal(participants[0].address);
    });

    it("Should handle Genesis failure with full refunds", async function () {
      await time.increase(3600);

      // Modify contribution amounts
      const contributions = [2, 3, 1, 2, 1].map((x) =>
        ethers.parseEther(x.toString())
      );
      const initialBalances = await Promise.all(
        participants.map((p) => virtualToken.balanceOf(p.address))
      );

      for (let i = 0; i < participants.length; i++) {
        await genesis
          .connect(participants[i])
          .participate(ethers.parseEther("1"), contributions[i]);
      }

      // Wait for end time
      const endTime = await genesis.endTime();
      await time.increaseTo(endTime);

      // Execute failure flow with participant indexes
      const participantIndexes = Array.from(
        { length: participants.length },
        (_, i) => i
      );

      // first call, handle the first 3 participants
      await fGenesis.connect(beOpsWallet).onGenesisFailed(1, [0, 1, 2]);

      // verify the refund status of the first 3 participants
      for (let i = 0; i < 3; i++) {
        expect(
          await genesis.mapAddrToVirtuals(participants[i].address)
        ).to.equal(0);
        expect(await virtualToken.balanceOf(participants[i].address)).to.equal(
          initialBalances[i]
        );
      }

      // verify the Genesis is not marked as failed
      expect(await genesis.isFailed()).to.be.false;
      expect(await genesis.refundUserCountForFailed()).to.equal(3);

      // second call, handle the remaining participants
      await expect(fGenesis.connect(beOpsWallet).onGenesisFailed(1, [3, 4]))
        .to.emit(genesis, "GenesisFailed")
        .withArgs(1);

      // verify the final state of all participants
      const finalBalances = await Promise.all(
        participants.map((p) => virtualToken.balanceOf(p.address))
      );

      console.log("\n=== Genesis Failure Refund Details ===");
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        console.log(`Participant ${i + 1}:`, {
          initial: ethers.formatEther(initialBalances[i]),
          final: ethers.formatEther(finalBalances[i]),
          refunded: ethers.formatEther(finalBalances[i] - initialBalances[i]),
        });
        // Verify full refund
        expect(finalBalances[i]).to.equal(initialBalances[i]);
        expect(await genesis.mapAddrToVirtuals(p.address)).to.equal(0);
      }

      // Verify final contract state
      expect(await genesis.isFailed()).to.be.true;
      expect(await genesis.refundUserCountForFailed()).to.equal(5);
      expect(await genesis.agentTokenAddress()).to.equal(ethers.ZeroAddress);
    });

    it("Should handle Genesis failure with invalid participant indexes", async function () {
      await time.increase(3600);

      // let some participants participate
      await genesis
        .connect(participants[0])
        .participate(ethers.parseEther("1"), ethers.parseEther("2"));
      await genesis
        .connect(participants[1])
        .participate(ethers.parseEther("1"), ethers.parseEther("3"));

      // Wait for end time
      const endTime = await genesis.endTime();
      await time.increaseTo(endTime);

      // test invalid participant index, total participants is 2, index 2 is out of bounds`
      await expect(
        fGenesis.connect(beOpsWallet).onGenesisFailed(1, [2])
      ).to.be.revertedWith("Index out of bounds");

      await fGenesis.connect(beOpsWallet).onGenesisFailed(1, [0]);
      expect(await genesis.refundUserCountForFailed()).to.equal(1);
      // test repeat handle the same participant
      await fGenesis.connect(beOpsWallet).onGenesisFailed(1, [0]);
      // should not increase the refund user count for failed
      expect(await genesis.refundUserCountForFailed()).to.equal(1);

      await fGenesis.connect(beOpsWallet).onGenesisFailed(1, [1]);
      expect(await genesis.refundUserCountForFailed()).to.equal(2);
      expect(await genesis.isFailed()).to.be.true;
      expect(await genesis.agentTokenAddress()).to.equal(ethers.ZeroAddress);
    });

    it("Should handle onGenesisSuccess and withdrawLeftAssetsAfterFinalized well after onGenesisFailed called", async function () {
      await time.increase(3600);

      // let some participants participate
      await genesis
        .connect(participants[0])
        .participate(ethers.parseEther("1"), ethers.parseEther("2"));
      await genesis
        .connect(participants[1])
        .participate(ethers.parseEther("1"), ethers.parseEther("3"));

      // test call withdrawLeftAssetsAfterFinalized before onGenesisFailed called
      await expect(
        fGenesis
          .connect(admin)
          .withdrawLeftAssetsAfterFinalized(
            1,
            participants[0].address,
            await virtualToken.getAddress(),
            ethers.parseEther("5")
          )
      ).to.be.revertedWith(ERR_NOT_ENDED);

      // Wait for end time
      const endTime = await genesis.endTime();
      await time.increaseTo(endTime);

      // test can call withdrawLeftAssetsAfterFinalized but Insufficient balance to withdraw
      await expect(
        fGenesis
          .connect(admin)
          .withdrawLeftAssetsAfterFinalized(
            1,
            participants[0].address,
            await virtualToken.getAddress(),
            ethers.parseEther("100")
          )
      ).to.be.revertedWith("Insufficient balance to withdraw");
    });

    it("Should enforce contribution limits and timing restrictions", async function () {
      const amount = ethers.parseEther("10");

      // Cannot participate before start
      await expect(
        genesis
          .connect(participants[0])
          .participate(ethers.parseEther("1"), amount)
      ).to.be.revertedWith(ERR_NOT_STARTED);

      // Can participate after start
      await time.increase(3600);
      await expect(
        genesis
          .connect(participants[0])
          .participate(ethers.parseEther("1"), amount)
      ).to.not.be.reverted;

      // Cannot exceed max contribution
      await expect(
        genesis
          .connect(participants[1])
          .participate(ethers.parseEther("1"), maxContribution + 1n)
      ).to.be.revertedWith("Exceeds maximum virtuals per contribution");

      // Cannot participate after end
      await time.increaseTo(await genesis.endTime());
      await expect(
        genesis
          .connect(participants[2])
          .participate(ethers.parseEther("1"), amount)
      ).to.be.revertedWith(ERR_ALREADY_ENDED);
    });
  });

  describe("onGenesisSuccess", function () {
    it("Should revert if Genesis has not ended", async function () {
      await expect(
        fGenesis.connect(beOpsWallet).onGenesisSuccessSalt(
          1,
          {
            refundAddresses: [],
            refundAmounts: [],
            distributeAddresses: [],
            distributeAmounts: [],
            creator: owner.address,
          },
          ethers.id("test-salt")
        )
      ).to.be.revertedWith(ERR_NOT_ENDED);
    });

    it("Should revert if insufficient Virtual Token balance", async function () {
      // Wait for Genesis to end
      await time.increaseTo(await genesis.endTime());

      await expect(
        fGenesis.connect(beOpsWallet).onGenesisSuccessSalt(
          1,
          {
            refundAddresses: [participants[0].address],
            refundAmounts: [ethers.parseEther("1000")],
            distributeAddresses: [],
            distributeAmounts: [],
            creator: owner.address,
          },
          ethers.id("test-salt")
        )
      ).to.be.revertedWith("Insufficient Virtual Token committed");
    });

    it("Should handle successful Genesis completion with token distribution", async function () {
      await time.increase(3600);

      // edit the contribution amount, ensure it does not exceed the max limit
      const contributions = [2, 3, 1, 2, 1].map((x) =>
        ethers.parseEther(x.toString())
      );
      // Record initial balances
      let initialBalances = await Promise.all(
        participants.map((p) => virtualToken.balanceOf(p.address))
      );
      console.log(
        "Participants Initial Balances:",
        initialBalances.map((b) => ethers.formatEther(b))
      );

      for (let i = 0; i < participants.length; i++) {
        await genesis.connect(participants[i]).participate(1, contributions[i]);
        const genesisVirtualTokenBalance = await virtualToken.balanceOf(
          await genesis.getAddress()
        );
        console.log(
          "After participate idx: " + i + ", Genesis Virtual Token Balance ",
          ethers.formatEther(genesisVirtualTokenBalance)
        );
      }
      initialBalances = await Promise.all(
        participants.map((p) => virtualToken.balanceOf(p.address))
      );
      console.log(
        "Participants Balances after participate:",
        initialBalances.map((b) => ethers.formatEther(b))
      );

      // Ensure contract has enough reserve
      const reserveAmount = (await fGenesis.params()).reserve;
      await virtualToken.transfer(await genesis.getAddress(), reserveAmount);

      // Wait for end time
      const endTime = await genesis.endTime();
      await time.increaseTo(endTime);

      console.log("\n=== Genesis Success Scenario ===");

      // Prepare success parameters
      const successParams = {
        refundAddresses: participants.map((p) => p.address),
        refundAmounts: contributions.map((c) => c / 2n), // Use BigInt division
        distributeAddresses: participants.map((p) => p.address),
        distributeAmounts: contributions.map((c) => c / 2n),
        creator: owner.address,
      };
      console.log("Success Params:", successParams);

      await agentToken.transfer(
        await genesis.getAddress(),
        initialBalances.reduce((sum, b) => {
          const amount = Number(ethers.formatEther(b));
          return sum + ethers.parseEther((amount / 2).toString());
        }, 0n)
      );

      // Get Genesis balance of virtual token
      const genesisVirtualTokenBalance = await virtualToken.balanceOf(
        await genesis.getAddress()
      );
      console.log(
        "Genesis Virtual Token Balance:",
        ethers.formatEther(genesisVirtualTokenBalance)
      );

      // Execute success flow
      await fGenesis
        .connect(beOpsWallet)
        .onGenesisSuccessSalt(1, successParams, ethers.id("test-salt"));

      // Verify final state
      const finalBalances = await Promise.all(
        participants.map((p) => virtualToken.balanceOf(p.address))
      );
      console.log(
        "Final Balances:",
        finalBalances.map((b) => ethers.formatEther(b))
      );

      // Verify Genesis state
      const genesisInfo = await genesis.getGenesisInfo();
      expect(genesisInfo.agentTokenAddress).to.not.equal(
        ethers.ZeroAddress,
        "Agent token should be created"
      );
    });

    it("Should Insufficient Virtual Token balance for refund Virtual Token", async function () {
      await time.increase(3600);

      // edit the contribution amount, ensure it does not exceed the max limit
      const contributions = [344, 566].map((x) =>
        ethers.parseEther(x.toString())
      );
      // Record initial balances
      let initialBalances = await Promise.all(
        participants.map((p) => virtualToken.balanceOf(p.address))
      );
      console.log(
        "Participants Initial Balances:",
        initialBalances.map((b) => ethers.formatEther(b))
      );

      for (let i = 0; i < 2; i++) {
        await genesis.connect(participants[i]).participate(1, contributions[i]);
        const genesisVirtualTokenBalance = await virtualToken.balanceOf(
          await genesis.getAddress()
        );
        console.log(
          "After participate idx: " + i + ", Genesis Virtual Token Balance ",
          ethers.formatEther(genesisVirtualTokenBalance)
        );
      }
      initialBalances = await Promise.all(
        participants.map((p) => virtualToken.balanceOf(p.address))
      );
      console.log(
        "Participants Balances after participate:",
        initialBalances.map((b) => ethers.formatEther(b))
      );

      // Wait for end time
      const endTime = await genesis.endTime();
      await time.increaseTo(endTime);

      console.log("\n=== Genesis Success Scenario ===");

      // Prepare success parameters
      const successParams = {
        refundAddresses: participants.slice(0, 2).map((p) => p.address),
        refundAmounts: [282.6666666666667, 202.3333333334].map((x) =>
          ethers.parseEther(x.toString())
        ), // Use BigInt division
        distributeAddresses: participants.slice(0, 2).map((p) => p.address),
        distributeAmounts: contributions.map((c) => c / 2n),
        creator: owner.address,
      };
      console.log("Success Params:", successParams);

      await agentToken.transfer(
        await genesis.getAddress(),
        initialBalances.reduce((sum, b) => {
          const amount = Number(ethers.formatEther(b));
          return sum + ethers.parseEther((amount / 2).toString());
        }, 0n)
      );

      // Get Genesis balance of virtual token
      let genesisVirtualTokenBalance = await virtualToken.balanceOf(
        await genesis.getAddress()
      );
      console.log(
        "Genesis Virtual Token Balance:",
        ethers.formatEther(genesisVirtualTokenBalance)
      );

      // Simulate reserve consumption: transfer 425 virtual tokens out from Genesis before success flow
      await fGenesis
        .connect(admin)
        .withdrawLeftAssetsAfterFinalized(
          1,
          owner.address,
          await virtualToken.getAddress(),
          ethers.parseEther("425")
        );
      genesisVirtualTokenBalance = await virtualToken.balanceOf(
        await genesis.getAddress()
      );
      console.log(
        "Genesis Virtual Token Balance after simulated reserve transfer:",
        ethers.formatEther(genesisVirtualTokenBalance)
      );

      // Execute success flow and expect it to revert
      await expect(
        fGenesis
          .connect(beOpsWallet)
          .onGenesisSuccessSalt(1, successParams, ethers.id("test-salt"))
      ).to.be.revertedWithCustomError(virtualToken, "ERC20InsufficientBalance");

      // Verify final state
      const finalBalances = await Promise.all(
        participants.map((p) => virtualToken.balanceOf(p.address))
      );
      console.log(
        "Final Balances of participants:",
        finalBalances.map((b) => ethers.formatEther(b))
      );
      genesisVirtualTokenBalance = await virtualToken.balanceOf(
        await genesis.getAddress()
      );
      console.log(
        "Final Balances of Genesis:",
        ethers.formatEther(genesisVirtualTokenBalance)
      );

      // Verify Genesis state
      const genesisInfo = await genesis.getGenesisInfo();
      expect(genesisInfo.agentTokenAddress).to.equal(
        ethers.ZeroAddress,
        "Agent token should not be created"
      );
    });
  });

  describe("Genesis Time Management and Cancellation Tests", function () {
    it("Should allow withdrawal of funds after cancellation", async function () {
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
          .connect(admin)
          .withdrawLeftAssetsAfterFinalized(
            1,
            user1.address,
            await virtualToken.getAddress(),
            ethers.parseEther("100")
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

    it("Should successfully reset time before Genesis starts", async function () {
      const newStartTime = (await time.latest()) + 7200;
      const newEndTime = newStartTime + 3600;
      const oldStartTime = await genesis.startTime();
      const oldEndTime = await genesis.endTime();

      await expect(
        fGenesis.connect(beOpsWallet).resetTime(1, newStartTime, newEndTime)
      )
        .to.emit(genesis, "TimeReset")
        .withArgs(oldStartTime, oldEndTime, newStartTime, newEndTime);

      const genesisInfo = await genesis.getGenesisInfo();
      expect(genesisInfo.startTime).to.equal(newStartTime);
      expect(genesisInfo.endTime).to.equal(newEndTime);
    });

    it("Should revert when resetting time with invalid parameters", async function () {
      const currentTime = await time.latest();

      // Test: End time before start time
      await expect(
        fGenesis
          .connect(beOpsWallet)
          .resetTime(1, currentTime + 3600, currentTime + 1800)
      ).to.be.revertedWith("End time must be after start time");

      // Test: Start time in the past
      await expect(
        fGenesis
          .connect(beOpsWallet)
          .resetTime(1, currentTime - 3600, currentTime + 3600)
      ).to.be.revertedWith("Start time must be in the future");
    });

    it("Should revert when resetting time after Genesis has started", async function () {
      await time.increase(3600); // Move past start time

      const newStartTime = (await time.latest()) + 3600;
      const newEndTime = newStartTime + 3600;

      await expect(
        fGenesis.connect(beOpsWallet).resetTime(1, newStartTime, newEndTime)
      ).to.be.revertedWith(ERR_ALREADY_STARTED);
    });

    it("Should successfully cancel Genesis before it starts", async function () {
      await expect(fGenesis.connect(beOpsWallet).cancelGenesis(1))
        .to.emit(genesis, "GenesisCancelled")
        .withArgs(1);

      const genesisInfo = await genesis.getGenesisInfo();
      expect(genesisInfo.isCancelled).to.be.true;
    });

    it("Should revert when trying to participate in cancelled Genesis", async function () {
      await fGenesis.connect(beOpsWallet).cancelGenesis(1);

      // Wait for start time
      const startTime = await genesis.startTime();
      await time.increaseTo(startTime);

      await expect(
        genesis
          .connect(participants[0])
          .participate(ethers.parseEther("1"), ethers.parseEther("10"))
      ).to.be.revertedWith(ERR_ALREADY_CANCELLED);
    });

    it("Should revert when trying to cancel Genesis after it has started", async function () {
      await time.increase(3600); // Move past start time

      await expect(
        fGenesis.connect(beOpsWallet).cancelGenesis(1)
      ).to.be.revertedWith(ERR_ALREADY_STARTED);
    });

    it("Should revert when trying to cancel already cancelled Genesis", async function () {
      await fGenesis.connect(beOpsWallet).cancelGenesis(1);

      await expect(
        fGenesis.connect(beOpsWallet).cancelGenesis(1)
      ).to.be.revertedWith(ERR_ALREADY_CANCELLED);
    });

    it("Should handle multiple state changes correctly", async function () {
      // First reset time
      const newStartTime = (await time.latest()) + 7200;
      const newEndTime = newStartTime + 3600;
      await fGenesis
        .connect(beOpsWallet)
        .resetTime(1, newStartTime, newEndTime);

      // Then cancel
      await fGenesis.connect(beOpsWallet).cancelGenesis(1);

      // Verify final state
      const genesisInfo = await genesis.getGenesisInfo();
      expect(genesisInfo.startTime).to.equal(newStartTime);
      expect(genesisInfo.endTime).to.equal(newEndTime);
      expect(genesisInfo.isCancelled).to.be.true;

      // Wait for start time
      const startTime = await genesis.startTime();
      await time.increaseTo(startTime);

      // Verify cannot participate
      await expect(
        genesis
          .connect(participants[0])
          .participate(ethers.parseEther("1"), ethers.parseEther("10"))
      ).to.be.revertedWith(ERR_ALREADY_CANCELLED);
    });

    it("Should prevent onGenesisSuccess for cancelled Genesis", async function () {
      await fGenesis.connect(beOpsWallet).cancelGenesis(1);

      await expect(
        fGenesis.connect(beOpsWallet).onGenesisSuccessSalt(
          1,
          {
            refundAddresses: [],
            refundAmounts: [],
            distributeAddresses: [],
            distributeAmounts: [],
            creator: owner.address,
          },
          ethers.id("test-salt")
        )
      ).to.be.revertedWith(ERR_ALREADY_CANCELLED);
    });
  });

  describe("setParamsForGenesis", function () {
    it("Should successfully update params before token launch", async function () {
      const oldReserve = await genesis.reserveAmount();
      const oldLp = await genesis.agentTokenLpSupply();
      const totalSupply = await genesis.agentTokenTotalSupply();

      const newReserve = oldReserve + 1n;
      let newLp = totalSupply - 1n;
      if (newLp === oldLp) {
        newLp = totalSupply > 2n ? totalSupply - 2n : 1n;
      }
      if (newLp <= 0n) newLp = 1n;
      if (newLp > totalSupply) newLp = totalSupply;

      await expect(
        fGenesis.connect(beOpsWallet).setParamsForGenesis(1, {
          reserveAmount: newReserve,
          agentTokenLpSupply: newLp,
        })
      )
        .to.emit(genesis, "ParamsUpdated")
        .withArgs(oldReserve, newReserve, oldLp, newLp);

      expect(await genesis.reserveAmount()).to.equal(newReserve);
      expect(await genesis.agentTokenLpSupply()).to.equal(newLp);
    });

    it("Should revert when caller lacks OPERATION_ROLE", async function () {
      const oldReserve = await genesis.reserveAmount();
      const oldLp = await genesis.agentTokenLpSupply();

      await expect(
        fGenesis.connect(user1).setParamsForGenesis(1, {
          reserveAmount: oldReserve + 1n,
          agentTokenLpSupply: oldLp,
        })
      ).to.be.reverted; // AccessControl missing role
    });
  });
});
