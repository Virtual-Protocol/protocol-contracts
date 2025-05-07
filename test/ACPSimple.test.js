const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("ACPSimple", function () {
  let ACPSimple;
  let acpSimple;
  let ACPRegistry;
  let acpRegistry;
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

    // Deploy ACPRegistry
    ACPRegistry = await ethers.getContractFactory("ACPRegistry");
    acpRegistry = await upgrades.deployProxy(ACPRegistry, []);
    await acpRegistry.waitForDeployment();

    // Register evaluator
    await acpRegistry.connect(evaluator).registerEvaluator();
    const evalId = await acpRegistry.connect(evaluator).registerEvaluationService(
      ethers.parseEther("1"),
      0 // ABSOLUTE fee type
    );

    // Deploy ACPSimple
    ACPSimple = await ethers.getContractFactory("ACPSimple");
    acpSimple = await upgrades.deployProxy(ACPSimple, [
      await mockToken.getAddress(),
      200, // 2% platform fee
      platformTreasury.address,
      await acpRegistry.getAddress()
    ]);
    await acpSimple.waitForDeployment();

    // Mint some tokens to client for testing
    await mockToken.mint(client.address, ethers.parseEther("1000"));
  });

  describe("Job Creation", function () {
    it("Should create a new job successfully", async function () {
      const expiredAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      await expect(acpSimple.connect(client).createJob(
        provider.address,
        expiredAt,
        evaluator.address,
        1 // evalId
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
      await acpSimple.connect(client).createJob(
        provider.address,
        expiredAt,
        evaluator.address,
        1 // evalId
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
      const memoId = receipt.logs[0].args[2]; // NewMemo event has memoId as third argument

      // Provider signs the memo to approve moving to negotiation
      await acpSimple.connect(provider).signMemo(memoId, true, "Approved");

      // Verify we're in negotiation phase
      const job = await acpSimple.jobs(1);
      expect(job.phase).to.equal(1); // PHASE_NEGOTIATION

      const jobValue = ethers.parseEther("10");
      const evaluatorFee = ethers.parseEther("1");
      await mockToken.connect(client).approve(await acpSimple.getAddress(), jobValue + evaluatorFee);

      await expect(acpSimple.connect(client).setBudget(1, jobValue, evaluatorFee))
        .to.emit(acpSimple, "BudgetSet")
        .withArgs(1, jobValue);

      const updatedJob = await acpSimple.jobs(1);
      expect(updatedJob.budget).to.equal(jobValue + evaluatorFee);
    });

    it("Should fail when setting budget less than evaluator fee + platform fee", async function () {
      // First create a job
      const expiredAt = Math.floor(Date.now() / 1000) + 3600;
      await acpSimple.connect(client).createJob(
        provider.address,
        expiredAt,
        evaluator.address,
        1 // evalId
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
      const memoId = receipt.logs[0].args[2]; // NewMemo event has memoId as third argument

      // Provider signs the memo to approve moving to negotiation
      await acpSimple.connect(provider).signMemo(memoId, true, "Approved");

      // Try to set a budget that's less than evaluator fee + platform fee
      const jobValue = ethers.parseEther("1.02"); // Less than evaluator fee (1 ETH)
      const evaluatorFee = ethers.parseEther("1");
      await mockToken.connect(client).approve(await acpSimple.getAddress(), jobValue + evaluatorFee);

      await expect(acpSimple.connect(client).setBudget(1, jobValue, evaluatorFee))
        .to.be.revertedWith("Evaluator fee is too low");
    });
  });

  describe("Job Expiration", function () {
    it("Should allow client to claim refund after job expires", async function () {
      // Create a job with 6 minutes expiry
      const expiredAt = Math.floor(Date.now() / 1000) + 360; // 6 minutes from now
      await acpSimple.connect(client).createJob(
        provider.address,
        expiredAt,
        evaluator.address,
        1 // evalId
      );

      // Move to negotiation phase
      const tx1 = await acpSimple.connect(client).createMemo(
        1,
        "Moving to negotiation",
        0, // MemoType.REQUEST
        false,
        1 // PHASE_NEGOTIATION
      );
      const receipt1 = await tx1.wait();
      const memoId1 = receipt1.logs[0].args[2]; // NewMemo event has memoId as third argument
      await acpSimple.connect(provider).signMemo(memoId1, true, "Approved");

      // Set budget
      const jobValue = ethers.parseEther("10");
      const evaluatorFee = ethers.parseEther("1");
      await mockToken.connect(client).approve(await acpSimple.getAddress(), jobValue + evaluatorFee);
      await acpSimple.connect(client).setBudget(1, jobValue, evaluatorFee);

      // Move to transaction phase
      const tx2 = await acpSimple.connect(client).createMemo(
        1,
        "Moving to transaction",
        0, // MemoType.REQUEST
        false,
        2 // PHASE_TRANSACTION
      );
      const receipt2 = await tx2.wait();
      const memoId2 = receipt2.logs[0].args[2]; // NewMemo event has memoId as third argument
      await acpSimple.connect(provider).signMemo(memoId2, true, "Approved");

      // Fast forward time by 7 minutes
      await ethers.provider.send("evm_increaseTime", [420]); // 7 minutes
      await ethers.provider.send("evm_mine");

      // Verify job is in TRANSACTION phase before expiry
      const jobBeforeExpiry = await acpSimple.jobs(1);
      expect(jobBeforeExpiry.phase).to.equal(2); // PHASE_TRANSACTION

      // Get initial balances
      const initialClientBalance = await mockToken.balanceOf(client.address);

      // Claim refund
      const tx = await acpSimple.connect(client).claimBudget(1);
      const receipt = await tx.wait();
      await expect(tx)
        .to.emit(acpSimple, "RefundedBudget")
        .withArgs(1, client.address, jobValue + evaluatorFee);

      // Verify job is in EXPIRED phase
      const job = await acpSimple.jobs(1);
      expect(job.phase).to.equal(6); // PHASE_EXPIRED
    });
  });
}); 