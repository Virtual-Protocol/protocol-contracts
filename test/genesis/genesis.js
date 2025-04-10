const { ethers, upgrades } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { setupTest } = require("./setup");

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

    // Get 5 participant accounts
    participants = (await ethers.getSigners()).slice(5, 10);
    
    // Transfer 100 tokens to each participant and approve
    for (const participant of participants) {
      await virtualToken.transfer(
        participant.address,
        ethers.parseEther("100")
      );
      await virtualToken
        .connect(participant)
        .approve(await genesis.getAddress(), ethers.parseEther("100"));
    }

    maxContribution = await genesis.maxContributionVirtualAmount();
  });

  describe("Genesis Business Logic Tests", function () {
    it("Should return correct Genesis information", async function () {
      const genesisInfo = await genesis.getGenesisInfo();
      expect(genesisInfo.genesisId).to.equal(1);
      expect(genesisInfo.genesisName).to.equal("Test Genesis");
      expect(genesisInfo.genesisTicker).to.equal("TEST");
      expect(genesisInfo.virtualTokenAddress).to.equal(await virtualToken.getAddress());
    });

    it("Should handle multiple participants with different contribution amounts", async function () {
      await time.increase(3600); // Ensure Genesis has started

      // edit the contribution amount, ensure it does not exceed the max limit
      const contributions = [2, 3, 1, 2, 1].map(x => 
        ethers.parseEther(x.toString())
      );
      
      console.log("\n=== Participation Phase ===");
      for (let i = 0; i < participants.length; i++) {
        await genesis
          .connect(participants[i])
          .participate(
            ethers.parseEther("1"),
            contributions[i],
            participants[i].address
          );
        
        console.log(`Participant ${i + 1} contributed:`, ethers.formatEther(contributions[i]));
        
        // Verify participation record
        const participated = await genesis.mapAddrToVirtuals(participants[i].address);
        expect(participated).to.equal(contributions[i]);
      }

      // Verify participant information
      const participantCount = await genesis.getParticipantCount();
      expect(participantCount).to.equal(5);

      const participantsInfo = await genesis.getParticipantsInfo([0, 1, 2, 3, 4]);
      console.log("\nParticipants Information:");
      participantsInfo.forEach((info, index) => {
        console.log(`Participant ${index + 1}:`, {
          address: info.userAddress,
          virtuals: ethers.formatEther(info.virtuals)
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
      const contributions = [2, 3, 1, 2, 1].map(x => 
        ethers.parseEther(x.toString())
      );
      const initialBalances = await Promise.all(
        participants.map(p => virtualToken.balanceOf(p.address))
      );
      
      for (let i = 0; i < participants.length; i++) {
        await genesis
          .connect(participants[i])
          .participate(
            ethers.parseEther("1"),
            contributions[i],
            participants[i].address
          );
      }

      // Wait for end time
      const endTime = await genesis.endTime();
      await time.increaseTo(endTime);

      // Execute failure flow
      await fGenesis.connect(beOpsWallet).onGenesisFailed(1);

      const finalBalances = await Promise.all(
        participants.map(p => virtualToken.balanceOf(p.address))
      );

      console.log("\n=== Genesis Failure Refund Details ===");
      participants.forEach((p, i) => {
        console.log(`Participant ${i + 1}:`, {
          initial: ethers.formatEther(contributions[i]),
          final: ethers.formatEther(finalBalances[i]),
          refunded: ethers.formatEther(finalBalances[i] - contributions[i])
        });
        // Verify full refund
        expect(initialBalances[i]).to.equal(finalBalances[i]);
      });

      // Verify contract state
      expect(await genesis.isFailed()).to.be.true;
      expect(await genesis.agentTokenAddress()).to.equal(ethers.ZeroAddress);
    });

    it("Should enforce contribution limits and timing restrictions", async function () {
      const amount = ethers.parseEther("10");
      
      // Cannot participate before start
      await expect(
        genesis
          .connect(participants[0])
          .participate(
            ethers.parseEther("1"),
            amount,
            participants[0].address
          )
      ).to.be.revertedWith("Genesis has not started yet");

      // Can participate after start
      await time.increase(3600);
      await expect(
        genesis
          .connect(participants[0])
          .participate(
            ethers.parseEther("1"),
            amount,
            participants[0].address
          )
      ).to.not.be.reverted;

      // Cannot exceed max contribution
      await expect(
        genesis
          .connect(participants[1])
          .participate(
            ethers.parseEther("1"),
            maxContribution + 1n,
            participants[1].address
          )
      ).to.be.revertedWith("Exceeds maximum virtuals per contribution");

      // Cannot participate after end
      await time.increaseTo(await genesis.endTime());
      await expect(
        genesis
          .connect(participants[2])
          .participate(
            ethers.parseEther("1"),
            amount,
            participants[2].address
          )
      ).to.be.revertedWith("Genesis has ended");
    });
  });

  describe("onGenesisSuccess", function () {
    it("Should revert if Genesis has not ended", async function () {
      await expect(fGenesis.connect(beOpsWallet).onGenesisSuccess(
        1,
        {
          refundAddresses: [],
          refundAmounts: [],
          distributeAddresses: [],
          distributeAmounts: []
        }
      )).to.be.revertedWith("Genesis not ended yet");
    });

    it("Should revert if insufficient Virtual Token balance", async function () {
      // Wait for Genesis to end
      await time.increaseTo(await genesis.endTime());

      await expect(fGenesis.connect(beOpsWallet).onGenesisSuccess(
        1,
        {
          refundAddresses: [participants[0].address],
          refundAmounts: [ethers.parseEther("1000")],
          distributeAddresses: [],
          distributeAmounts: []
        }
      )).to.be.revertedWith("Insufficient Virtual Token committed");
    });

    it("Should handle successful Genesis completion with token distribution", async function () {
      await time.increase(3600);

      // edit the contribution amount, ensure it does not exceed the max limit
      const contributions = [2, 3, 1, 2, 1].map(x => 
        ethers.parseEther(x.toString())
      );
      // Record initial balances
      let initialBalances = await Promise.all(
        participants.map(p => virtualToken.balanceOf(p.address))
      );
      console.log("Participants Initial Balances:", initialBalances.map(b => ethers.formatEther(b)));
      
      for (let i = 0; i < participants.length; i++) {
        await genesis
          .connect(participants[i])
          .participate(
            1,
            contributions[i],
            participants[i].address
          );
          const genesisVirtualTokenBalance = await virtualToken.balanceOf(await genesis.getAddress());
          console.log("After participate idx: " + i + ", Genesis Virtual Token Balance ", ethers.formatEther(genesisVirtualTokenBalance));
      }
      initialBalances = await Promise.all(
        participants.map(p => virtualToken.balanceOf(p.address))
      );
      console.log("Participants Balances after participate:", initialBalances.map(b => ethers.formatEther(b)));

      // Ensure contract has enough reserve
      const reserveAmount = (await fGenesis.params()).reserve;
      await virtualToken.transfer(
        await genesis.getAddress(),
        reserveAmount
      );

      // Wait for end time
      const endTime = await genesis.endTime();
      await time.increaseTo(endTime);

      console.log("\n=== Genesis Success Scenario ===");

      // Prepare success parameters
      const successParams = {
        refundAddresses: participants.map(p => p.address),
        refundAmounts: contributions.map(c => c / 2n), // Use BigInt division
        distributeAddresses: participants.map(p => p.address),
        distributeAmounts: contributions.map(c => c / 2n), // Use BigInt division
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
      const genesisVirtualTokenBalance = await virtualToken.balanceOf(await genesis.getAddress());
      console.log("Genesis Virtual Token Balance:", ethers.formatEther(genesisVirtualTokenBalance));

      // Execute success flow
      await fGenesis
        .connect(beOpsWallet)
        .onGenesisSuccess(1, successParams);

      // Verify final state
      const finalBalances = await Promise.all(
        participants.map(p => virtualToken.balanceOf(p.address))
      );
      console.log("Final Balances:", finalBalances.map(b => ethers.formatEther(b)));

      // Verify Genesis state
      const genesisInfo = await genesis.getGenesisInfo();
      expect(genesisInfo.agentTokenAddress).to.not.equal(
        ethers.ZeroAddress,
        "Agent token should be created"
      );
    });
  });
});
