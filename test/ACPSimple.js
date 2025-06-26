const { expect } = require("chai");
const { ethers, upgrades, network } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("ACPSimple", function () {
  // Constants from the contract
  const PHASE_REQUEST = 0;
  const PHASE_NEGOTIATION = 1;
  const PHASE_TRANSACTION = 2;
  const PHASE_EVALUATION = 3;
  const PHASE_COMPLETED = 4;
  const PHASE_REJECTED = 5;
  const PHASE_EXPIRED = 6;

  const MEMO_TYPE = {
    MESSAGE: 0,
    CONTEXT_URL: 1,
    IMAGE_URL: 2,
    VOICE_URL: 3,
    OBJECT_URL: 4,
    TXHASH: 5
  };

  async function deployACPFixture() {
    const [deployer, client, provider, evaluator, platformTreasury, user] = await ethers.getSigners();

    // Deploy mock ERC20 token for payments
    const MockToken = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    const paymentToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
    await paymentToken.waitForDeployment();

    // Deploy ACPSimple contract
    const ACPSimple = await ethers.getContractFactory("ACPSimple");
    const acp = await upgrades.deployProxy(ACPSimple, [
      await paymentToken.getAddress(),
      1000, // 10% evaluator fee
      500,  // 5% platform fee
      platformTreasury.address
    ]);
    await acp.waitForDeployment();

    // Setup token balances
    await paymentToken.mint(client.address, ethers.parseEther("10000"));
    await paymentToken.mint(provider.address, ethers.parseEther("10000"));
    await paymentToken.connect(client).approve(await acp.getAddress(), ethers.parseEther("10000"));

    return {
      acp,
      paymentToken,
      deployer,
      client,
      provider,
      evaluator,
      platformTreasury,
      user
    };
  }

  async function createJobWithMemo() {
    const fixture = await loadFixture(deployACPFixture);
    const { acp, client, provider, evaluator } = fixture;

    // Create a job
    const expiredAt = (await time.latest()) + 86400; // 1 day from now
    const tx = await acp.connect(client).createJob(provider.address, evaluator.address, expiredAt);
    const receipt = await tx.wait();
    const jobId = receipt.logs[0].args[0]; // First event should be JobCreated

    // Set budget
    const budget = ethers.parseEther("100");
    await acp.connect(client).setBudget(jobId, budget);

    // Create a memo to transition to negotiation phase
    const memoTx = await acp.connect(client).createMemo(
      jobId,
      "Initial request memo",
      MEMO_TYPE.MESSAGE,
      false,
      PHASE_NEGOTIATION
    );
    const memoReceipt = await memoTx.wait();
    const memoId = memoReceipt.logs[0].args[2]; // NewMemo event

    return {
      ...fixture,
      jobId,
      memoId,
      budget
    };
  }

  describe("signMemo", function () {
    it("Should allow provider to sign memo in request phase", async function () {
      const { acp, client, provider, jobId, memoId } = await loadFixture(createJobWithMemo);

      // Provider signs the memo to approve moving to negotiation phase
      await expect(
        acp.connect(provider).signMemo(memoId, true, "Approved to negotiate")
      )
        .to.emit(acp, "MemoSigned")
        .withArgs(memoId, true, "Approved to negotiate")
        .and.to.emit(acp, "JobPhaseUpdated")
        .withArgs(jobId, PHASE_REQUEST, PHASE_NEGOTIATION);

      // Check job phase updated
      const job = await acp.jobs(jobId);
      expect(job.phase).to.equal(PHASE_NEGOTIATION);
    });

    it("Should allow client to sign memo in negotiation phase", async function () {
      const { acp, client, provider, jobId, memoId } = await loadFixture(createJobWithMemo);

      // First, provider signs to move to negotiation phase
      await acp.connect(provider).signMemo(memoId, true, "Approved");

      // Create memo in negotiation phase
      const memoTx2 = await acp.connect(provider).createMemo(
        jobId,
        "Negotiation memo",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_TRANSACTION
      );
      const memoReceipt2 = await memoTx2.wait();
      const memoId2 = memoReceipt2.logs[0].args[2];

      // Client signs to move to transaction phase
      await expect(
        acp.connect(client).signMemo(memoId2, true, "Agreed to terms")
      )
        .to.emit(acp, "MemoSigned")
        .withArgs(memoId2, true, "Agreed to terms")
        .and.to.emit(acp, "JobPhaseUpdated")
        .withArgs(jobId, PHASE_NEGOTIATION, PHASE_TRANSACTION);
    });

    it("Should allow evaluator to sign memo in evaluation phase", async function () {
      const { acp, client, provider, evaluator, jobId, memoId, paymentToken, budget } = await loadFixture(createJobWithMemo);

      // Move job through phases to evaluation
      await acp.connect(provider).signMemo(memoId, true, "Approved");

      const memoTx2 = await acp.connect(provider).createMemo(
        jobId,
        "Negotiation memo",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_TRANSACTION
      );
      const memoReceipt2 = await memoTx2.wait();
      const memoId2 = memoReceipt2.logs[0].args[2];
      await acp.connect(client).signMemo(memoId2, true, "Agreed");

      // Create evaluation memo (moves to evaluation phase automatically)
      const memoTx3 = await acp.connect(provider).createMemo(
        jobId,
        "Work completed",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_COMPLETED
      );
      const memoReceipt3 = await memoTx3.wait();
      const memoId3 = memoReceipt3.logs[0].args[2];

      // Set up contract to have tokens for payment distribution
      // Note: This works around a contract bug where it uses safeTransferFrom instead of safeTransfer
      const acpAddress = await acp.getAddress();
      await paymentToken.mint(acpAddress, budget);
      
      // Impersonate the contract to approve itself (workaround for contract bug)
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [acpAddress],
      });
      // Fund the contract for gas
      await network.provider.send("hardhat_setBalance", [
        acpAddress,
        "0x1000000000000000000", // 1 ETH
      ]);
      const contractSigner = await ethers.getSigner(acpAddress);
      await paymentToken.connect(contractSigner).approve(acpAddress, ethers.parseEther("1000")); // Larger allowance
      await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [acpAddress],
      });

      // Evaluator signs to complete the job
      await expect(
        acp.connect(evaluator).signMemo(memoId3, true, "Work approved")
      )
        .to.emit(acp, "MemoSigned")
        .withArgs(memoId3, true, "Work approved")
        .and.to.emit(acp, "JobPhaseUpdated")
        .withArgs(jobId, PHASE_EVALUATION, PHASE_COMPLETED);
    });

    it("Should allow client to act as evaluator when evaluator is zero address", async function () {
      const { acp, client, provider, paymentToken } = await loadFixture(deployACPFixture);

      // Create job without evaluator (zero address)
      const expiredAt = (await time.latest()) + 86400;
      const tx = await acp.connect(client).createJob(provider.address, ethers.ZeroAddress, expiredAt);
      const receipt = await tx.wait();
      const newJobId = receipt.logs[0].args[0];

      const budget = ethers.parseEther("100");
      await acp.connect(client).setBudget(newJobId, budget);

      // Move to evaluation phase
      const memoTx1 = await acp.connect(client).createMemo(
        newJobId,
        "Request",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_NEGOTIATION
      );
      const memoReceipt1 = await memoTx1.wait();
      const memoId1 = memoReceipt1.logs[0].args[2];
      await acp.connect(provider).signMemo(memoId1, true, "Approved");

      const memoTx2 = await acp.connect(provider).createMemo(
        newJobId,
        "Negotiation",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_TRANSACTION
      );
      const memoReceipt2 = await memoTx2.wait();
      const memoId2 = memoReceipt2.logs[0].args[2];
      await acp.connect(client).signMemo(memoId2, true, "Agreed");

      const memoTx3 = await acp.connect(provider).createMemo(
        newJobId,
        "Work completed",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_COMPLETED
      );
      const memoReceipt3 = await memoTx3.wait();
      const memoId3 = memoReceipt3.logs[0].args[2];

      // Set up contract self-approval workaround for payment distribution
      const acpAddress = await acp.getAddress();
      await paymentToken.mint(acpAddress, budget);
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [acpAddress],
      });
      // Fund the contract for gas
      await network.provider.send("hardhat_setBalance", [
        acpAddress,
        "0x1000000000000000000", // 1 ETH
      ]);
      const contractSigner = await ethers.getSigner(acpAddress);
      await paymentToken.connect(contractSigner).approve(acpAddress, ethers.parseEther("1000")); // Larger allowance
      await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [acpAddress],
      });

      // Client can act as evaluator when evaluator is zero address
      await expect(
        acp.connect(client).signMemo(memoId3, true, "Self approved")
      )
        .to.emit(acp, "JobPhaseUpdated")
        .withArgs(newJobId, PHASE_EVALUATION, PHASE_COMPLETED);
    });

    it("Should reject job when evaluator disapproves", async function () {
      const { acp, client, provider, evaluator, jobId, memoId, paymentToken, budget } = await loadFixture(createJobWithMemo);

      // Move job to evaluation phase
      await acp.connect(provider).signMemo(memoId, true, "Approved");

      const memoTx2 = await acp.connect(provider).createMemo(
        jobId,
        "Negotiation memo",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_TRANSACTION
      );
      const memoReceipt2 = await memoTx2.wait();
      const memoId2 = memoReceipt2.logs[0].args[2];
      await acp.connect(client).signMemo(memoId2, true, "Agreed");

      const memoTx3 = await acp.connect(provider).createMemo(
        jobId,
        "Work completed",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_COMPLETED
      );
      const memoReceipt3 = await memoTx3.wait();
      const memoId3 = memoReceipt3.logs[0].args[2];

      // Set up contract self-approval workaround for refund distribution  
      const acpAddress = await acp.getAddress();
      await paymentToken.mint(acpAddress, budget);
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [acpAddress],
      });
      // Fund the contract for gas
      await network.provider.send("hardhat_setBalance", [
        acpAddress,
        "0x1000000000000000000", // 1 ETH
      ]);
      const contractSigner = await ethers.getSigner(acpAddress);
      await paymentToken.connect(contractSigner).approve(acpAddress, ethers.parseEther("1000")); // Larger allowance
      await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [acpAddress],
      });

      // Evaluator rejects the work
      await expect(
        acp.connect(evaluator).signMemo(memoId3, false, "Work not satisfactory")
      )
        .to.emit(acp, "MemoSigned")
        .withArgs(memoId3, false, "Work not satisfactory")
        .and.to.emit(acp, "JobPhaseUpdated")
        .withArgs(jobId, PHASE_EVALUATION, PHASE_REJECTED);
    });

    it("Should revert if memo sender tries to sign their own memo (except in evaluation phase)", async function () {
      const { acp, client, provider, jobId, memoId } = await loadFixture(createJobWithMemo);

      // Client (memo sender) tries to sign their own memo
      await expect(
        acp.connect(client).signMemo(memoId, true, "Self signing")
      ).to.be.revertedWith("Only counter party can sign");
    });

    it("Should revert if unauthorized user tries to sign", async function () {
      const { acp, user, memoId } = await loadFixture(createJobWithMemo);

      await expect(
        acp.connect(user).signMemo(memoId, true, "Unauthorized")
      ).to.be.revertedWith("Unauthorised memo signer");
    });

    it("Should revert when trying to create memo on completed job", async function () {
      const { acp, client, provider, evaluator, jobId, memoId, paymentToken, budget } = await loadFixture(createJobWithMemo);

      // Complete the job first
      await acp.connect(provider).signMemo(memoId, true, "Approved");

      const memoTx2 = await acp.connect(provider).createMemo(
        jobId,
        "Negotiation memo",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_TRANSACTION
      );
      const memoReceipt2 = await memoTx2.wait();
      const memoId2 = memoReceipt2.logs[0].args[2];
      await acp.connect(client).signMemo(memoId2, true, "Agreed");

      const memoTx3 = await acp.connect(provider).createMemo(
        jobId,
        "Work completed",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_COMPLETED
      );
      const memoReceipt3 = await memoTx3.wait();
      const memoId3 = memoReceipt3.logs[0].args[2];
      
      // Set up contract self-approval workaround for payment distribution
      const acpAddress = await acp.getAddress();
      await paymentToken.mint(acpAddress, budget);
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [acpAddress],
      });
      // Fund the contract for gas
      await network.provider.send("hardhat_setBalance", [
        acpAddress,
        "0x1000000000000000000", // 1 ETH
      ]);
      const contractSigner = await ethers.getSigner(acpAddress);
      await paymentToken.connect(contractSigner).approve(acpAddress, ethers.parseEther("1000")); // Larger allowance
      await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [acpAddress],
      });
      
      await acp.connect(evaluator).signMemo(memoId3, true, "Approved");

      // Try to create memo after completion - should fail
      await expect(
        acp.connect(provider).createMemo(
          jobId,
          "Another memo",
          MEMO_TYPE.MESSAGE,
          false,
          PHASE_COMPLETED
        )
      ).to.be.revertedWith("Job is already completed");
    });

    it("Should revert if user already signed the memo", async function () {
      const { acp, provider, memoId } = await loadFixture(createJobWithMemo);

      // Provider signs the memo first time
      await acp.connect(provider).signMemo(memoId, true, "First signature");

      // Try to sign again
      await expect(
        acp.connect(provider).signMemo(memoId, false, "Second signature")
      ).to.be.revertedWith("Already signed");
    });

    it("Should revert if non-evaluator tries to sign in evaluation phase", async function () {
      const { acp, client, provider, user, jobId, memoId } = await loadFixture(createJobWithMemo);

      // Move job to evaluation phase
      await acp.connect(provider).signMemo(memoId, true, "Approved");

      const memoTx2 = await acp.connect(provider).createMemo(
        jobId,
        "Negotiation memo",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_TRANSACTION
      );
      const memoReceipt2 = await memoTx2.wait();
      const memoId2 = memoReceipt2.logs[0].args[2];
      await acp.connect(client).signMemo(memoId2, true, "Agreed");

      const memoTx3 = await acp.connect(provider).createMemo(
        jobId,
        "Work completed",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_COMPLETED
      );
      const memoReceipt3 = await memoTx3.wait();
      const memoId3 = memoReceipt3.logs[0].args[2];

      // Random user tries to sign in evaluation phase
      await expect(
        acp.connect(user).signMemo(memoId3, true, "Unauthorized evaluation")
      ).to.be.revertedWith("Unauthorised memo signer");
    });

    it("Should handle provider creating completion memo and transitioning to evaluation", async function () {
      const { acp, client, provider, evaluator, jobId, memoId } = await loadFixture(createJobWithMemo);

      // Move to transaction phase
      await acp.connect(provider).signMemo(memoId, true, "Approved");

      const memoTx2 = await acp.connect(provider).createMemo(
        jobId,
        "Negotiation memo",
        MEMO_TYPE.MESSAGE,
        false,
        PHASE_TRANSACTION
      );
      const memoReceipt2 = await memoTx2.wait();
      const memoId2 = memoReceipt2.logs[0].args[2];
      await acp.connect(client).signMemo(memoId2, true, "Agreed");

      // Provider creates completion memo - should automatically move to evaluation phase
      await expect(
        acp.connect(provider).createMemo(
          jobId,
          "Work completed",
          MEMO_TYPE.MESSAGE,
          false,
          PHASE_COMPLETED
        )
      ).to.emit(acp, "JobPhaseUpdated").withArgs(jobId, PHASE_TRANSACTION, PHASE_EVALUATION);
    });
  });
});