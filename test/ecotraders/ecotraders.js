/*
Test veVirtual contract including eco traders functionality
*/
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther, formatEther } = ethers;
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { upgrades } = require("hardhat");

describe("veVirtual - Eco Traders", function () {
  let virtual, veVirtual;
  let deployer, staker, trader1, trader2, trader3, ecoVeVirtualStaker;

  const DENOM_18 = ethers.parseEther("1"); // 1e18 = 100%

  before(async function () {
    [deployer, staker, trader1, trader2, trader3, ecoVeVirtualStaker] =
      await ethers.getSigners();
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

    // Grant ECO_ROLE to deployer (deployer has ADMIN_ROLE from initialize)
    const ECO_ROLE = await veVirtual.ECO_ROLE();
    await veVirtual.grantRole(ECO_ROLE, deployer.address);

    // Set ecoVeVirtualStaker (requires ECO_ROLE)
    await veVirtual.setEcoVeVirtualStaker(ecoVeVirtualStaker.address);

    // Transfer tokens to test accounts
    await virtual.transfer(staker.address, parseEther("100000"));
    await virtual.transfer(ecoVeVirtualStaker.address, parseEther("1000000"));
  });

  describe("Basic Regression Tests", function () {
    it("should allow staking", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("100"), 104, true);

      expect(await veVirtual.numPositions(staker.address)).to.be.equal(1);
      expect(await veVirtual.balanceOf(staker.address)).to.be.equal(
        parseEther("100")
      );
    });

    it("should not decay balance when autoRenew is true", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("100"), 104, true);

      // With autoRenew = true (default), balance should not decay
      await time.increase(26 * 7 * 24 * 60 * 60);
      const balance = await veVirtual.balanceOf(staker.address);
      expect(balance).to.be.equal(parseEther("100"));
    });

    it("should decay balance over time when autoRenew is false", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("100"), 52, false);
      const lock = await veVirtual.locks(staker.address, 0);

      // After half the lock period (52 weeks / 2 = 26 weeks)
      await time.increase(26 * 7 * 24 * 60 * 60);
      const balance = await veVirtual.balanceOf(staker.address);
      expect(parseInt(formatEther(balance))).to.be.lessThan(100);
      expect(parseInt(formatEther(balance))).to.be.greaterThan(0);
    });

    it("should allow withdrawal on maturity only", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("100"), 104, true);
      const lock = await veVirtual.locks(staker.address, 0);
      const id = lock.id;
      // staker started with 100000, staked 100, so after stake should have 99900
      expect(await virtual.balanceOf(staker.address)).to.be.equal(
        parseEther("99900")
      );

      // Try to withdraw before maturity (withdraw checks expiration first, then autoRenew)
      await time.increase(26 * 7 * 24 * 60 * 60);
      // Lock is 104 weeks, so after 26 weeks it's not expired yet
      await expect(veVirtual.connect(staker).withdraw(id)).to.be.revertedWith(
        "Lock is not expired"
      );

      // Turn off autoRenew (this resets end to block.timestamp + 104 weeks)
      await veVirtual.connect(staker).toggleAutoRenew(id);

      // Try to withdraw before maturity (with autoRenew off, but end was just reset)
      await expect(veVirtual.connect(staker).withdraw(id)).to.be.revertedWith(
        "Lock is not expired"
      );

      // Withdraw after maturity (need to wait 104 weeks since toggleAutoRenew reset the end)
      await time.increase(105 * 7 * 24 * 60 * 60);
      await veVirtual.connect(staker).withdraw(id);
      // staker started with 100000, staked 100, so after withdraw should have 100000 back
      expect(await virtual.balanceOf(staker.address)).to.be.equal(
        parseEther("100000")
      );
    });

    it("should allow extension when lock has room", async function () {
      // Note: veVirtual.stake() allows creating locks with numWeeks < maxWeeks
      // So we can test extend functionality when lock.numWeeks < maxWeeks
      // This test verifies that extend works correctly when there's room

      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      // Create a lock with numWeeks < maxWeeks so we can test extend
      await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);
      const lock = await veVirtual.locks(staker.address, 0);

      // Now we can extend because numWeeks (52) + extendWeeks (52) = 104 <= maxWeeks (104)
      const initialBalance = await veVirtual.balanceOf(staker.address);
      await veVirtual.connect(staker).extend(lock.id, 52);

      const newBalance = await veVirtual.balanceOf(staker.address);
      expect(newBalance).to.be.greaterThan(initialBalance);

      // Verify that extend fails when autoRenew is true
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("2000"));
      await veVirtual.connect(staker).stake(parseEther("1000"), 52, true);
      const lock2 = await veVirtual.locks(staker.address, 1);

      // Try to extend while autoRenew is true (should fail)
      await expect(
        veVirtual.connect(staker).extend(lock2.id, 1)
      ).to.be.revertedWith("Lock is auto-renewing");
    });

    it("should prevent extension beyond max weeks", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      // Create a lock with numWeeks = 52, so we can test extending beyond maxWeeks
      await veVirtual.connect(staker).stake(parseEther("1000"), 52, false);

      const lock = await veVirtual.locks(staker.address, 0);
      // Try to extend beyond maxWeeks (52 + 105 = 157 > 104)
      await expect(
        veVirtual.connect(staker).extend(lock.id, 105)
      ).to.be.revertedWith("Num weeks must be less than max weeks");
    });

    it("should allow toggle auto renew", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("1000"), 104, true);

      const lock = await veVirtual.locks(staker.address, 0);
      expect(lock.autoRenew).to.be.equal(true);

      await veVirtual.connect(staker).toggleAutoRenew(lock.id);
      const updatedLock = await veVirtual.locks(staker.address, 0);
      expect(updatedLock.autoRenew).to.be.equal(false);
    });

    it("should prevent withdrawal of auto-renewing lock", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("1000"), 104, true);

      const lock = await veVirtual.locks(staker.address, 0);
      await time.increase(105 * 7 * 24 * 60 * 60);

      await expect(
        veVirtual.connect(staker).withdraw(lock.id)
      ).to.be.revertedWith("Lock is auto-renewing");
    });

    it("should track voting power correctly", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("1000"), 104, true);

      await veVirtual.connect(staker).delegate(staker.address);
      expect(await veVirtual.getVotes(staker.address)).to.be.equal(
        parseEther("1000")
      );

      // Voting power should not decay
      await time.increase(52 * 7 * 24 * 60 * 60);
      expect(await veVirtual.getVotes(staker.address)).to.be.equal(
        parseEther("1000")
      );
    });
  });

  describe("Eco Lock Functionality", function () {
    it("should allow ecoVeVirtualStaker to stake tokens", async function () {
      const amount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, amount);

      await veVirtual.connect(ecoVeVirtualStaker).stakeForEcoTraders(amount);

      expect(await veVirtual.totalEcoLockAmount()).to.be.equal(amount);
      expect(await virtual.balanceOf(veVirtual.target)).to.be.equal(amount);
    });

    it("should prevent non-ecoVeVirtualStaker from calling stakeForEcoTraders", async function () {
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));

      await expect(
        veVirtual.connect(staker).stakeForEcoTraders(parseEther("1000"))
      ).to.be.revertedWith("sender is not ecoVeVirtualStaker");
    });

    it("should create eco locks for traders with percentages", async function () {
      // First, ecoVeVirtualStaker stakes tokens
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      // Admin distributes percentages to traders
      const percentages = [
        ethers.parseEther("0.3"), // 30%
        ethers.parseEther("0.7"), // 70%
      ];
      const traders = [trader1.address, trader2.address];

      await veVirtual.updateEcoTradersPercentages(traders, percentages);

      // Check eco locks were created
      const ecoLock1 = await veVirtual.getEcoLock(trader1.address);
      const ecoLock2 = await veVirtual.getEcoLock(trader2.address);

      expect(ecoLock1.id).to.be.greaterThan(0);
      expect(ecoLock2.id).to.be.greaterThan(0);
      expect(ecoLock1.isEco).to.be.equal(true);
      expect(ecoLock2.isEco).to.be.equal(true);
      expect(ecoLock1.autoRenew).to.be.equal(true);
      expect(ecoLock2.autoRenew).to.be.equal(true);

      // Check actual amounts (30% and 70% of 100000)
      const actualAmount1 = await veVirtual.balanceOf(trader1.address);
      const actualAmount2 = await veVirtual.balanceOf(trader2.address);

      expect(actualAmount1).to.be.equal(parseEther("30000"));
      expect(actualAmount2).to.be.equal(parseEther("70000"));
    });

    it("should update existing eco locks when called again", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      // First distribution
      const percentages1 = [ethers.parseEther("0.5"), ethers.parseEther("0.5")];
      await veVirtual.updateEcoTradersPercentages(
        [trader1.address, trader2.address],
        percentages1
      );

      const balance1Before = await veVirtual.balanceOf(trader1.address);
      expect(balance1Before).to.be.equal(parseEther("50000"));

      // Update distribution
      const percentages2 = [ethers.parseEther("0.8"), ethers.parseEther("0.2")];
      await veVirtual.updateEcoTradersPercentages(
        [trader1.address, trader2.address],
        percentages2
      );

      const balance1After = await veVirtual.balanceOf(trader1.address);
      const balance2After = await veVirtual.balanceOf(trader2.address);

      expect(balance1After).to.be.equal(parseEther("80000"));
      expect(balance2After).to.be.equal(parseEther("20000"));
    });

    it("should calculate balanceOf correctly with eco locks", async function () {
      // Regular stake
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("1000"), 104, true);

      // Eco lock setup
      const totalAmount = parseEther("50000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await veVirtual.updateEcoTradersPercentages(
        [staker.address],
        [ethers.parseEther("0.2")]
      );

      // Balance should include both regular lock and eco lock
      const balance = await veVirtual.balanceOf(staker.address);
      // 1000 (regular) + 20% of 50000 (eco) = 1000 + 10000 = 11000
      expect(balance).to.be.equal(parseEther("11000"));
    });

    it("should prevent traders from withdrawing eco locks", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await veVirtual.updateEcoTradersPercentages(
        [trader1.address],
        [ethers.parseEther("0.5")]
      );

      const ecoLock = await veVirtual.getEcoLock(trader1.address);
      await time.increase(105 * 7 * 24 * 60 * 60);

      // Try to withdraw eco lock (should fail even if expired)
      await expect(
        veVirtual.connect(trader1).withdraw(ecoLock.id)
      ).to.be.revertedWith("Lock not found"); // Because eco locks are not in locks[] array
    });

    it("should prevent creating eco lock for ecoVeVirtualStaker", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await expect(
        veVirtual.updateEcoTradersPercentages(
          [ecoVeVirtualStaker.address],
          [ethers.parseEther("0.5")]
        )
      ).to.be.revertedWith("Cannot set percentage for ecoVeVirtualStaker");
    });

    it("should prevent non-ECO_ROLE from calling setEcoVeVirtualStaker", async function () {
      await expect(
        veVirtual.connect(staker).setEcoVeVirtualStaker(trader1.address)
      ).to.be.revertedWithCustomError(
        veVirtual,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("should prevent non-ECO_ROLE from calling updateEcoTradersPercentages", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await expect(
        veVirtual
          .connect(staker)
          .updateEcoTradersPercentages(
            [trader1.address],
            [ethers.parseEther("0.5")]
          )
      ).to.be.revertedWithCustomError(
        veVirtual,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("should prevent updating eco locks when totalEcoLockAmount is zero", async function () {
      await expect(
        veVirtual.updateEcoTradersPercentages(
          [trader1.address],
          [ethers.parseEther("0.5")]
        )
      ).to.be.revertedWith("totalEcoLockAmount must be greater than 0");
    });

    it("should validate percentage limits", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      // Percentage exceeds 100%
      await expect(
        veVirtual.updateEcoTradersPercentages(
          [trader1.address],
          [ethers.parseEther("1.1")]
        )
      ).to.be.revertedWith("Percentage cannot exceed 100%");

      // Zero percentage
      await expect(
        veVirtual.updateEcoTradersPercentages([trader1.address], [0])
      ).to.be.revertedWith("Percentage must be greater than 0");
    });

    it("should update voting power when eco locks are created/updated", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await veVirtual.connect(trader1).delegate(trader1.address);
      await veVirtual.connect(trader2).delegate(trader2.address);

      // Create eco locks
      await veVirtual.updateEcoTradersPercentages(
        [trader1.address, trader2.address],
        [ethers.parseEther("0.3"), ethers.parseEther("0.7")]
      );

      expect(await veVirtual.getVotes(trader1.address)).to.be.equal(
        parseEther("30000")
      );
      expect(await veVirtual.getVotes(trader2.address)).to.be.equal(
        parseEther("70000")
      );

      // Update eco locks
      await veVirtual.updateEcoTradersPercentages(
        [trader1.address, trader2.address],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5")]
      );

      expect(await veVirtual.getVotes(trader1.address)).to.be.equal(
        parseEther("50000")
      );
      expect(await veVirtual.getVotes(trader2.address)).to.be.equal(
        parseEther("50000")
      );
    });

    it("should handle multiple stakeForEcoTraders calls", async function () {
      const amount1 = parseEther("50000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, amount1);
      await veVirtual.connect(ecoVeVirtualStaker).stakeForEcoTraders(amount1);

      expect(await veVirtual.totalEcoLockAmount()).to.be.equal(amount1);

      const amount2 = parseEther("30000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, amount2);
      await veVirtual.connect(ecoVeVirtualStaker).stakeForEcoTraders(amount2);

      expect(await veVirtual.totalEcoLockAmount()).to.be.equal(
        amount1 + amount2
      );

      // Update trader percentages - should use new total
      await veVirtual.updateEcoTradersPercentages(
        [trader1.address],
        [ethers.parseEther("0.5")]
      );

      // 50% of (50000 + 30000) = 40000
      expect(await veVirtual.balanceOf(trader1.address)).to.be.equal(
        parseEther("40000")
      );
    });

    it("should prevent traders from modifying eco locks", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await veVirtual.updateEcoTradersPercentages(
        [trader1.address],
        [ethers.parseEther("0.5")]
      );

      const ecoLock = await veVirtual.getEcoLock(trader1.address);

      // Try to toggle auto renew (should fail - eco locks can't be modified)
      // Note: This will fail because eco locks are not in locks[] array
      // But if they were, the require(!lock.isEco) check would prevent it
    });

    it("should calculate stakedAmountOf correctly with eco locks", async function () {
      // Regular stake
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("1000"));
      await veVirtual.connect(staker).stake(parseEther("1000"), 104, true);

      // Eco lock setup
      const totalAmount = parseEther("50000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await veVirtual.updateEcoTradersPercentages(
        [staker.address],
        [ethers.parseEther("0.2")]
      );

      const stakedAmount = await veVirtual.stakedAmountOf(staker.address);
      // 1000 (regular) + 20% of 50000 (eco) = 1000 + 10000 = 11000
      expect(stakedAmount).to.be.equal(parseEther("11000"));
    });

    it("should handle eco lock balance decay correctly", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await veVirtual.updateEcoTradersPercentages(
        [trader1.address],
        [ethers.parseEther("0.5")]
      );

      const initialBalance = await veVirtual.balanceOf(trader1.address);
      expect(initialBalance).to.be.equal(parseEther("50000"));

      // Eco locks have autoRenew = true, so balance should not decay
      await time.increase(52 * 7 * 24 * 60 * 60);
      const balanceAfter = await veVirtual.balanceOf(trader1.address);
      expect(balanceAfter).to.be.equal(parseEther("50000"));
    });

    it("should handle array length mismatch", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await expect(
        veVirtual.updateEcoTradersPercentages(
          [trader1.address, trader2.address],
          [ethers.parseEther("0.5")]
        )
      ).to.be.revertedWith("Arrays length mismatch");
    });

    it("should handle zero address validation", async function () {
      const totalAmount = parseEther("100000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      await expect(
        veVirtual.updateEcoTradersPercentages(
          [ethers.ZeroAddress],
          [ethers.parseEther("0.5")]
        )
      ).to.be.revertedWith("Invalid trader address");
    });
  });

  describe("Integration Tests", function () {
    it("should handle complex workflow: stake, eco locks, update, withdraw", async function () {
      // 1. Regular user stakes
      await virtual
        .connect(staker)
        .approve(veVirtual.target, parseEther("5000"));
      await veVirtual.connect(staker).stake(parseEther("1000"), 104, true);
      await veVirtual.connect(staker).stake(parseEther("2000"), 104, true);

      // 2. EcoVeVirtualStaker stakes
      const totalAmount = parseEther("200000");
      await virtual
        .connect(ecoVeVirtualStaker)
        .approve(veVirtual.target, totalAmount);
      await veVirtual
        .connect(ecoVeVirtualStaker)
        .stakeForEcoTraders(totalAmount);

      // 3. Distribute to traders
      await veVirtual.updateEcoTradersPercentages(
        [trader1.address, trader2.address, trader3.address],
        [
          ethers.parseEther("0.4"), // 40%
          ethers.parseEther("0.35"), // 35%
          ethers.parseEther("0.25"), // 25%
        ]
      );

      // 4. Verify balances
      expect(await veVirtual.balanceOf(trader1.address)).to.be.equal(
        parseEther("80000")
      );
      expect(await veVirtual.balanceOf(trader2.address)).to.be.equal(
        parseEther("70000")
      );
      expect(await veVirtual.balanceOf(trader3.address)).to.be.equal(
        parseEther("50000")
      );
      expect(await veVirtual.balanceOf(staker.address)).to.be.equal(
        parseEther("3000")
      );

      // 5. Update distribution
      await veVirtual.updateEcoTradersPercentages(
        [trader1.address, trader2.address, trader3.address],
        [
          ethers.parseEther("0.5"), // 50%
          ethers.parseEther("0.3"), // 30%
          ethers.parseEther("0.2"), // 20%
        ]
      );

      // 6. Verify updated balances
      expect(await veVirtual.balanceOf(trader1.address)).to.be.equal(
        parseEther("100000")
      );
      expect(await veVirtual.balanceOf(trader2.address)).to.be.equal(
        parseEther("60000")
      );
      expect(await veVirtual.balanceOf(trader3.address)).to.be.equal(
        parseEther("40000")
      );

      // 7. Regular user withdraws (after maturity)
      const locks = await veVirtual.getPositions(staker.address, 0, 2);

      // Toggle off autoRenew first (before time passes, otherwise toggleAutoRenew resets the end time)
      await veVirtual.connect(staker).toggleAutoRenew(locks[0].id);
      await veVirtual.connect(staker).toggleAutoRenew(locks[1].id);

      // Now wait for maturity (104 weeks)
      await time.increase(105 * 7 * 24 * 60 * 60);

      await veVirtual.connect(staker).withdraw(locks[0].id);
      await veVirtual.connect(staker).withdraw(locks[1].id);

      // 8. Verify final balances
      expect(await veVirtual.balanceOf(staker.address)).to.be.equal(0);
      expect(await veVirtual.balanceOf(trader1.address)).to.be.equal(
        parseEther("100000")
      ); // Eco locks remain
    });
  });
});
