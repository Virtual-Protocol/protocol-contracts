// Focused verification of the indexing events added to BondingV5 / FRouterV3.
// Walks one token through preLaunch -> launch -> buy -> sell -> graduation and
// asserts each new event fires with correct, internally-consistent values.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { increaseTimeByMinutes } = require("../launchpadv2/util.js");
const { START_TIME_DELAY } = require("../launchpadv2/const.js");
const { setupBondingV5Test } = require("./bondingV5Fixture.js");

const LAUNCH_MODE_NORMAL = 0;
const ANTI_SNIPER_60S = 1;

function parseOne(contract, receipt, name) {
  for (const log of receipt.logs) {
    try {
      const p = contract.interface.parseLog(log);
      if (p && p.name === name) return p;
    } catch (e) {}
  }
  return undefined;
}

describe("Indexing events (BondingV5 / FRouterV3)", function () {
  let setup, contracts, accounts, addresses;
  let tokenAddress, pairAddress, pair;

  before(async function () {
    this.timeout(120000);
    setup = await setupBondingV5Test();
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;

    // Fixture leaves graduationExcessBurnWallet unset (zero); set it so the
    // graduation excess-burn transfer doesn't revert with TransferToZeroAddress.
    await contracts.bondingConfig
      .connect(accounts.owner)
      .setGraduationExcessBurnWallet(ethers.Wallet.createRandom().address);
  });

  it("preLaunch emits TokenCreated with consistent values", async function () {
    const { user1 } = accounts;
    const { bondingV5, virtualToken } = contracts;

    const purchaseAmount = ethers.parseEther("1000");
    await virtualToken.connect(user1).approve(addresses.bondingV5, purchaseAmount);
    const startTime = (await time.latest()) + START_TIME_DELAY + 1;

    const tx = await bondingV5.connect(user1).preLaunch(
      "Idx Token",
      "IDX",
      [0, 1, 2],
      "desc",
      "https://example.com/i.png",
      ["tw", "tg", "yt", "web"],
      purchaseAmount,
      startTime,
      LAUNCH_MODE_NORMAL,
      0,
      false,
      ANTI_SNIPER_60S,
      false,
      "0x"
    );
    const receipt = await tx.wait();

    const pre = parseOne(bondingV5, receipt, "PreLaunched");
    expect(pre, "PreLaunched emitted").to.not.be.undefined;
    tokenAddress = pre.args.token;
    pairAddress = pre.args.pair;
    pair = await ethers.getContractAt("IFPairV2", pairAddress);

    const tc = parseOne(bondingV5, receipt, "TokenCreated");
    expect(tc, "TokenCreated emitted").to.not.be.undefined;
    expect(tc.args.creator).to.equal(user1.address);
    expect(tc.args.token).to.equal(tokenAddress);
    expect(tc.args.name).to.equal("Idx Token");
    expect(tc.args.symbol).to.equal("IDX");
    expect(tc.args.quoteAsset).to.equal(addresses.virtualToken);
    expect(tc.args.pair).to.equal(pairAddress);
    // v2 fields: virtualId matches PreLaunched, applicationId + virtual liquidity present
    expect(tc.args.virtualId).to.equal(pre.args.virtualId);
    expect(tc.args.applicationId).to.be.greaterThan(0n);
    expect(tc.args.initialVirtualLiquidity).to.be.greaterThan(0n);
    // curve sanity: sale supply above graduation threshold, both positive
    expect(tc.args.saleAmount).to.be.greaterThan(0n);
    expect(tc.args.graduationThreshold).to.be.greaterThan(0n);
    expect(tc.args.saleAmount).to.be.greaterThan(tc.args.graduationThreshold);
    // targetRaiseAmount computed without underflow/revert and is positive
    expect(tc.args.targetRaiseAmount).to.be.greaterThan(0n);
    expect(tc.args.initialPrice).to.be.greaterThan(0n);
    expect(tc.args.twitter).to.equal("tw");
    expect(tc.args.website).to.equal("web");
  });

  it("launch succeeds and enables trading", async function () {
    const { bondingV5 } = contracts;
    await time.increase(START_TIME_DELAY + 1);
    const tx = await bondingV5.launch(tokenAddress);
    const receipt = await tx.wait();

    const launched = parseOne(bondingV5, receipt, "Launched");
    expect(launched, "Launched emitted").to.not.be.undefined;
    expect(launched.args.token).to.equal(tokenAddress);
  });

  it("buy emits TradeExecuted with anti-sniper fee active + consistent reserves/price", async function () {
    const { user2 } = accounts;
    const { bondingV5, fRouterV3, virtualToken } = contracts;

    const token = await ethers.getContractAt("AgentTokenV4", tokenAddress);
    const buyAmount = ethers.parseEther("100");
    await virtualToken.connect(user2).approve(addresses.fRouterV3, buyAmount);

    // Independent ground truth: actual balance deltas.
    const vBefore = await virtualToken.balanceOf(user2.address);
    const tBefore = await token.balanceOf(user2.address);
    const taxVaultBefore = await virtualToken.balanceOf(addresses.taxVault);
    const antiVaultBefore = await virtualToken.balanceOf(addresses.antiSniperTaxVault);

    const tx = await bondingV5.connect(user2).buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);
    const receipt = await tx.wait();

    const te = parseOne(fRouterV3, receipt, "TradeExecuted");
    expect(te, "TradeExecuted emitted").to.not.be.undefined;
    expect(te.args.isBuy).to.equal(true);
    expect(te.args.token).to.equal(tokenAddress);
    expect(te.args.pair).to.equal(pairAddress);
    expect(te.args.quoteAsset).to.equal(addresses.virtualToken);
    // buy semantics: trader pays amountIn total; curve gets `amount` = amountIn - taxes;
    // amountOut is the token received by the trader.
    expect(te.args.amountIn).to.equal(buyAmount);
    expect(te.args.taxFee + te.args.antiSniperFee + te.args.amount).to.equal(buyAmount);
    // anti-sniper window still open -> nonzero anti-sniper fee
    expect(te.args.antiSniperFee).to.be.greaterThan(0n);
    expect(te.args.amountOut).to.be.greaterThan(0n);

    // Ground-truth cross-checks: emitted amounts == actual tokens/VIRTUAL moved.
    expect(vBefore - (await virtualToken.balanceOf(user2.address))).to.equal(te.args.amountIn);
    expect((await token.balanceOf(user2.address)) - tBefore).to.equal(te.args.amountOut);
    expect((await virtualToken.balanceOf(addresses.taxVault)) - taxVaultBefore).to.equal(te.args.taxFee);
    expect((await virtualToken.balanceOf(addresses.antiSniperTaxVault)) - antiVaultBefore).to.equal(te.args.antiSniperFee);

    // reserves/price match the pair post-trade
    const [rTok, rAsset] = await pair.getReserves();
    expect(te.args.reserveTokenAfter).to.equal(rTok);
    expect(te.args.reserveAssetAfter).to.equal(rAsset);
    const expectedPrice = rTok === 0n ? 0n : (rAsset * ethers.parseEther("1")) / rTok;
    expect(te.args.lastPrice).to.equal(expectedPrice);
  });

  it("buy after anti-sniper window: antiSniperFee == 0", async function () {
    const { user2 } = accounts;
    const { bondingV5, fRouterV3, virtualToken } = contracts;
    await increaseTimeByMinutes(99);

    const buyAmount = ethers.parseEther("100");
    await virtualToken.connect(user2).approve(addresses.fRouterV3, buyAmount);
    const tx = await bondingV5.connect(user2).buy(buyAmount, tokenAddress, 0, (await time.latest()) + 300);
    const receipt = await tx.wait();

    const te = parseOne(fRouterV3, receipt, "TradeExecuted");
    expect(te).to.not.be.undefined;
    expect(te.args.isBuy).to.equal(true);
    expect(te.args.antiSniperFee).to.equal(0n);
  });

  it("sell emits TradeExecuted with isBuy=false and correct net/tax split", async function () {
    const { user2 } = accounts;
    const { bondingV5, fRouterV3, virtualToken } = contracts;

    const token = await ethers.getContractAt("AgentTokenV4", tokenAddress);
    const bal = await token.balanceOf(user2.address);
    const sellAmount = bal / 4n;
    await token.connect(user2).approve(addresses.fRouterV3, sellAmount);

    const vBefore = await virtualToken.balanceOf(user2.address);
    const tBefore = await token.balanceOf(user2.address);
    const taxVaultBefore = await virtualToken.balanceOf(addresses.taxVault);

    const tx = await bondingV5.connect(user2).sell(sellAmount, tokenAddress, 0, (await time.latest()) + 300);
    const receipt = await tx.wait();

    const te = parseOne(fRouterV3, receipt, "TradeExecuted");
    expect(te, "TradeExecuted emitted").to.not.be.undefined;
    expect(te.args.isBuy).to.equal(false);
    // sell semantics: amountIn is the token sold; amountOut is the gross quote out of
    // the curve; amount is the net quote received by the trader after tax.
    expect(te.args.amountIn).to.equal(sellAmount);
    expect(te.args.antiSniperFee).to.equal(0n);
    // net received (amount) = gross curve quote (amountOut) - tax
    expect(te.args.amount).to.equal(te.args.amountOut - te.args.taxFee);

    // Ground-truth cross-checks: emitted amounts == actual tokens/VIRTUAL moved.
    expect(tBefore - (await token.balanceOf(user2.address))).to.equal(te.args.amountIn);
    expect((await virtualToken.balanceOf(user2.address)) - vBefore).to.equal(te.args.amount);
    expect((await virtualToken.balanceOf(addresses.taxVault)) - taxVaultBefore).to.equal(te.args.taxFee);

    const [rTok, rAsset] = await pair.getReserves();
    expect(te.args.reserveTokenAfter).to.equal(rTok);
    expect(te.args.reserveAssetAfter).to.equal(rAsset);
  });

  it("graduation emits Graduated + a final TradeExecuted", async function () {
    const { user1 } = accounts;
    const { bondingV5, fRouterV3, virtualToken } = contracts;

    // Buy well past the graduation threshold (target raise ~42000 VT).
    const bigBuy = ethers.parseEther("100000");
    await virtualToken.connect(user1).approve(addresses.fRouterV3, bigBuy);
    const tx = await bondingV5.connect(user1).buy(bigBuy, tokenAddress, 0, (await time.latest()) + 300);
    const receipt = await tx.wait();

    // The triggering buy still emits its TradeExecuted before graduation.
    const te = parseOne(fRouterV3, receipt, "TradeExecuted");
    expect(te, "TradeExecuted emitted on graduating buy").to.not.be.undefined;
    expect(te.args.isBuy).to.equal(true);

    const grad = parseOne(bondingV5, receipt, "Graduated");
    expect(grad, "Graduated emitted").to.not.be.undefined;
    expect(grad.args.token).to.equal(tokenAddress);
    const agentToken = grad.args.agentToken;
    expect(agentToken).to.not.equal(ethers.ZeroAddress);

    const info = await bondingV5.tokenInfo(tokenAddress);
    expect(info.tradingOnUniswap).to.equal(true);
  });
});
