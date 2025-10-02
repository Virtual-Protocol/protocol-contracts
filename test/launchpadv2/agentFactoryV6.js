const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupNewLaunchpadTest } = require("./setup");
const {
  ERR_AGENT_ALREADY_EXISTS,
  ERR_CORES_MUST_BE_PROVIDED,
  ERR_INSUFFICIENT_ASSET_TOKEN,
  ERR_INSUFFICIENT_ASSET_TOKEN_ALLOWANCE,
  ERR_NOT_PROPOSER,
  ERR_APPLICATION_NOT_ACTIVE,
  ERR_APPLICATION_NOT_MATURED,
  ERR_TOKEN_ADMIN_NOT_SET,
  ERR_APPLICATION_TOKEN_ADDRESS_NOT_SET,
  APPLICATION_THRESHOLD,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,
  TBA_SALT,
  TBA_IMPLEMENTATION,
} = require("./const");

describe("AgentFactoryV6", function () {
  let setup;
  let contracts, accounts, addresses, params;

  before(async function () {
    setup = await loadFixture(setupNewLaunchpadTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;
    params = setup.params;
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial parameters", async function () {
      const { owner } = accounts;
      const { agentFactoryV6, virtualToken, agentNftV2 } = contracts;

      expect(await agentFactoryV6.owner()).to.equal(owner.address);
      expect(await agentFactoryV6.assetToken()).to.equal(
        await virtualToken.getAddress()
      );
      expect(await agentFactoryV6.nft()).to.equal(
        await agentNftV2.getAddress()
      );
      expect(await agentFactoryV6.applicationThreshold()).to.equal(
        APPLICATION_THRESHOLD
      );
    });

    it("Should have correct roles set", async function () {
      const { owner } = accounts;
      const { agentFactoryV6 } = contracts;

      expect(
        await agentFactoryV6.hasRole(
          await agentFactoryV6.DEFAULT_ADMIN_ROLE(),
          owner.address
        )
      ).to.be.true;
    });
  });

  describe("createNewAgentTokenAndApplication", function () {
    it("Should create new agent token and application successfully", async function () {
      const { bondingV2, virtualToken } = contracts;
      const { user1 } = accounts;

      const name = "Test Agent";
      const symbol = "TAG";
      const cores = [0, 1, 2];
      const tbaSalt = TBA_SALT;
      const tbaImplementation = TBA_IMPLEMENTATION;
      const daoVotingPeriod = DAO_VOTING_PERIOD;
      const daoThreshold = DAO_THRESHOLD;
      const applicationThreshold = APPLICATION_THRESHOLD;
      const creator = user1.address;

      // Create token supply params
      const tokenSupplyParams = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "address",
        ],
        [
          "1000000000", // maxSupply
          "125000000", // lpSupply
          "875000000", // vaultSupply
          "1000000000", // maxTokensPerWallet
          "1000000000", // maxTokensPerTxn
          0, // botProtectionDurationInSeconds
          addresses.bondingV2, // vault
        ]
      );

      // Approve virtual tokens for the factory
      await virtualToken
        .connect(user1)
        .approve(addresses.agentFactoryV6, applicationThreshold);

      const tx = await agentFactoryV6
        .connect(bondingV2)
        .createNewAgentTokenAndApplication(
          name,
          symbol,
          tokenSupplyParams,
          cores,
          tbaSalt,
          tbaImplementation,
          daoVotingPeriod,
          daoThreshold,
          applicationThreshold,
          creator
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = agentFactoryV6.interface.parseLog(log);
          return parsed.name === "NewApplication";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = agentFactoryV6.interface.parseLog(event);
      const applicationId = parsedEvent.args.id;

      // Verify application was created
      const application = await agentFactoryV6.getApplication(applicationId);
      expect(application.name).to.equal(name);
      expect(application.symbol).to.equal(symbol);
      expect(application.proposer).to.equal(creator);
      expect(application.tokenAddress).to.not.equal(ethers.ZeroAddress);

      return { applicationId, tokenAddress: application.tokenAddress };
    });

    it("Should fail with empty cores array", async function () {
      const { bondingV2, virtualToken } = contracts;
      const { user1 } = accounts;

      const name = "Test Agent";
      const symbol = "TAG";
      const cores = []; // Empty cores array
      const tbaSalt = TBA_SALT;
      const tbaImplementation = TBA_IMPLEMENTATION;
      const daoVotingPeriod = DAO_VOTING_PERIOD;
      const daoThreshold = DAO_THRESHOLD;
      const applicationThreshold = APPLICATION_THRESHOLD;
      const creator = user1.address;

      const tokenSupplyParams = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "address",
        ],
        [
          "1000000000",
          "125000000",
          "875000000",
          "1000000000",
          "1000000000",
          0,
          addresses.bondingV2,
        ]
      );

      await expect(
        agentFactoryV6
          .connect(bondingV2)
          .createNewAgentTokenAndApplication(
            name,
            symbol,
            tokenSupplyParams,
            cores,
            tbaSalt,
            tbaImplementation,
            daoVotingPeriod,
            daoThreshold,
            applicationThreshold,
            creator
          )
      ).to.be.revertedWith(ERR_CORES_MUST_BE_PROVIDED);
    });

    it("Should fail without BONDING_ROLE", async function () {
      const { user1 } = accounts;
      const { virtualToken } = contracts;

      const name = "Test Agent";
      const symbol = "TAG";
      const cores = [0, 1, 2];
      const tbaSalt = TBA_SALT;
      const tbaImplementation = TBA_IMPLEMENTATION;
      const daoVotingPeriod = DAO_VOTING_PERIOD;
      const daoThreshold = DAO_THRESHOLD;
      const applicationThreshold = APPLICATION_THRESHOLD;
      const creator = user1.address;

      const tokenSupplyParams = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "address",
        ],
        [
          "1000000000",
          "125000000",
          "875000000",
          "1000000000",
          "1000000000",
          0,
          addresses.bondingV2,
        ]
      );

      await expect(
        agentFactoryV6
          .connect(user1)
          .createNewAgentTokenAndApplication(
            name,
            symbol,
            tokenSupplyParams,
            cores,
            tbaSalt,
            tbaImplementation,
            daoVotingPeriod,
            daoThreshold,
            applicationThreshold,
            creator
          )
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await agentFactoryV6.BONDING_ROLE()}`
      );
    });
  });

  describe("executeBondingCurveApplicationSalt", function () {
    let applicationId, tokenAddress;

    beforeEach(async function () {
      const { bondingV2, virtualToken } = contracts;
      const { user1 } = accounts;

      // Create an application first
      const name = "Test Agent";
      const symbol = "TAG";
      const cores = [0, 1, 2];
      const tbaSalt = TBA_SALT;
      const tbaImplementation = TBA_IMPLEMENTATION;
      const daoVotingPeriod = DAO_VOTING_PERIOD;
      const daoThreshold = DAO_THRESHOLD;
      const applicationThreshold = APPLICATION_THRESHOLD;
      const creator = user1.address;

      const tokenSupplyParams = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "address",
        ],
        [
          "1000000000",
          "125000000",
          "875000000",
          "1000000000",
          "1000000000",
          0,
          addresses.bondingV2,
        ]
      );

      await virtualToken
        .connect(user1)
        .approve(addresses.agentFactoryV6, applicationThreshold);

      const tx = await agentFactoryV6
        .connect(bondingV2)
        .createNewAgentTokenAndApplication(
          name,
          symbol,
          tokenSupplyParams,
          cores,
          tbaSalt,
          tbaImplementation,
          daoVotingPeriod,
          daoThreshold,
          applicationThreshold,
          creator
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = agentFactoryV6.interface.parseLog(log);
          return parsed.name === "NewApplication";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = agentFactoryV6.interface.parseLog(event);
      applicationId = parsedEvent.args.id;

      const application = await agentFactoryV6.getApplication(applicationId);
      tokenAddress = application.tokenAddress;
    });

    it("Should execute bonding curve application successfully", async function () {
      const { bondingV2 } = contracts;

      const totalSupply = "1000000000";
      const lpSupply = "125000000";
      const vault = addresses.bondingV2;
      const salt = ethers.id("test-salt");

      const tx = await agentFactoryV6
        .connect(bondingV2)
        .executeBondingCurveApplicationSalt(
          applicationId,
          totalSupply,
          lpSupply,
          vault,
          salt
        );

      expect(tx).to.not.be.undefined;

      // Verify application status changed
      const application = await agentFactoryV6.getApplication(applicationId);
      expect(application.status).to.equal(1); // Executed status
    });

    it("Should fail without BONDING_ROLE", async function () {
      const { user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      const totalSupply = "1000000000";
      const lpSupply = "125000000";
      const vault = addresses.bondingV2;
      const salt = ethers.id("test-salt");

      await expect(
        agentFactoryV6
          .connect(user1)
          .executeBondingCurveApplicationSalt(
            applicationId,
            totalSupply,
            lpSupply,
            vault,
            salt
          )
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await agentFactoryV6.BONDING_ROLE()}`
      );
    });
  });

  describe("withdraw", function () {
    let applicationId;

    beforeEach(async function () {
      const { bondingV2, virtualToken } = contracts;
      const { user1 } = accounts;

      // Create an application first
      const name = "Test Agent";
      const symbol = "TAG";
      const cores = [0, 1, 2];
      const tbaSalt = TBA_SALT;
      const tbaImplementation = TBA_IMPLEMENTATION;
      const daoVotingPeriod = DAO_VOTING_PERIOD;
      const daoThreshold = DAO_THRESHOLD;
      const applicationThreshold = APPLICATION_THRESHOLD;
      const creator = user1.address;

      const tokenSupplyParams = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "address",
        ],
        [
          "1000000000",
          "125000000",
          "875000000",
          "1000000000",
          "1000000000",
          0,
          addresses.bondingV2,
        ]
      );

      await virtualToken
        .connect(user1)
        .approve(addresses.agentFactoryV6, applicationThreshold);

      const tx = await agentFactoryV6
        .connect(bondingV2)
        .createNewAgentTokenAndApplication(
          name,
          symbol,
          tokenSupplyParams,
          cores,
          tbaSalt,
          tbaImplementation,
          daoVotingPeriod,
          daoThreshold,
          applicationThreshold,
          creator
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = agentFactoryV6.interface.parseLog(log);
          return parsed.name === "NewApplication";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = agentFactoryV6.interface.parseLog(event);
      applicationId = parsedEvent.args.id;
    });

    it("Should allow proposer to withdraw", async function () {
      const { user1 } = accounts;
      const { agentFactoryV6, virtualToken } = contracts;

      // Wait for proposal end block
      await ethers.provider.send("evm_mine", []);

      const initialBalance = await virtualToken.balanceOf(user1.address);

      const tx = await agentFactoryV6.connect(user1).withdraw(applicationId);

      expect(tx).to.not.be.undefined;

      // Verify application status changed
      const application = await agentFactoryV6.getApplication(applicationId);
      expect(application.status).to.equal(2); // Withdrawn status

      // Verify tokens were returned
      const finalBalance = await virtualToken.balanceOf(user1.address);
      expect(finalBalance).to.be.greaterThan(initialBalance);
    });

    it("Should fail if not proposer", async function () {
      const { user2 } = accounts;
      const { agentFactoryV6 } = contracts;

      await expect(
        agentFactoryV6.connect(user2).withdraw(applicationId)
      ).to.be.revertedWith(ERR_NOT_PROPOSER);
    });

    it("Should fail if application is not active", async function () {
      const { user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      // Wait for proposal end block and withdraw first
      await ethers.provider.send("evm_mine", []);
      await agentFactoryV6.connect(user1).withdraw(applicationId);

      // Try to withdraw again
      await expect(
        agentFactoryV6.connect(user1).withdraw(applicationId)
      ).to.be.revertedWith(ERR_APPLICATION_NOT_ACTIVE);
    });
  });

  describe("updateApplicationThresholdWithApplicationId", function () {
    let applicationId;

    beforeEach(async function () {
      const { bondingV2, virtualToken } = contracts;
      const { user1 } = accounts;

      // Create an application first
      const name = "Test Agent";
      const symbol = "TAG";
      const cores = [0, 1, 2];
      const tbaSalt = TBA_SALT;
      const tbaImplementation = TBA_IMPLEMENTATION;
      const daoVotingPeriod = DAO_VOTING_PERIOD;
      const daoThreshold = DAO_THRESHOLD;
      const applicationThreshold = APPLICATION_THRESHOLD;
      const creator = user1.address;

      const tokenSupplyParams = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "uint256",
          "address",
        ],
        [
          "1000000000",
          "125000000",
          "875000000",
          "1000000000",
          "1000000000",
          0,
          addresses.bondingV2,
        ]
      );

      await virtualToken
        .connect(user1)
        .approve(addresses.agentFactoryV6, applicationThreshold);

      const tx = await agentFactoryV6
        .connect(bondingV2)
        .createNewAgentTokenAndApplication(
          name,
          symbol,
          tokenSupplyParams,
          cores,
          tbaSalt,
          tbaImplementation,
          daoVotingPeriod,
          daoThreshold,
          applicationThreshold,
          creator
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = agentFactoryV6.interface.parseLog(log);
          return parsed.name === "NewApplication";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = agentFactoryV6.interface.parseLog(event);
      applicationId = parsedEvent.args.id;
    });

    it("Should update application threshold successfully", async function () {
      const { bondingV2 } = contracts;
      const { agentFactoryV6 } = contracts;

      const newThreshold = ethers.parseEther("200"); // 200 VIRTUAL tokens

      const tx = await agentFactoryV6
        .connect(bondingV2)
        .updateApplicationThresholdWithApplicationId(
          applicationId,
          newThreshold
        );

      expect(tx).to.not.be.undefined;

      // Verify threshold was updated
      const application = await agentFactoryV6.getApplication(applicationId);
      expect(application.withdrawableAmount).to.equal(newThreshold);
    });

    it("Should fail without BONDING_ROLE", async function () {
      const { user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      const newThreshold = ethers.parseEther("200");

      await expect(
        agentFactoryV6
          .connect(user1)
          .updateApplicationThresholdWithApplicationId(
            applicationId,
            newThreshold
          )
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await agentFactoryV6.BONDING_ROLE()}`
      );
    });
  });

  describe("Access Control", function () {
    it("Should grant and revoke roles correctly", async function () {
      const { owner, user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      const BONDING_ROLE = await agentFactoryV6.BONDING_ROLE();

      // Grant role
      await agentFactoryV6
        .connect(owner)
        .grantRole(BONDING_ROLE, user1.address);
      expect(await agentFactoryV6.hasRole(BONDING_ROLE, user1.address)).to.be
        .true;

      // Revoke role
      await agentFactoryV6
        .connect(owner)
        .revokeRole(BONDING_ROLE, user1.address);
      expect(await agentFactoryV6.hasRole(BONDING_ROLE, user1.address)).to.be
        .false;
    });

    it("Should fail to grant role without admin role", async function () {
      const { user1, user2 } = accounts;
      const { agentFactoryV6 } = contracts;

      const BONDING_ROLE = await agentFactoryV6.BONDING_ROLE();

      await expect(
        agentFactoryV6.connect(user1).grantRole(BONDING_ROLE, user2.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await agentFactoryV6.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });

  describe("Configuration", function () {
    it("Should set application threshold", async function () {
      const { owner } = accounts;
      const { agentFactoryV6 } = contracts;

      const newThreshold = ethers.parseEther("500");

      await agentFactoryV6.connect(owner).setApplicationThreshold(newThreshold);

      expect(await agentFactoryV6.applicationThreshold()).to.equal(
        newThreshold
      );
    });

    it("Should set vault", async function () {
      const { owner, user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      await agentFactoryV6.connect(owner).setVault(user1.address);

      // Note: vault is private, so we can't directly test it
      // But the transaction should succeed
      expect(true).to.be.true;
    });

    it("Should set implementations", async function () {
      const { owner, user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      await agentFactoryV6.connect(owner).setImplementations(
        user1.address, // token
        user1.address, // veToken
        user1.address // dao
      );

      expect(await agentFactoryV6.tokenImplementation()).to.equal(
        user1.address
      );
      expect(await agentFactoryV6.veTokenImplementation()).to.equal(
        user1.address
      );
      expect(await agentFactoryV6.daoImplementation()).to.equal(user1.address);
    });

    it("Should set params", async function () {
      const { owner, user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      const newMaturityDuration = 86400 * 365; // 1 year
      const newRouter = user1.address;
      const newDelegatee = user1.address;
      const newTokenAdmin = user1.address;

      await agentFactoryV6
        .connect(owner)
        .setParams(newMaturityDuration, newRouter, newDelegatee, newTokenAdmin);

      expect(await agentFactoryV6.maturityDuration()).to.equal(
        newMaturityDuration
      );
      expect(await agentFactoryV6.defaultDelegatee()).to.equal(newDelegatee);
    });

    it("Should set token params", async function () {
      const { owner, user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      const maxSupply = "1000000000";
      const lpSupply = "125000000";
      const vaultSupply = "875000000";
      const maxTokensPerWallet = "1000000000";
      const maxTokensPerTxn = "1000000000";
      const botProtectionDurationInSeconds = 0;
      const vault = user1.address;
      const projectBuyTaxBasisPoints = 100;
      const projectSellTaxBasisPoints = 100;
      const taxSwapThresholdBasisPoints = 100;
      const projectTaxRecipient = user1.address;

      await agentFactoryV6
        .connect(owner)
        .setTokenParams(
          maxSupply,
          lpSupply,
          vaultSupply,
          maxTokensPerWallet,
          maxTokensPerTxn,
          botProtectionDurationInSeconds,
          vault,
          projectBuyTaxBasisPoints,
          projectSellTaxBasisPoints,
          taxSwapThresholdBasisPoints,
          projectTaxRecipient
        );

      // Note: token params are stored as bytes, so we can't directly test them
      // But the transaction should succeed
      expect(true).to.be.true;
    });

    it("Should pause and unpause", async function () {
      const { owner } = accounts;
      const { agentFactoryV6 } = contracts;

      // Pause
      await agentFactoryV6.connect(owner).pause();
      expect(await agentFactoryV6.paused()).to.be.true;

      // Unpause
      await agentFactoryV6.connect(owner).unpause();
      expect(await agentFactoryV6.paused()).to.be.false;
    });

    it("Should fail configuration without admin role", async function () {
      const { user1 } = accounts;
      const { agentFactoryV6 } = contracts;

      await expect(
        agentFactoryV6
          .connect(user1)
          .setApplicationThreshold(ethers.parseEther("500"))
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await agentFactoryV6.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });
});
