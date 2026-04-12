const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupV2V3TaxComparisonTest } = require("./bondingV5Tax.fixture.js");

const { START_TIME_DELAY } = require("../launchpadv2/const.js");

const LAUNCH_MODE_NORMAL = 0;
const ANTI_SNIPER_60S = 1;

async function setupTaxAccountingAdapterFixture() {
  return setupV2V3TaxComparisonTest({
    useFeeOnTransferFactoryRouter: true,
    includeBondingV4: false,
  });
}

describe("TaxAccountingAdapter E2E (BondingV5 + AgentTokenV4)", function () {
  it("unit: swapTaxAndDeposit pulls agent, stub swaps VIRTUAL, AgentTaxV2 depositTax matches", async function () {
    const { contracts, accounts } = await loadFixture(setupTaxAccountingAdapterFixture);
    const { virtualToken, agentTax, mockUniswapRouter } = contracts;
    const { owner } = accounts;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockAgent = await MockERC20.deploy("MockAgent", "MAG", owner.address, 0);
    await mockAgent.waitForDeployment();

    await mockAgent.mint(await mockAgent.getAddress(), ethers.parseEther("10000"));
    await ethers.provider.send("hardhat_impersonateAccount", [await mockAgent.getAddress()]);
    const agentSigner = await ethers.getSigner(await mockAgent.getAddress());
    await ethers.provider.send("hardhat_setBalance", [await mockAgent.getAddress(), "0x10000000000000000"]);

    const TaxAccountingAdapter = await ethers.getContractFactory("TaxAccountingAdapter");
    const taxAdapter = await upgrades.deployProxy(
      TaxAccountingAdapter,
      [owner.address, await agentTax.getAddress()],
      {
        initializer: "initialize",
      }
    );
    await taxAdapter.waitForDeployment();

    await virtualToken.mint(await mockUniswapRouter.getAddress(), ethers.parseEther("1000000"));

    const swapAmt = ethers.parseEther("100");
    await mockAgent.connect(agentSigner).approve(await taxAdapter.getAddress(), swapAmt);

    const tx = await taxAdapter.connect(owner).swapTaxAndDeposit(
      await mockAgent.getAddress(),
      await virtualToken.getAddress(),
      await mockUniswapRouter.getAddress(),
      swapAmt,
      (await ethers.provider.getBlock("latest")).timestamp + 600
    );
    const rc = await tx.wait();

    let received;
    for (const log of rc.logs) {
      try {
        const p = taxAdapter.interface.parseLog(log);
        if (p?.name === "TaxSwapDeposited") {
          received = p.args.received;
        }
      } catch (e) {
        /* ignore */
      }
    }
    expect(received).to.be.gt(0n);

    const dep = await agentTax.tokenTaxAmounts(await mockAgent.getAddress());
    expect(dep.amountCollected).to.be.gt(0n);
  });

  it("preLaunch → launch → graduate → router swapExact…SupportingFee (pair path) accrues tax, _autoSwap + depositTax", async function () {
    this.timeout(400000);

    const { contracts, accounts } = await loadFixture(setupTaxAccountingAdapterFixture);
    const {
      bondingV5,
      virtualToken,
      fRouterV3,
      agentFactoryV7,
      agentTax,
      agentTokenV4Impl,
      mockUniswapRouter,
      taxAccountingAdapter,
    } = contracts;
    const { owner, user1, user2 } = accounts;

    await agentFactoryV7.connect(owner).setImplementations(
      await agentTokenV4Impl.getAddress(),
      await agentFactoryV7.veTokenImplementation(),
      await agentFactoryV7.daoImplementation()
    );

    await virtualToken.connect(user2).approve(await bondingV5.getAddress(), ethers.MaxUint256);
    await virtualToken.connect(user2).approve(await fRouterV3.getAddress(), ethers.MaxUint256);

    const startTime = (await time.latest()) + START_TIME_DELAY + 1;
    const tx = await bondingV5.connect(user2).preLaunch(
      "Adapter E2E",
      "ADPT",
      [0, 1, 2],
      "TaxAccountingAdapter e2e",
      "https://example.com/i.png",
      [
        "https://twitter.com/x",
        "https://t.me/x",
        "https://youtube.com/x",
        "https://example.com",
      ],
      ethers.parseEther("100"),
      startTime,
      LAUNCH_MODE_NORMAL,
      0,
      false,
      ANTI_SNIPER_60S,
      false
    );
    const receipt = await tx.wait();
    const preEvent = receipt.logs.find((log) => {
      try {
        return bondingV5.interface.parseLog(log)?.name === "PreLaunched";
      } catch (e) {
        return false;
      }
    });
    const tokenAddress = bondingV5.interface.parseLog(preEvent).args.token;

    await time.increaseTo(startTime + 1);
    await bondingV5.connect(user2).launch(tokenAddress);

    const v4Token = await ethers.getContractAt("AgentTokenV4", tokenAddress);

    expect(await v4Token.taxAccountingAdapter()).to.equal(
      await taxAccountingAdapter.getAddress(),
      "factory should inject TaxAccountingAdapter at initialize"
    );
    // Non-zero: 0 triggers _swapTax(0) → TaxAccountingAdapter reverts ("zero swap") → ExternalCallError(5).
    // Factory project sell tax is 1 bp of amount; use a low threshold (1 → supply/1e6) so one sell accrues enough
    // tax on the token contract to pass _eligibleForSwap (100 → supply/1e4 is often above first sell's tax).
    await v4Token.connect(owner).setSwapThresholdBasisPoints(1);

    await virtualToken.connect(user1).approve(await bondingV5.getAddress(), ethers.MaxUint256);
    await virtualToken.connect(user1).approve(await fRouterV3.getAddress(), ethers.MaxUint256);

    await time.increase(100 * 60);

    const gradBuy = ethers.parseEther("250000");
    await bondingV5
      .connect(user1)
      .buy(gradBuy, tokenAddress, 0, (await time.latest()) + 600);

    const tInfo = await bondingV5.tokenInfo(tokenAddress);
    expect(tInfo.tradingOnUniswap).to.equal(true);

    const uniPair = await v4Token.uniswapV2Pair();
    expect(await v4Token.isLiquidityPool(uniPair)).to.equal(true);

    await virtualToken.mint(
      await mockUniswapRouter.getAddress(),
      ethers.parseEther("100000000000")
    );

    const bal = await v4Token.balanceOf(user1.address);
    expect(bal).to.be.gt(0n);
    const chunk = bal / 3n;
    expect(chunk).to.be.gt(0n);

    const uniRouter = mockUniswapRouter;
    const deadlineFn = async () => BigInt((await time.latest()) + 600);
    const swapPath = [tokenAddress, await virtualToken.getAddress()];

    await v4Token.connect(user1).approve(await uniRouter.getAddress(), ethers.MaxUint256);

    await (
      await uniRouter.connect(user1).swapExactTokensForTokensSupportingFeeOnTransferTokens(
        chunk,
        0n,
        swapPath,
        user1.address,
        await deadlineFn()
      )
    ).wait();

    const taxOnContractAfterOne = await v4Token.balanceOf(tokenAddress);
    expect(taxOnContractAfterOne).to.be.gt(0n, "sell tax should accrue after graduation");

    const tx2 = await uniRouter.connect(user1).swapExactTokensForTokensSupportingFeeOnTransferTokens(
      chunk,
      0n,
      swapPath,
      user1.address,
      await deadlineFn()
    );
    const rc2 = await tx2.wait();

    let externalErr;
    for (const log of rc2.logs) {
      try {
        const p = v4Token.interface.parseLog(log);
        if (p?.name === "ExternalCallError") {
          externalErr = p.args;
        }
      } catch (e) {
        /* ignore */
      }
    }
    expect(externalErr, "autoswap should not fail (check stub VIRTUAL balance / router)").to.be
      .undefined;

    let swapDeposited;
    for (const log of rc2.logs) {
      try {
        const parsed = taxAccountingAdapter.interface.parseLog(log);
        if (parsed && parsed.name === "TaxSwapDeposited") {
          swapDeposited = parsed.args;
        }
      } catch (e) {
        /* ignore */
      }
    }
    expect(swapDeposited, "TaxSwapDeposited from adapter").to.not.be.undefined;
    expect(swapDeposited.agentToken).to.equal(tokenAddress);
    expect(swapDeposited.received).to.be.gt(0n);

    let foundMatchingTaxDeposit;
    for (const log of rc2.logs) {
      try {
        const parsed = agentTax.interface.parseLog(log);
        if (
          parsed &&
          parsed.name === "TaxDeposited" &&
          parsed.args.tokenAddress === tokenAddress &&
          parsed.args.amount === swapDeposited.received
        ) {
          foundMatchingTaxDeposit = true;
        }
      } catch (e) {
        /* ignore */
      }
    }
    expect(foundMatchingTaxDeposit, "depositTax matches adapter output").to.equal(true);
  });
});
