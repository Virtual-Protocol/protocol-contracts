const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupBondingV5Test } = require("./bondingV5Fixture.js");
const { START_TIME_DELAY } = require("../launchpadv2/const.js");

const LAUNCH_MODE_NORMAL = 0;
const ANTI_SNIPER_60S = 1;

/** Same graduation buy size as legacy project60days / drainLiquidity tests */
const GRAD_BUY_AMOUNT = ethers.parseEther("202020.2044906205");

async function preLaunchProject60daysP60(
  bondingV5,
  virtualToken,
  bondingV5Address,
  user,
  purchaseAmount
) {
  await virtualToken.connect(user).approve(bondingV5Address, purchaseAmount);
  const startTime = BigInt(await time.latest()) + BigInt(START_TIME_DELAY) + 1n;
  const tx = await bondingV5.connect(user).preLaunch(
    "P60 Drain Token",
    "P60D",
    [0, 1, 2],
    "drain test",
    "https://example.com/i.png",
    ["", "", "", ""],
    purchaseAmount,
    startTime,
    LAUNCH_MODE_NORMAL,
    0,
    false,
    ANTI_SNIPER_60S,
    true
  ,"0x");
  const receipt = await tx.wait();
  const event = receipt.logs.find((log) => {
    try {
      return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
    } catch {
      return false;
    }
  });
  const parsed = bondingV5.interface.parseLog(event);
  return { tokenAddress: parsed.args.token, pairAddress: parsed.args.pair };
}

/** Project60days launch() must be called by a privileged launcher (fixture: owner only). */
async function waitAndLaunch(bondingV5, privilegedLauncher, tokenAddress, pairAddress) {
  const pair = await ethers.getContractAt("FPairV2", pairAddress);
  const pairStartTime = await pair.startTime();
  const now = await time.latest();
  if (BigInt(now) < BigInt(pairStartTime.toString())) {
    await time.increase(
      BigInt(pairStartTime.toString()) - BigInt(now) + 1n
    );
  }
  await bondingV5.connect(privilegedLauncher).launch(tokenAddress);
}

describe("BondingV5 / FRouterV3 — drain liquidity (V5 suite)", function () {
  let setup;
  let contracts;
  let accounts;
  let addresses;

  before(async function () {
    setup = await loadFixture(setupBondingV5Test);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;
  });

  describe("drainPrivatePool", function () {
    let tokenAddress;
    let pairAddress;

    beforeEach(async function () {
      const { bondingV5, virtualToken } = contracts;
      const { user1, owner } = accounts;
      const purchaseAmount = ethers.parseEther("1000");
      const r = await preLaunchProject60daysP60(
        bondingV5,
        virtualToken,
        addresses.bondingV5,
        user1,
        purchaseAmount
      );
      tokenAddress = r.tokenAddress;
      pairAddress = r.pairAddress;
      await waitAndLaunch(bondingV5, owner, tokenAddress, pairAddress);
    });

    it("Should drain private pool for Project60days token", async function () {
      const { fRouterV3, virtualToken } = contracts;
      const { admin } = accounts;
      const recipient = ethers.Wallet.createRandom().address;

      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      const initialAssetBalance = await pair.assetBalance();
      const initialTokenBalance = await pair.balance();
      expect(initialAssetBalance).to.be.gt(0);
      expect(initialTokenBalance).to.be.gt(0);

      const tx = await fRouterV3
        .connect(admin)
        .drainPrivatePool(tokenAddress, recipient);

      await expect(tx)
        .to.emit(fRouterV3, "PrivatePoolDrained")
        .withArgs(tokenAddress, recipient, initialAssetBalance, initialTokenBalance);

      expect(await pair.assetBalance()).to.equal(0);
      expect(await pair.balance()).to.equal(0);
      expect(await virtualToken.balanceOf(recipient)).to.equal(initialAssetBalance);
    });

    it("Should revert buy after private pool is drained (SlippageTooHigh)", async function () {
      const { bondingV5, fRouterV3, virtualToken } = contracts;
      const { admin, user2, beOpsWallet } = accounts;

      const pair = await ethers.getContractAt("FPairV2", pairAddress);
      expect(await pair.assetBalance()).to.be.gt(0);

      await fRouterV3
        .connect(admin)
        .drainPrivatePool(tokenAddress, beOpsWallet.address);

      const buyAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV3, buyAmount);
      const before = await virtualToken.balanceOf(user2.address);

      await expect(
        bondingV5
          .connect(user2)
          .buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.revertedWithCustomError(bondingV5, "SlippageTooHigh");

      expect(await virtualToken.balanceOf(user2.address)).to.equal(before);
    });

    it("Should revert drain for non-Project60days token", async function () {
      const { bondingV5, fRouterV3, virtualToken } = contracts;
      const { admin, user1 } = accounts;
      const purchaseAmount = ethers.parseEther("1000");
      await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);
      const startTime = BigInt(await time.latest()) + BigInt(START_TIME_DELAY) + 1n;
      const tx = await bondingV5.connect(user1).preLaunch(
        "Regular",
        "REG",
        [0, 1, 2],
        "desc",
        "https://x.com/i.png",
        ["", "", "", ""],
        purchaseAmount,
        startTime,
        LAUNCH_MODE_NORMAL,
        0,
        false,
        ANTI_SNIPER_60S,
        false
      ,"0x");
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
        } catch {
          return false;
        }
      });
      const regToken = bondingV5.interface.parseLog(event).args.token;
      const recipient = ethers.Wallet.createRandom().address;

      await expect(
        fRouterV3.connect(admin).drainPrivatePool(regToken, recipient)
      ).to.be.revertedWith("Token does not allow liquidity drain");
    });

    it("Should revert drain without EXECUTOR_ROLE", async function () {
      const { fRouterV3 } = contracts;
      const { user1 } = accounts;
      await expect(
        fRouterV3
          .connect(user1)
          .drainPrivatePool(
            tokenAddress,
            ethers.Wallet.createRandom().address
          )
      ).to.be.revertedWithCustomError(fRouterV3, "AccessControlUnauthorizedAccount");
    });

    it("Should revert when BondingV5 is not set on a fresh FRouterV3", async function () {
      const { fFactoryV3, virtualToken } = contracts;
      const { admin } = accounts;

      const FRouterV3 = await ethers.getContractFactory("FRouterV3");
      const freshRouter = await upgrades.deployProxy(
        FRouterV3,
        [addresses.fFactoryV3, addresses.virtualToken],
        { initializer: "initialize" }
      );
      await freshRouter.waitForDeployment();
      await freshRouter.grantRole(await freshRouter.EXECUTOR_ROLE(), admin.address);

      await expect(
        freshRouter
          .connect(admin)
          .drainPrivatePool(
            tokenAddress,
            ethers.Wallet.createRandom().address
          )
      ).to.be.revertedWith("BondingV5 not set");
    });
  });

  describe("drainUniV2Pool", function () {
    let tokenAddress;
    let veToken;

    beforeEach(async function () {
      const { bondingV5, virtualToken } = contracts;
      const { user1, user2, owner } = accounts;
      const purchaseAmount = ethers.parseEther("1000");
      const r = await preLaunchProject60daysP60(
        bondingV5,
        virtualToken,
        addresses.bondingV5,
        user1,
        purchaseAmount
      );
      tokenAddress = r.tokenAddress;
      await waitAndLaunch(bondingV5, owner, tokenAddress, r.pairAddress);

      await time.increase(100 * 60);
      await virtualToken.connect(user2).approve(addresses.fRouterV3, GRAD_BUY_AMOUNT);
      await bondingV5
        .connect(user2)
        .buy(GRAD_BUY_AMOUNT, tokenAddress, 0, (await time.latest()) + 300);

      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      const agentTokenAddr = tokenInfo.agentToken;
      const { agentNftV2 } = contracts;
      const nextVirtualId = await agentNftV2.nextVirtualId();
      veToken = undefined;
      for (let i = Number(nextVirtualId); i > 0; i--) {
        try {
          const virtualInfo = await agentNftV2.virtualInfo(i);
          if (virtualInfo.token.toLowerCase() === agentTokenAddr.toLowerCase()) {
            const virtualLP = await agentNftV2.virtualLP(i);
            veToken = virtualLP.veToken;
            break;
          }
        } catch {
          continue;
        }
      }
      expect(veToken).to.be.a("string");
      expect(veToken).to.not.equal(ethers.ZeroAddress);
    });

    it("Should drain all UniV2 LP for graduated Project60days token", async function () {
      const { bondingV5, fRouterV3 } = contracts;
      const { admin } = accounts;
      const recipient = ethers.Wallet.createRandom().address;

      const tokenInfo = await bondingV5.tokenInfo(tokenAddress);
      expect(tokenInfo.tradingOnUniswap).to.be.true;

      const veTokenContract = await ethers.getContractAt("AgentVeTokenV2", veToken);
      const founder = await veTokenContract.founder();
      const founderVeBal = await veTokenContract.balanceOf(founder);
      expect(founderVeBal).to.be.gt(0);

      const deadline = (await time.latest()) + 300;
      const tx = await fRouterV3
        .connect(admin)
        .drainUniV2Pool(tokenAddress, veToken, recipient, deadline);

      await expect(tx)
        .to.emit(fRouterV3, "UniV2PoolDrained")
        .withArgs(tokenAddress, veToken, recipient, founderVeBal);

      expect(await veTokenContract.balanceOf(founder)).to.equal(0);
    });
  });

  describe("Drain and graduation protection (BondingV5)", function () {
    it("Should prevent buy with zero output after pool drain", async function () {
      const { bondingV5, fRouterV3, virtualToken } = contracts;
      const { owner, user1, user2, admin } = accounts;

      const purchaseAmount = ethers.parseEther("1000");
      const r = await preLaunchProject60daysP60(
        bondingV5,
        virtualToken,
        addresses.bondingV5,
        user1,
        purchaseAmount
      );
      await waitAndLaunch(bondingV5, owner, r.tokenAddress, r.pairAddress);
      await time.increase(100 * 60);

      await fRouterV3
        .connect(admin)
        .drainPrivatePool(r.tokenAddress, admin.address);

      const buyAmount = ethers.parseEther("1000");
      await virtualToken.connect(user2).approve(addresses.fRouterV3, buyAmount);

      await expect(
        bondingV5
          .connect(user2)
          .buy(buyAmount, r.tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.revertedWithCustomError(bondingV5, "SlippageTooHigh");
    });

    it("Should prevent forced graduation after pool drain", async function () {
      const { bondingV5, fRouterV3, virtualToken } = contracts;
      const { owner, user1, user2, admin } = accounts;

      const purchaseAmount = ethers.parseEther("1000");
      const r = await preLaunchProject60daysP60(
        bondingV5,
        virtualToken,
        addresses.bondingV5,
        user1,
        purchaseAmount
      );
      await waitAndLaunch(bondingV5, owner, r.tokenAddress, r.pairAddress);
      await time.increase(100 * 60);

      await fRouterV3
        .connect(admin)
        .drainPrivatePool(r.tokenAddress, admin.address);

      let info = await bondingV5.tokenInfo(r.tokenAddress);
      expect(info.trading).to.be.true;
      expect(info.tradingOnUniswap).to.be.false;

      const attackAmount = ethers.parseEther("100");
      await virtualToken.connect(user2).approve(addresses.fRouterV3, attackAmount);

      await expect(
        bondingV5
          .connect(user2)
          .buy(attackAmount, r.tokenAddress, 0, (await time.latest()) + 300)
      ).to.be.revertedWithCustomError(bondingV5, "SlippageTooHigh");

      info = await bondingV5.tokenInfo(r.tokenAddress);
      expect(info.trading).to.be.true;
      expect(info.tradingOnUniswap).to.be.false;
    });
  });
});
