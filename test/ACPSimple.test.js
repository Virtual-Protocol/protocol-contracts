const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("ACPSimple", function () {
  let ACPSimple;
  let acpSimple;
  let MockERC20;
  let mockToken;
  let owner;
  let client;
  let provider;
  let evaluator;
  let platformTreasury;

  beforeEach(async function () {
    [owner, client, provider, evaluator, platformTreasury] = await ethers.getSigners();

    // Deploy mock ERC20 token
    MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    mockToken = await MockERC20.deploy("Mock Token", "MTK");
    await mockToken.waitForDeployment();

    // Deploy ACPSimple
    ACPSimple = await ethers.getContractFactory("ACPSimple");
    acpSimple = await upgrades.deployProxy(ACPSimple, [
      await mockToken.getAddress(),
      500, // 5% evaluator fee
      200, // 2% platform fee
      platformTreasury.address
    ]);
    await acpSimple.waitForDeployment();

    // Mint some tokens to client for testing
    await mockToken.mint(client.address, ethers.parseEther("1000"));
  });

  describe("Job Creation", function () {
    it("Should create a new job successfully", async function () {
      const expiredAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const evaluatorFee = ethers.parseEther("1");

      await expect(acpSimple.connect(client).createJob(
        provider.address,
        evaluator.address,
        expiredAt,
        evaluatorFee
      ))
        .to.emit(acpSimple, "JobCreated")
        .withArgs(1, client.address, provider.address, evaluator.address);

      const job = await acpSimple.jobs(1);
      expect(job.client).to.equal(client.address);
      expect(job.provider).to.equal(provider.address);
      expect(job.evaluator).to.equal(evaluator.address);
      expect(job.phase).to.equal(0); // REQUEST phase
    });
  });

  describe("Budget Setting", function () {
    it("Should set budget in negotiation phase", async function () {
      // First create a job
      const expiredAt = Math.floor(Date.now() / 1000) + 3600;
      const evaluatorFee = ethers.parseEther("1");
      await acpSimple.connect(client).createJob(
        provider.address,
        evaluator.address,
        expiredAt,
        evaluatorFee
      );

      // Client creates memo to move to negotiation
      const tx = await acpSimple.connect(client).createMemo(
        1,
        "Moving to negotiation",
        0, // MemoType.REQUEST
        false,
        1 // PHASE_NEGOTIATION
      );

      // Wait for the transaction and get the memo ID
      const receipt = await tx.wait();
      const memoId = receipt.logs[0].args[0];

      // Provider signs the memo to approve moving to negotiation
      await acpSimple.connect(provider).signMemo(memoId, true, "Approved");

      // Verify we're in negotiation phase
      const job = await acpSimple.jobs(1);
      expect(job.phase).to.equal(1); // PHASE_NEGOTIATION

      const budget = ethers.parseEther("10");
      await mockToken.connect(client).approve(await acpSimple.getAddress(), budget);

      await expect(acpSimple.connect(client).setBudget(1, budget))
        .to.emit(acpSimple, "BudgetSet")
        .withArgs(1, budget);

      const updatedJob = await acpSimple.jobs(1);
      expect(updatedJob.budget).to.equal(budget);
    });

    it("Should fail when setting budget less than evaluator fee + platform fee", async function () {
      // First create a job
      const expiredAt = Math.floor(Date.now() / 1000) + 3600;
      const evaluatorFee = ethers.parseEther("1");
      await acpSimple.connect(client).createJob(
        provider.address,
        evaluator.address,
        expiredAt,
        evaluatorFee
      );

      // Client creates memo to move to negotiation
      const tx = await acpSimple.connect(client).createMemo(
        1,
        "Moving to negotiation",
        0, // MemoType.REQUEST
        false,
        1 // PHASE_NEGOTIATION
      );

      // Wait for the transaction and get the memo ID
      const receipt = await tx.wait();
      const memoId = receipt.logs[0].args[0];

      // Provider signs the memo to approve moving to negotiation
      await acpSimple.connect(provider).signMemo(memoId, true, "Approved");

      // Try to set a budget that's less than evaluator fee + platform fee
      const budget = ethers.parseEther("1.02"); // Less than evaluator fee (1 ETH)
      await mockToken.connect(client).approve(await acpSimple.getAddress(), budget);

      await expect(acpSimple.connect(client).setBudget(1, budget))
        .to.be.revertedWith("Amount must be greater than or equal to evaluator fee plus platform fee");
    });
  });
}); 