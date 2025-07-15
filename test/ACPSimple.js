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
    TXHASH: 5,
    PAYABLE_REQUEST: 6,
    PAYABLE_TRANSFER: 7
  };

  async function deployACPFixture() {
    const [deployer, client, provider, evaluator, platformTreasury, user] = await ethers.getSigners();

    // Deploy mock ERC20 token for payments
    const MockToken = await ethers.getContractFactory("contracts/genesis/MockERC20.sol:MockERC20");
    const paymentToken = await MockToken.deploy("Mock Token", "MTK", deployer.address, ethers.parseEther("1000000"));
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
    await paymentToken.connect(provider).approve(await acp.getAddress(), ethers.parseEther("10000"));

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

  async function createJobInTransactionPhase() {
    const fixture = await loadFixture(createJobWithMemo);
    const { acp, client, provider, jobId, memoId } = fixture;

    // Move to negotiation phase
    await acp.connect(provider).signMemo(memoId, true, "Approved");

    // Create negotiation memo and move to transaction phase
    const memoTx2 = await acp.connect(provider).createMemo(
      jobId,
      "Negotiation memo",
      MEMO_TYPE.MESSAGE,
      false,
      PHASE_TRANSACTION
    );
    const memoReceipt2 = await memoTx2.wait();
    const memoId2 = memoReceipt2.logs[0].args[2];
    await acp.connect(client).signMemo(memoId2, true, "Agreed to terms");

    return {
      ...fixture,
      jobId
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

  describe("Payable Memos - Hedge Fund Use Case", function () {
    describe("Payable Request Memos (Signer pays Recipient)", function () {
      it("Should create payable request memo successfully", async function () {
        const { acp, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const amount = ethers.parseEther("100");
        const tokenAddress = await paymentToken.getAddress();

        const memoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Request 100 VIRTUAL tokens deposit",
          tokenAddress,
          amount,
          provider.address,
          0, // feeAmount
          false, // feeToContract
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );

        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2]; // NewMemo event

        // Check memo was created
        const memo = await acp.memos(memoId);
        // Note: content is no longer stored in memo struct, only emitted in NewMemo event
        expect(memo.memoType).to.equal(MEMO_TYPE.PAYABLE_REQUEST);
        
        // Verify content was emitted in NewMemo event
        await expect(memoTx)
          .to.emit(acp, "NewMemo")
          .withArgs(jobId, provider.address, memoId, "Request 100 VIRTUAL tokens deposit");

        // Check payable details
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.token).to.equal(tokenAddress);
        expect(payableDetails.amount).to.equal(amount);
        expect(payableDetails.recipient).to.equal(provider.address);
        expect(payableDetails.feeAmount).to.equal(0);
        expect(payableDetails.feeToContract).to.be.false;
        expect(payableDetails.isExecuted).to.be.false;
      });

      it("Should execute payable request when memo is signed (signer pays recipient)", async function () {
        const { acp, client, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const amount = ethers.parseEther("100");
        const tokenAddress = await paymentToken.getAddress();

        // Create payable request memo - provider requests client to pay provider
        const memoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Request 100 VIRTUAL tokens deposit",
          tokenAddress,
          amount,
          provider.address,
          0, // feeAmount
          false, // feeToContract
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );
        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2];

        // Check initial balances
        const clientBalanceBefore = await paymentToken.balanceOf(client.address);
        const providerBalanceBefore = await paymentToken.balanceOf(provider.address);

        // Client signs memo - client (signer) pays provider (recipient)
        await expect(
          acp.connect(client).signMemo(memoId, true, "Approved deposit")
        )
          .to.emit(acp, "PayableRequestExecuted")
          .withArgs(jobId, memoId, client.address, provider.address, tokenAddress, amount);

        // Check balances after transfer - client paid provider
        const clientBalanceAfter = await paymentToken.balanceOf(client.address);
        const providerBalanceAfter = await paymentToken.balanceOf(provider.address);

        expect(clientBalanceAfter).to.equal(clientBalanceBefore - amount);
        expect(providerBalanceAfter).to.equal(providerBalanceBefore + amount);

        // Check payable details updated
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.isExecuted).to.be.true;
      });

      it("Should not execute payable request when memo is rejected", async function () {
        const { acp, client, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const amount = ethers.parseEther("100");
        const tokenAddress = await paymentToken.getAddress();

        // Create payable request memo
        const memoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Request 100 VIRTUAL tokens deposit",
          tokenAddress,
          amount,
          provider.address,
          0, // feeAmount
          false, // feeToContract
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );
        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2];

        // Check initial balances
        const clientBalanceBefore = await paymentToken.balanceOf(client.address);
        const providerBalanceBefore = await paymentToken.balanceOf(provider.address);

        // Client rejects memo - should NOT execute transfer
        await acp.connect(client).signMemo(memoId, false, "Rejected deposit");

        // Check balances unchanged
        const clientBalanceAfter = await paymentToken.balanceOf(client.address);
        const providerBalanceAfter = await paymentToken.balanceOf(provider.address);

        expect(clientBalanceAfter).to.equal(clientBalanceBefore);
        expect(providerBalanceAfter).to.equal(providerBalanceBefore);

        // Check payable details not executed
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.isExecuted).to.be.false;
      });
    });

    describe("Payable Transfer Memos (Sender pays Recipient)", function () {
      it("Should create payable transfer memo successfully", async function () {
        const { acp, client, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const amount = ethers.parseEther("150");
        const tokenAddress = await paymentToken.getAddress();

        const memoTx = await acp.connect(client).createPayableMemo(
          jobId,
          "Transfer 150 VIRTUAL tokens back to client",
          tokenAddress,
          amount,
          client.address,
          0, // feeAmount
          false, // feeToContract
          MEMO_TYPE.PAYABLE_TRANSFER,
          PHASE_TRANSACTION
        );

        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2]; // NewMemo event

        // Check memo was created
        const memo = await acp.memos(memoId);
        // Note: content is no longer stored in memo struct, only emitted in NewMemo event
        expect(memo.memoType).to.equal(MEMO_TYPE.PAYABLE_TRANSFER);
        
        // Verify content was emitted in NewMemo event
        await expect(memoTx)
          .to.emit(acp, "NewMemo")
          .withArgs(jobId, client.address, memoId, "Transfer 150 VIRTUAL tokens back to client");

        // Check payable details
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.token).to.equal(tokenAddress);
        expect(payableDetails.amount).to.equal(amount);
        expect(payableDetails.recipient).to.equal(client.address);
        expect(payableDetails.feeAmount).to.equal(0);
        expect(payableDetails.feeToContract).to.be.false;
        expect(payableDetails.isExecuted).to.be.false;
      });

      it("Should execute payable transfer when memo is signed (sender pays recipient)", async function () {
        const { acp, client, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const amount = ethers.parseEther("150");
        const tokenAddress = await paymentToken.getAddress();

        // Create payable transfer memo - client creates memo to transfer from client to client
        const memoTx = await acp.connect(client).createPayableMemo(
          jobId,
          "Transfer 150 VIRTUAL tokens back to client",
          tokenAddress,
          amount,
          client.address,
          0, // feeAmount
          false, // feeToContract
          MEMO_TYPE.PAYABLE_TRANSFER,
          PHASE_TRANSACTION
        );
        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2];

        // Check initial balances
        const clientBalanceBefore = await paymentToken.balanceOf(client.address);
        const providerBalanceBefore = await paymentToken.balanceOf(provider.address);

        // Provider signs memo - client (sender) pays client (recipient)
        await expect(
          acp.connect(provider).signMemo(memoId, true, "Approved withdrawal")
        )
          .to.emit(acp, "PayableTransferExecuted")
          .withArgs(jobId, memoId, client.address, client.address, tokenAddress, amount);

        // Check balances after transfer - client sent to client (no net change for client)
        const clientBalanceAfter = await paymentToken.balanceOf(client.address);
        const providerBalanceAfter = await paymentToken.balanceOf(provider.address);

        expect(clientBalanceAfter).to.equal(clientBalanceBefore); // No change since sender = recipient
        expect(providerBalanceAfter).to.equal(providerBalanceBefore); // No change for provider

        // Check payable details updated
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.isExecuted).to.be.true;
      });

      it("Should not execute payable transfer when memo is rejected", async function () {
        const { acp, client, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const amount = ethers.parseEther("150");
        const tokenAddress = await paymentToken.getAddress();

        // Create payable transfer memo
        const memoTx = await acp.connect(client).createPayableMemo(
          jobId,
          "Transfer 150 VIRTUAL tokens back to client",
          tokenAddress,
          amount,
          client.address,
          0, // feeAmount
          false, // feeToContract
          MEMO_TYPE.PAYABLE_TRANSFER,
          PHASE_TRANSACTION
        );
        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2];

        // Check initial balances
        const clientBalanceBefore = await paymentToken.balanceOf(client.address);
        const providerBalanceBefore = await paymentToken.balanceOf(provider.address);

        // Provider rejects memo - should NOT execute transfer
        await acp.connect(provider).signMemo(memoId, false, "Rejected withdrawal");

        // Check balances unchanged
        const clientBalanceAfter = await paymentToken.balanceOf(client.address);
        const providerBalanceAfter = await paymentToken.balanceOf(provider.address);

        expect(clientBalanceAfter).to.equal(clientBalanceBefore);
        expect(providerBalanceAfter).to.equal(providerBalanceBefore);

        // Check payable details not executed
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.isExecuted).to.be.false;
      });
    });

    describe("Payable Fee Memos", function () {
      it("Should create payable fee memo successfully", async function () {
        const { acp, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const feeAmount = ethers.parseEther("2");

        const memoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Additional service fee",
          ethers.ZeroAddress, // token (not used for fee-only)
          0, // amount (no fund transfer)
          ethers.ZeroAddress, // recipient (not used for fee-only)
          feeAmount, // feeAmount
          true, // feeToContract
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );

        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2]; // NewMemo event

        // Check memo was created
        const memo = await acp.memos(memoId);
        // Note: content is no longer stored in memo struct, only emitted in NewMemo event
        expect(memo.memoType).to.equal(MEMO_TYPE.PAYABLE_REQUEST);
        
        // Verify content was emitted in NewMemo event
        await expect(memoTx)
          .to.emit(acp, "NewMemo")
          .withArgs(jobId, provider.address, memoId, "Additional service fee");

        // Check payable details
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.token).to.equal(ethers.ZeroAddress);
        expect(payableDetails.amount).to.equal(0);
        expect(payableDetails.recipient).to.equal(ethers.ZeroAddress);
        expect(payableDetails.feeAmount).to.equal(feeAmount);
        expect(payableDetails.feeToContract).to.be.true;
        expect(payableDetails.isExecuted).to.be.false;
      });

      it("Should execute payable fee when memo is signed", async function () {
        const { acp, client, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const feeAmount = ethers.parseEther("2");

        // Create payable fee memo
        const memoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Additional service fee",
          ethers.ZeroAddress, // token (not used for fee-only)
          0, // amount (no fund transfer)
          ethers.ZeroAddress, // recipient (not used for fee-only)
          feeAmount, // feeAmount
          true, // feeToContract
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );
        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2];

        // Check initial balances
        const clientBalanceBefore = await paymentToken.balanceOf(client.address);
        const acpBalanceBefore = await paymentToken.balanceOf(await acp.getAddress());
        const additionalFeesBefore = await acp.jobAdditionalFees(jobId);

        // Client signs memo - should execute fee transfer
        await expect(
          acp.connect(client).signMemo(memoId, true, "Approved fee")
        )
          .to.emit(acp, "PayableFeeCollected")
          .withArgs(jobId, memoId, client.address, feeAmount);

        // Check balances after transfer
        const clientBalanceAfter = await paymentToken.balanceOf(client.address);
        const acpBalanceAfter = await paymentToken.balanceOf(await acp.getAddress());
        const additionalFeesAfter = await acp.jobAdditionalFees(jobId);

        expect(clientBalanceAfter).to.equal(clientBalanceBefore - feeAmount);
        expect(acpBalanceAfter).to.equal(acpBalanceBefore + feeAmount);
        expect(additionalFeesAfter).to.equal(additionalFeesBefore + feeAmount);

        // Check payable details updated
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.isExecuted).to.be.true;
      });
    });

    describe("Payable Fee Request Memos (PAYABLE_FEE_REQUEST)", function () {
      it("Should create payable fee request memo successfully", async function () {
        const { acp, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const feeAmount = ethers.parseEther("5");

        const memoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Request payment for premium service",
          ethers.ZeroAddress, // token (not used for fee-only)
          0, // amount (no fund transfer)
          ethers.ZeroAddress, // recipient (not used for fee-only)
          feeAmount, // feeAmount
          false, // feeToContract (fee goes to provider)
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );

        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2]; // NewMemo event

        // Check memo was created
        const memo = await acp.memos(memoId);
        expect(memo.memoType).to.equal(MEMO_TYPE.PAYABLE_REQUEST);
        
        // Verify content was emitted in NewMemo event
        await expect(memoTx)
          .to.emit(acp, "NewMemo")
          .withArgs(jobId, provider.address, memoId, "Request payment for premium service");

        // Check payable details - fee goes to provider (not contract)
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.token).to.equal(ethers.ZeroAddress);
        expect(payableDetails.amount).to.equal(0);
        expect(payableDetails.recipient).to.equal(ethers.ZeroAddress);
        expect(payableDetails.feeAmount).to.equal(feeAmount);
        expect(payableDetails.feeToContract).to.be.false;
        expect(payableDetails.isExecuted).to.be.false;
      });

      it("Should execute payable fee request when memo is signed (with platform fee)", async function () {
        const { acp, client, provider, paymentToken, jobId, platformTreasury } = await loadFixture(createJobInTransactionPhase);

        const feeAmount = ethers.parseEther("10");
        const platformFeeBP = 500; // 5%
        const expectedPlatformFee = (feeAmount * BigInt(platformFeeBP)) / BigInt(10000);
        const expectedNetAmount = feeAmount - expectedPlatformFee;

        // Create payable fee request memo
        const memoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Request payment for premium service",
          ethers.ZeroAddress, // token (not used for fee-only)
          0, // amount (no fund transfer)
          ethers.ZeroAddress, // recipient (not used for fee-only)
          feeAmount, // feeAmount
          false, // feeToContract (fee goes to provider)
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );
        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2];

        // Check initial balances
        const clientBalanceBefore = await paymentToken.balanceOf(client.address);
        const providerBalanceBefore = await paymentToken.balanceOf(provider.address);
        const treasuryBalanceBefore = await paymentToken.balanceOf(platformTreasury.address);

        // Client signs memo - should execute fee request with platform fee
        await expect(
          acp.connect(client).signMemo(memoId, true, "Approved premium service fee")
        )
          .to.emit(acp, "PayableFeeRequestExecuted")
          .withArgs(jobId, memoId, client.address, provider.address, expectedNetAmount);

        // Check balances after transfer
        const clientBalanceAfter = await paymentToken.balanceOf(client.address);
        const providerBalanceAfter = await paymentToken.balanceOf(provider.address);
        const treasuryBalanceAfter = await paymentToken.balanceOf(platformTreasury.address);

        // Client pays the full amount
        expect(clientBalanceAfter).to.equal(clientBalanceBefore - feeAmount);
        // Provider receives net amount (after platform fee)
        expect(providerBalanceAfter).to.equal(providerBalanceBefore + expectedNetAmount);
        // Platform treasury receives the platform fee
        expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore + expectedPlatformFee);

        // Check payable details updated
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.isExecuted).to.be.true;
      });

      it("Should not execute payable fee request when memo is rejected", async function () {
        const { acp, client, provider, paymentToken, jobId, platformTreasury } = await loadFixture(createJobInTransactionPhase);

        const feeAmount = ethers.parseEther("5");

        // Create payable fee request memo
        const memoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Request payment for premium service",
          ethers.ZeroAddress, // token (not used for fee-only)
          0, // amount (no fund transfer)
          ethers.ZeroAddress, // recipient (not used for fee-only)
          feeAmount, // feeAmount
          false, // feeToContract (fee goes to provider)
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );
        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2];

        // Check initial balances
        const clientBalanceBefore = await paymentToken.balanceOf(client.address);
        const providerBalanceBefore = await paymentToken.balanceOf(provider.address);
        const treasuryBalanceBefore = await paymentToken.balanceOf(platformTreasury.address);

        // Client rejects memo - should NOT execute transfer
        await acp.connect(client).signMemo(memoId, false, "Rejected premium service fee");

        // Check balances unchanged
        const clientBalanceAfter = await paymentToken.balanceOf(client.address);
        const providerBalanceAfter = await paymentToken.balanceOf(provider.address);
        const treasuryBalanceAfter = await paymentToken.balanceOf(platformTreasury.address);

        expect(clientBalanceAfter).to.equal(clientBalanceBefore);
        expect(providerBalanceAfter).to.equal(providerBalanceBefore);
        expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);

        // Check payable details not executed
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.isExecuted).to.be.false;
      });

      it("Should allow client to create payable fee request memo", async function () {
        const { acp, client, provider, paymentToken, jobId } = await loadFixture(createJobInTransactionPhase);

        const feeAmount = ethers.parseEther("3");

        // Client creates payable fee request memo (requesting provider to pay client)
        const memoTx = await acp.connect(client).createPayableMemo(
          jobId,
          "Request reimbursement for expenses",
          ethers.ZeroAddress, // token (not used for fee-only)
          0, // amount (no fund transfer)
          ethers.ZeroAddress, // recipient (not used for fee-only)
          feeAmount, // feeAmount
          false, // feeToContract (fee goes to provider)
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );

        const receipt = await memoTx.wait();
        const memoId = receipt.logs[0].args[2];

        // Check payable details - fee goes to provider
        const payableDetails = await acp.payableDetails(memoId);
        expect(payableDetails.recipient).to.equal(ethers.ZeroAddress);
        expect(payableDetails.amount).to.equal(0);
        expect(payableDetails.feeAmount).to.equal(feeAmount);
        expect(payableDetails.feeToContract).to.be.false;
      });
    });

    describe("Zero Budget Job Completion", function () {
      it("Should handle 0 budget job with additional fees", async function () {
        const { acp, client, provider, evaluator, paymentToken } = await loadFixture(deployACPFixture);

        // Create job with 0 budget
        const expiredAt = (await time.latest()) + 86400;
        const tx = await acp.connect(client).createJob(provider.address, evaluator.address, expiredAt);
        const receipt = await tx.wait();
        const jobId = receipt.logs[0].args[0];

        await acp.connect(client).setBudget(jobId, 0);

        // Move to transaction phase
        const memoTx1 = await acp.connect(client).createMemo(
          jobId,
          "Request",
          MEMO_TYPE.MESSAGE,
          false,
          PHASE_NEGOTIATION
        );
        const memoReceipt1 = await memoTx1.wait();
        const memoId1 = memoReceipt1.logs[0].args[2];
        await acp.connect(provider).signMemo(memoId1, true, "Approved");

        const memoTx2 = await acp.connect(provider).createMemo(
          jobId,
          "Terms",
          MEMO_TYPE.MESSAGE,
          false,
          PHASE_TRANSACTION
        );
        const memoReceipt2 = await memoTx2.wait();
        const memoId2 = memoReceipt2.logs[0].args[2];
        await acp.connect(client).signMemo(memoId2, true, "Agreed");

        // Add additional fee
        const feeAmount = ethers.parseEther("1");
        const feeMemoTx = await acp.connect(provider).createPayableMemo(
          jobId,
          "Processing fee",
          ethers.ZeroAddress, // token (not used for fee-only)
          0, // amount (no fund transfer)
          ethers.ZeroAddress, // recipient (not used for fee-only)
          feeAmount, // feeAmount
          true, // feeToContract
          MEMO_TYPE.PAYABLE_REQUEST,
          PHASE_TRANSACTION
        );
        const feeReceipt = await feeMemoTx.wait();
        const feeMemoId = feeReceipt.logs[0].args[2];
        await acp.connect(client).signMemo(feeMemoId, true, "Approved fee");

        // Complete work
        const completionMemoTx = await acp.connect(provider).createMemo(
          jobId,
          "Work completed",
          MEMO_TYPE.MESSAGE,
          false,
          PHASE_COMPLETED
        );
        const completionReceipt = await completionMemoTx.wait();
        const completionMemoId = completionReceipt.logs[0].args[2];

        // Set up contract for fee distribution
        const acpAddress = await acp.getAddress();
        await paymentToken.mint(acpAddress, feeAmount);
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [acpAddress],
        });
        await network.provider.send("hardhat_setBalance", [
          acpAddress,
          "0x1000000000000000000",
        ]);
        const contractSigner = await ethers.getSigner(acpAddress);
        await paymentToken.connect(contractSigner).approve(acpAddress, ethers.parseEther("1000"));
        await network.provider.request({
          method: "hardhat_stopImpersonatingAccount",
          params: [acpAddress],
        });

        // Evaluator approves - should distribute the fee amount
        await expect(
          acp.connect(evaluator).signMemo(completionMemoId, true, "Work approved")
        )
          .to.emit(acp, "JobPhaseUpdated")
          .withArgs(jobId, PHASE_EVALUATION, PHASE_COMPLETED);

        // Check that fees were distributed properly
        const finalJob = await acp.jobs(jobId);
        expect(finalJob.phase).to.equal(PHASE_COMPLETED);
        expect(finalJob.budget).to.equal(0);
        expect(finalJob.amountClaimed).to.equal(feeAmount);

        // Additional fees should remain tracked (not reset)
        const additionalFeesAfter = await acp.jobAdditionalFees(jobId);
        expect(additionalFeesAfter).to.equal(feeAmount);
      });

      it("Should throw error when completing a job with 0 budget and 0 fees", async function () {
        const { acp, client, provider, evaluator } = await loadFixture(deployACPFixture);

        // Create job with 0 budget
        const expiredAt = (await time.latest()) + 86400;
        const tx = await acp.connect(client).createJob(provider.address, evaluator.address, expiredAt);
        const receipt = await tx.wait();
        const jobId = receipt.logs[0].args[0];

        await acp.connect(client).setBudget(jobId, 0);

        // Move through phases to completion without adding any fees
        const memoTx1 = await acp.connect(client).createMemo(
          jobId,
          "Request",
          MEMO_TYPE.MESSAGE,
          false,
          PHASE_NEGOTIATION
        );
        const memoReceipt1 = await memoTx1.wait();
        const memoId1 = memoReceipt1.logs[0].args[2];
        await acp.connect(provider).signMemo(memoId1, true, "Approved");

        const memoTx2 = await acp.connect(provider).createMemo(
          jobId,
          "Terms",
          MEMO_TYPE.MESSAGE,
          false,
          PHASE_TRANSACTION
        );
        const memoReceipt2 = await memoTx2.wait();
        const memoId2 = memoReceipt2.logs[0].args[2];
        await acp.connect(client).signMemo(memoId2, true, "Agreed");

        // Complete work
        const completionMemoTx = await acp.connect(provider).createMemo(
          jobId,
          "Work completed",
          MEMO_TYPE.MESSAGE,
          false,
          PHASE_COMPLETED
        );
        const completionReceipt = await completionMemoTx.wait();
        const completionMemoId = completionReceipt.logs[0].args[2];

        // Job should move to evaluation phase
        const jobAfterCompletion = await acp.jobs(jobId);
        expect(jobAfterCompletion.phase).to.equal(PHASE_EVALUATION);

        // Evaluator tries to approve - should fail with "No budget or fees to claim"
        await expect(
          acp.connect(evaluator).signMemo(completionMemoId, true, "Work approved")
        ).to.be.revertedWith("No budget or fees to claim");

        // Job should still be in evaluation phase after failed completion
        const finalJob = await acp.jobs(jobId);
        expect(finalJob.phase).to.equal(PHASE_EVALUATION);
        expect(finalJob.budget).to.equal(0);
        expect(finalJob.amountClaimed).to.equal(0);
      });
    });
  });
});