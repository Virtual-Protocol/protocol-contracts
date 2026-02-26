/*
Test veVirtual contract with CumulativeMerkleDrop for eco traders functionality
*/
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther, formatEther } = ethers;
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { upgrades } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

describe("veVirtual - Eco Traders with CumulativeMerkleDrop", function () {
  let virtual, veVirtual, cumulativeMerkleDrop;
  let deployer, user1, user2, user3, beOpsWallet;
  let merkleTree, merkleRoot, accounts, amounts, hashedElements;

  // Helper function to get proof for an account and cumulative amount
  function getProof(account, cumulativeAmount) {
    // Create the leaf hash (matching contract's keccak256(abi.encodePacked(account, cumulativeAmount)))
    // Use ethers.solidityPacked to match contract's abi.encodePacked
    const packed = ethers.solidityPacked(
      ["address", "uint256"],
      [account, cumulativeAmount]
    );
    const leafHash = keccak256(Buffer.from(packed.slice(2), "hex"));

    // Find the index of this leaf in the hashed elements
    const leafHashHex = "0x" + leafHash.toString("hex");
    const index = hashedElements.findIndex(
      (hash) =>
        "0x" + hash.toString("hex").toLowerCase() === leafHashHex.toLowerCase()
    );

    if (index === -1) return null;

    // Get proof from merkle tree
    return merkleTree.getHexProof(hashedElements[index]);
  }

  before(async function () {
    [deployer, user1, user2, user3, beOpsWallet] = await ethers.getSigners();
  });

  beforeEach(async function () {
    // Deploy VirtualToken
    virtual = await ethers.deployContract("VirtualToken", [
      parseEther("1000000000"),
      deployer.address,
    ]);

    // Deploy veVirtual as upgradeable proxy
    const veVirtualContract = await ethers.getContractFactory("veVirtual");
    veVirtual = await upgrades.deployProxy(
      veVirtualContract,
      [virtual.target, 104],
      { initializer: "initialize" }
    );

    // Deploy CumulativeMerkleDrop
    const CumulativeMerkleDropFactory = await ethers.getContractFactory(
      "CumulativeMerkleDrop"
    );
    cumulativeMerkleDrop = await CumulativeMerkleDropFactory.deploy(
      virtual.target,
      veVirtual.target
    );
    await cumulativeMerkleDrop.waitForDeployment();

    // Transfer tokens to test accounts
    await virtual.transfer(user1.address, parseEther("100000"));
    await virtual.transfer(user2.address, parseEther("100000"));
    await virtual.transfer(user3.address, parseEther("100000"));
    await virtual.transfer(beOpsWallet.address, parseEther("1000000"));

    // Transfer tokens to CumulativeMerkleDrop contract (simulating backend injection)
    // user1: 1 token, user2: 2 tokens, user3: 3 tokens = 6 tokens total
    await virtual.transfer(cumulativeMerkleDrop.target, parseEther("10"));

    // Generate merkle tree
    // Cumulative amounts: user1 = 1, user2 = 2, user3 = 3
    // Format: address (without 0x) + amount in hex (64 chars padded)
    accounts = [user1.address, user2.address, user3.address];
    amounts = [parseEther("1"), parseEther("2"), parseEther("3")];

    // Create elements using ethers.solidityPacked to match contract's abi.encodePacked
    const elements = accounts.map((account, i) => {
      return ethers.solidityPacked(
        ["address", "uint256"],
        [account, amounts[i]]
      );
    });

    // Hash elements and create merkle tree
    hashedElements = elements.map((element) =>
      keccak256(Buffer.from(element.slice(2), "hex"))
    );
    merkleTree = new MerkleTree(hashedElements, keccak256, {
      hashLeaves: false, // Already hashed
      sortPairs: true, // Sort pairs for consistent ordering
    });

    merkleRoot = merkleTree.getHexRoot();

    // Set merkle root in contract
    await cumulativeMerkleDrop.setMerkleRoot(merkleRoot);
  });

  describe("Happy Path - claimAndMaxStake", function () {
    it("should allow beOpsWallet to claimAndMaxStake for user2 and user3, and user1 to claimAndMaxStake for themselves", async function () {
      // 1. beOpsWallet claims for user2
      const proof2 = getProof(user2.address, parseEther("2"));
      await cumulativeMerkleDrop
        .connect(beOpsWallet)
        .claimAndMaxStake(user2.address, parseEther("2"), merkleRoot, proof2);

      // 2. beOpsWallet claims for user3
      const proof3 = getProof(user3.address, parseEther("3"));
      await cumulativeMerkleDrop
        .connect(beOpsWallet)
        .claimAndMaxStake(user3.address, parseEther("3"), merkleRoot, proof3);

      // 3. user1 claims for themselves
      const proof1 = getProof(user1.address, parseEther("1"));
      await cumulativeMerkleDrop
        .connect(user1)
        .claimAndMaxStake(user1.address, parseEther("1"), merkleRoot, proof1);

      // 4. Verify all users have eco locks (using ecoLocks mapping, not getPositions)
      const lock1 = await veVirtual.ecoLocks(user1.address);
      const lock2 = await veVirtual.ecoLocks(user2.address);
      const lock3 = await veVirtual.ecoLocks(user3.address);

      // Verify eco locks exist (id should be > 0)
      expect(lock1.id).to.be.greaterThan(0);
      expect(lock2.id).to.be.greaterThan(0);
      expect(lock3.id).to.be.greaterThan(0);

      // All should have autoRenew = true
      expect(lock1.autoRenew).to.be.equal(true);
      expect(lock2.autoRenew).to.be.equal(true);
      expect(lock3.autoRenew).to.be.equal(true);

      // All should have maxWeeks (104)
      expect(lock1.numWeeks).to.be.equal(104);
      expect(lock2.numWeeks).to.be.equal(104);
      expect(lock3.numWeeks).to.be.equal(104);

      // Verify amounts
      expect(lock1.amount).to.be.equal(parseEther("1"));
      expect(lock2.amount).to.be.equal(parseEther("2"));
      expect(lock3.amount).to.be.equal(parseEther("3"));

      // 6. Verify balances
      expect(await veVirtual.balanceOf(user1.address)).to.be.equal(
        parseEther("1")
      );
      expect(await veVirtual.balanceOf(user2.address)).to.be.equal(
        parseEther("2")
      );
      expect(await veVirtual.balanceOf(user3.address)).to.be.equal(
        parseEther("3")
      );

      // 7. Verify users cannot withdraw eco locks
      // Eco locks are not in locks[] array, so withdraw will fail with "Lock not found"
      await expect(
        veVirtual.connect(user1).withdraw(lock1.id)
      ).to.be.revertedWith("Lock not found");

      await expect(
        veVirtual.connect(user2).withdraw(lock2.id)
      ).to.be.revertedWith("Lock not found");

      await expect(
        veVirtual.connect(user3).withdraw(lock3.id)
      ).to.be.revertedWith("Lock not found");

      // 8. Verify users cannot extend eco locks
      // Eco locks are not in locks[] array, so extend will fail with "Lock not found"
      await expect(
        veVirtual.connect(user1).extend(lock1.id, 1)
      ).to.be.revertedWith("Lock not found");

      await expect(
        veVirtual.connect(user2).extend(lock2.id, 1)
      ).to.be.revertedWith("Lock not found");

      await expect(
        veVirtual.connect(user3).extend(lock3.id, 1)
      ).to.be.revertedWith("Lock not found");

      // 9. Verify users cannot toggle autoRenew for eco locks
      // Eco locks are not in locks[] array, so toggleAutoRenew will fail with "Lock not found"
      await expect(
        veVirtual.connect(user1).toggleAutoRenew(lock1.id)
      ).to.be.revertedWith("Lock not found");

      await expect(
        veVirtual.connect(user2).toggleAutoRenew(lock2.id)
      ).to.be.revertedWith("Lock not found");

      await expect(
        veVirtual.connect(user3).toggleAutoRenew(lock3.id)
      ).to.be.revertedWith("Lock not found");
    });

    it("should prevent double claiming", async function () {
      // User1 claims first time
      const proof1 = getProof(user1.address, parseEther("1"));
      await cumulativeMerkleDrop
        .connect(user1)
        .claimAndMaxStake(user1.address, parseEther("1"), merkleRoot, proof1);

      // Try to claim again (should fail)
      await expect(
        cumulativeMerkleDrop
          .connect(user1)
          .claimAndMaxStake(user1.address, parseEther("1"), merkleRoot, proof1)
      ).to.be.revertedWithCustomError(cumulativeMerkleDrop, "NothingToClaim");
    });

    it("should allow cumulative claiming", async function () {
      // First claim: user1 claims 1 token
      const proof1 = getProof(user1.address, parseEther("1"));
      await cumulativeMerkleDrop
        .connect(user1)
        .claimAndMaxStake(user1.address, parseEther("1"), merkleRoot, proof1);

      // Update merkle root with new cumulative amount (user1 now has 2 total)
      const newAccounts = [user1.address, user2.address, user3.address];
      const newAmounts = [parseEther("2"), parseEther("2"), parseEther("3")];

      // Create new elements using ethers.solidityPacked
      const newElements = newAccounts.map((account, i) => {
        return ethers.solidityPacked(
          ["address", "uint256"],
          [account, newAmounts[i]]
        );
      });

      // Create new merkle tree
      const newHashedElements = newElements.map((element) =>
        keccak256(Buffer.from(element.slice(2), "hex"))
      );
      const newMerkleTree = new MerkleTree(newHashedElements, keccak256, {
        hashLeaves: false,
        sortPairs: true,
      });
      const newMerkleRoot = newMerkleTree.getHexRoot();

      // Transfer more tokens to contract
      await virtual.transfer(cumulativeMerkleDrop.target, parseEther("1"));
      await cumulativeMerkleDrop.setMerkleRoot(newMerkleRoot);

      // Helper function for new tree
      function getProofForNewTree(account, cumulativeAmount) {
        const packed = ethers.solidityPacked(
          ["address", "uint256"],
          [account, cumulativeAmount]
        );
        const leafHash = keccak256(Buffer.from(packed.slice(2), "hex"));
        const leafHashHex = "0x" + leafHash.toString("hex");
        const index = newHashedElements.findIndex(
          (hash) =>
            "0x" + hash.toString("hex").toLowerCase() ===
            leafHashHex.toLowerCase()
        );
        if (index === -1) return null;
        return newMerkleTree.getHexProof(newHashedElements[index]);
      }

      // Second claim: user1 claims additional 1 token (cumulative = 2)
      const proof2 = getProofForNewTree(user1.address, parseEther("2"));
      await cumulativeMerkleDrop
        .connect(user1)
        .claimAndMaxStake(
          user1.address,
          parseEther("2"),
          newMerkleRoot,
          proof2
        );

      // Verify user1 now has 2 tokens staked in the same eco lock (amount should be accumulated)
      const ecoLock = await veVirtual.ecoLocks(user1.address);
      expect(ecoLock.amount).to.be.equal(parseEther("2"));

      const totalBalance = await veVirtual.balanceOf(user1.address);
      expect(totalBalance).to.be.equal(parseEther("2"));

      // Should still have only 1 eco lock (not 2 separate locks)
      // Eco locks are stored in ecoLocks mapping, not in locks[] array
      const positions = await veVirtual.getPositions(user1.address, 0, 10);
      // getPositions returns array with length matching count parameter, but only fills valid positions
      // Since there are no regular locks, all positions will be empty (default values)
      // We need to check the actual number of positions using numPositions
      const numPositions = await veVirtual.numPositions(user1.address);
      expect(numPositions).to.be.equal(0); // Eco locks are not in locks[] array
    });

    it("should verify balance does not decay for eco locks (autoRenew = true)", async function () {
      const proof1 = getProof(user1.address, parseEther("1"));
      await cumulativeMerkleDrop
        .connect(user1)
        .claimAndMaxStake(user1.address, parseEther("1"), merkleRoot, proof1);

      const initialBalance = await veVirtual.balanceOf(user1.address);
      expect(initialBalance).to.be.equal(parseEther("1"));

      // Wait 52 weeks (half of maxWeeks)
      await time.increase(52 * 7 * 24 * 60 * 60);

      // Balance should not decay because autoRenew = true
      const balanceAfter = await veVirtual.balanceOf(user1.address);
      expect(balanceAfter).to.be.equal(parseEther("1"));
    });

    it("should verify voting power is correctly assigned", async function () {
      const proof1 = getProof(user1.address, parseEther("1"));
      const proof2 = getProof(user2.address, parseEther("2"));
      const proof3 = getProof(user3.address, parseEther("3"));

      await cumulativeMerkleDrop
        .connect(user1)
        .claimAndMaxStake(user1.address, parseEther("1"), merkleRoot, proof1);
      await cumulativeMerkleDrop
        .connect(beOpsWallet)
        .claimAndMaxStake(user2.address, parseEther("2"), merkleRoot, proof2);
      await cumulativeMerkleDrop
        .connect(beOpsWallet)
        .claimAndMaxStake(user3.address, parseEther("3"), merkleRoot, proof3);

      // Delegate voting power
      await veVirtual.connect(user1).delegate(user1.address);
      await veVirtual.connect(user2).delegate(user2.address);
      await veVirtual.connect(user3).delegate(user3.address);

      // Verify voting power
      expect(await veVirtual.getVotes(user1.address)).to.be.equal(
        parseEther("1")
      );
      expect(await veVirtual.getVotes(user2.address)).to.be.equal(
        parseEther("2")
      );
      expect(await veVirtual.getVotes(user3.address)).to.be.equal(
        parseEther("3")
      );
    });
  });

  describe("Basic Regression Tests", function () {
    it("should allow regular staking", async function () {
      await virtual
        .connect(user1)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(user1).stake(parseEther("100"), 104, true);

      expect(await veVirtual.numPositions(user1.address)).to.be.equal(1);
      expect(await veVirtual.balanceOf(user1.address)).to.be.equal(
        parseEther("100")
      );
    });

    it("should allow mixing regular locks and eco locks", async function () {
      // Regular stake
      await virtual
        .connect(user1)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(user1).stake(parseEther("100"), 104, true);

      // Eco lock via claimAndMaxStake
      const proof1 = getProof(user1.address, parseEther("1"));
      await cumulativeMerkleDrop
        .connect(user1)
        .claimAndMaxStake(user1.address, parseEther("1"), merkleRoot, proof1);

      // Should have 1 regular lock in positions array
      const numPositions = await veVirtual.numPositions(user1.address);
      expect(numPositions).to.be.equal(1);

      const positions = await veVirtual.getPositions(user1.address, 0, 10);
      // getPositions returns array with requested count, but we check numPositions for actual count

      // Regular lock should be in positions array
      expect(positions[0].amount).to.be.equal(parseEther("100"));

      // Eco lock should be in ecoLocks mapping (not in positions array)
      const ecoLock = await veVirtual.ecoLocks(user1.address);
      expect(ecoLock.id).to.be.greaterThan(0);
      expect(ecoLock.amount).to.be.equal(parseEther("1"));

      // Total balance should be sum of regular lock + eco lock
      const totalBalance = await veVirtual.balanceOf(user1.address);
      expect(totalBalance).to.be.equal(parseEther("101"));
    });
  });

  describe("Error Cases", function () {
    it("should reject invalid merkle proof", async function () {
      const invalidProof = [ethers.ZeroHash, ethers.ZeroHash];

      await expect(
        cumulativeMerkleDrop
          .connect(user1)
          .claimAndMaxStake(
            user1.address,
            parseEther("1"),
            merkleRoot,
            invalidProof
          )
      ).to.be.revertedWithCustomError(cumulativeMerkleDrop, "InvalidProof");
    });

    it("should reject claim with wrong merkle root", async function () {
      const proof1 = getProof(user1.address, parseEther("1"));
      const wrongRoot = ethers.ZeroHash;

      await expect(
        cumulativeMerkleDrop
          .connect(user1)
          .claimAndMaxStake(user1.address, parseEther("1"), wrongRoot, proof1)
      ).to.be.revertedWithCustomError(
        cumulativeMerkleDrop,
        "MerkleRootWasUpdated"
      );
    });

    it("should reject claim when merkle root changes", async function () {
      const proof1 = getProof(user1.address, parseEther("1"));

      // Change merkle root
      const newAccounts = [user1.address, user2.address, user3.address];
      const newAmounts = [parseEther("2"), parseEther("2"), parseEther("3")];
      const newElements = newAccounts.map((account, i) => {
        return ethers.solidityPacked(
          ["address", "uint256"],
          [account, newAmounts[i]]
        );
      });
      const newHashedElements = newElements.map((element) =>
        keccak256(Buffer.from(element.slice(2), "hex"))
      );
      const newMerkleTree = new MerkleTree(newHashedElements, keccak256, {
        hashLeaves: false,
        sortPairs: true,
      });
      const newMerkleRoot = newMerkleTree.getHexRoot();
      await cumulativeMerkleDrop.setMerkleRoot(newMerkleRoot);

      // Try to claim with old proof and old root
      await expect(
        cumulativeMerkleDrop.connect(user1).claimAndMaxStake(
          user1.address,
          parseEther("1"),
          merkleRoot, // old root
          proof1
        )
      ).to.be.revertedWithCustomError(
        cumulativeMerkleDrop,
        "MerkleRootWasUpdated"
      );
    });
  });
});
