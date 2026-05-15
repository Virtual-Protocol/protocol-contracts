/*
 * AgentFlow $FLOW closed-system protocol — full happy-path + edge tests.
 *
 * Coverage targets:
 *   - activate / re-activate revert / self-ref revert
 *   - buy: min, daily limit, daily refill, fee split, income limit
 *   - sell: full burn, proportional burn, daily refill credit
 *   - extendTree: months cap, marketing distribution, treasury dust
 *   - 10-level marketing payout: tree of 10, last user pays, all 9 + dust
 *   - spillover: 4th referral spills into a child
 *   - inactive ancestor -> dust
 *   - GWT: claim, redeem, redeem cap, redeem fee
 *
 * Run: npx hardhat test test/flow/flow.js
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { parseEther, ZeroAddress } = require("ethers");

const ONE = parseEther("1");

async function deployFixture() {
  const [admin, treasury, root, alice, bob, carol, dave, eve, frank, ...rest] =
    await ethers.getSigners();

  // 1. Mock USDT (18-dec).
  const Mock = await ethers.getContractFactory("MockERC20");
  const usdt = await Mock.deploy(
    "Mock USDT",
    "mUSDT",
    admin.address,
    parseEther("100000000"),
  );

  // The four sub-contracts are clonable (EIP-1167) with
  // `_disableInitializers()` baked into their implementation constructor —
  // they cannot be used standalone. We use a tiny `Cloner` helper to
  // deploy fresh proxy instances for tests.
  const Cloner = await ethers.getContractFactory("Cloner");
  const cloner = await Cloner.deploy();

  async function deployClone(name, initArgs) {
    const Impl = await ethers.getContractFactory(name);
    const impl = await Impl.deploy();
    await impl.waitForDeployment();
    const tx = await cloner.clone(await impl.getAddress());
    const r = await tx.wait();
    const ev = r.logs
      .map((l) => {
        try {
          return cloner.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "Cloned");
    const inst = await ethers.getContractAt(name, ev.args.instance);
    if (initArgs) await (await inst.initialize(...initArgs)).wait();
    return inst;
  }

  // 2. FLOW token (clone).
  const flow = await deployClone("Flow", [admin.address, "AgentFlow", "FLOW"]);

  // 3. GWT token (clone).
  const gwt = await deployClone("FlowGrowToken", [
    admin.address,
    "Flow Grow",
    "GWT",
  ]);

  // 4. Phenomenal Tree (clone). Root = `root` signer.
  const tree = await deployClone("PhenomenalTree", [admin.address, root.address]);

  // 5. Protocol (clone).
  const initialPrice = parseEther("0.1"); // 0.1 USDT/FLOW
  const protocol = await deployClone("FlowProtocol", [
    admin.address,
    await usdt.getAddress(),
    await flow.getAddress(),
    await gwt.getAddress(),
    await tree.getAddress(),
    treasury.address,
    initialPrice,
  ]);

  // 6. Wire roles.
  const MINTER = await flow.MINTER_ROLE();
  await flow.connect(admin).grantRole(MINTER, await protocol.getAddress());
  await gwt
    .connect(admin)
    .grantRole(await gwt.MINTER_ROLE(), await protocol.getAddress());
  const OP = await tree.TREE_OPERATOR_ROLE();
  await tree.connect(admin).grantRole(OP, await protocol.getAddress());

  // 7. Fund test users with USDT and approve protocol.
  const fund = parseEther("100000");
  for (const u of [alice, bob, carol, dave, eve, frank, ...rest.slice(0, 12)]) {
    await usdt.connect(admin).transfer(u.address, fund);
    await usdt.connect(u).approve(await protocol.getAddress(), ethers.MaxUint256);
  }
  // Also fund root signer so they can be referrer (root is special — not user).
  return {
    admin,
    treasury,
    root,
    alice,
    bob,
    carol,
    dave,
    eve,
    frank,
    rest,
    usdt,
    flow,
    gwt,
    tree,
    protocol,
    initialPrice,
  };
}

describe("Flow — activation", function () {
  it("activates a user, places them under root, debits $10", async function () {
    const f = await loadFixture(deployFixture);
    const balBefore = await f.usdt.balanceOf(f.alice.address);
    await f.protocol.connect(f.alice).activate(ZeroAddress); // referrer = root
    expect(await f.protocol.isActivated(f.alice.address)).to.equal(true);
    expect(await f.usdt.balanceOf(f.alice.address)).to.equal(
      balBefore - parseEther("10"),
    );
    // Pool gained $1, treasury gained $4, $5 went to dust (no ancestors).
    expect(await f.protocol.poolUSDT()).to.equal(parseEther("1"));
    expect(await f.protocol.treasuryUSDT()).to.equal(parseEther("9")); // 4 + 5 dust
  });

  it("reverts on double activation", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await expect(
      f.protocol.connect(f.alice).activate(ZeroAddress),
    ).to.be.revertedWithCustomError(f.protocol, "AlreadyActivated");
  });

  it("reverts on self-referral", async function () {
    const f = await loadFixture(deployFixture);
    await expect(
      f.protocol.connect(f.alice).activate(f.alice.address),
    ).to.be.revertedWithCustomError(f.protocol, "SelfReferral");
  });

  it("reverts when referrer not activated", async function () {
    const f = await loadFixture(deployFixture);
    await expect(
      f.protocol.connect(f.alice).activate(f.bob.address),
    ).to.be.revertedWithCustomError(f.protocol, "ReferrerNotActivated");
  });
});

describe("Flow — buy", function () {
  it("happy: $50 buy mints, splits fees, sets income limit 1:2", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);

    const poolBefore = await f.protocol.poolUSDT();
    await f.protocol.connect(f.alice).buy(parseEther("50"));

    // Income limit = $100.
    expect(await f.protocol.incomeLimit(f.alice.address)).to.equal(
      parseEther("100"),
    );
    // FLOW minted at price = poolBefore / 0  -> initialPrice = 0.1 USDT.
    // netUSDT = 50 * 0.8 = 40. mint = 40 / 0.1 = 400 FLOW.
    expect(await f.flow.balanceOf(f.alice.address)).to.equal(parseEther("400"));
    // Pool: poolBefore + (40 net + 5 fee_pool) = 1 + 45 = 46.
    expect(await f.protocol.poolUSDT()).to.equal(poolBefore + parseEther("45"));
    // GWT pending == fee total = $10.
    expect(await f.protocol.pendingGWT(f.alice.address)).to.equal(
      parseEther("10"),
    );
  });

  it("rejects buys below $20 minimum", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await expect(
      f.protocol.connect(f.alice).buy(parseEther("19")),
    ).to.be.revertedWithCustomError(f.protocol, "BelowMinimum");
  });

  it("daily limit: $51 in one window fails after $50 went through", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.alice).buy(parseEther("50"));
    await expect(
      f.protocol.connect(f.alice).buy(parseEther("20")),
    ).to.be.revertedWithCustomError(f.protocol, "DailyLimitExceeded");
  });

  it("daily limit resets after 24h", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.alice).buy(parseEther("50"));
    await time.increase(24 * 3600 + 1);
    await f.protocol.connect(f.alice).buy(parseEther("50"));
  });

  it("requires activation", async function () {
    const f = await loadFixture(deployFixture);
    await expect(
      f.protocol.connect(f.alice).buy(parseEther("20")),
    ).to.be.revertedWithCustomError(f.protocol, "NotActivated");
  });
});

describe("Flow — sell + income limit math", function () {
  it("full sell within limit burns 1:1 in tokens, debits limit by value", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.alice).buy(parseEther("50"));
    // alice has 400 FLOW, limit 100, price 46/400 = 0.115 USDT/FLOW.
    // Sell 200 FLOW -> value = 200 * 0.115 = 23 USDT < limit.
    const flowToSell = parseEther("200");
    const flowBalBefore = await f.flow.balanceOf(f.alice.address);
    const limitBefore = await f.protocol.incomeLimit(f.alice.address);
    // Capture price BEFORE the sell — value is computed against pre-state.
    const priceBefore = await f.protocol.priceFLOW();
    await f.protocol.connect(f.alice).sell(flowToSell);
    expect(await f.flow.balanceOf(f.alice.address)).to.equal(
      flowBalBefore - flowToSell,
    );
    const expectedValue = (parseEther("200") * priceBefore) / parseEther("1");
    expect(await f.protocol.incomeLimit(f.alice.address)).to.equal(
      limitBefore - expectedValue,
    );
  });

  it("proportional burn when value > income limit", async function () {
    // Use a low-initial-price deployment so price can climb past
    // (limit / tokens) within reasonable iterations. This isolates the
    // proportional-burn math from the slow asymptotic price growth.
    const signers = await ethers.getSigners();
    const [admin, treasury, root, alice, bob] = signers;
    const donors = signers.slice(5, 18); // 13 extra users for pump
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdt = await Mock.deploy("U", "U", admin.address, parseEther("100000000"));

    // Clonable sub-contracts deployed via Cloner helper.
    const Cloner = await ethers.getContractFactory("Cloner");
    const cloner = await Cloner.deploy();
    const deployClone = async (name, initArgs) => {
      const Impl = await ethers.getContractFactory(name);
      const impl = await Impl.deploy();
      await impl.waitForDeployment();
      const tx = await cloner.clone(await impl.getAddress());
      const r = await tx.wait();
      const ev = r.logs
        .map((l) => {
          try {
            return cloner.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "Cloned");
      const inst = await ethers.getContractAt(name, ev.args.instance);
      if (initArgs) await (await inst.initialize(...initArgs)).wait();
      return inst;
    };
    const flow = await deployClone("Flow", [admin.address, "AgentFlow", "FLOW"]);
    const gwt = await deployClone("FlowGrowToken", [
      admin.address,
      "Flow Grow",
      "GWT",
    ]);
    const tree = await deployClone("PhenomenalTree", [admin.address, root.address]);
    const initialPrice = parseEther("0.001"); // very low
    const protocol = await deployClone("FlowProtocol", [
      admin.address,
      await usdt.getAddress(),
      await flow.getAddress(),
      await gwt.getAddress(),
      await tree.getAddress(),
      treasury.address,
      initialPrice,
    ]);
    await flow.connect(admin).grantRole(await flow.MINTER_ROLE(), await protocol.getAddress());
    await gwt.connect(admin).grantRole(await gwt.MINTER_ROLE(), await protocol.getAddress());
    await tree.connect(admin).grantRole(await tree.TREE_OPERATOR_ROLE(), await protocol.getAddress());
    for (const u of [alice, bob, ...donors]) {
      await usdt.connect(admin).transfer(u.address, parseEther("1000000"));
      await usdt.connect(u).approve(await protocol.getAddress(), ethers.MaxUint256);
    }

    await protocol.connect(alice).activate(ZeroAddress);
    await protocol.connect(alice).buy(parseEther("20"));
    // alice: limit $40, mint = 16 / 0.001 = 16000 FLOW. pool ≈ 19. price ≈ 0.001.

    // Donors pump pool via extendTree (each call adds $1 to pool with NO
    // mint — the cleanest way to ratchet price/supply ratio).
    for (const d of donors) {
      await protocol.connect(d).activate(ZeroAddress);
      await protocol.connect(d).extendTree(3); // +$3 pool per donor
    }

    // Now alice's 16000 FLOW likely worth >> $40.
    const flowAmt = await flow.balanceOf(alice.address);
    const priceNow = await protocol.priceFLOW();
    const valueGross = (flowAmt * priceNow) / parseEther("1");
    const limit = await protocol.incomeLimit(alice.address);
    expect(valueGross).to.be.greaterThan(limit);

    const expectedBurn = (flowAmt * limit) / valueGross;
    const balBefore = await flow.balanceOf(alice.address);
    await protocol.connect(alice).sell(flowAmt);
    expect(await protocol.incomeLimit(alice.address)).to.equal(0n);
    const burned = balBefore - (await flow.balanceOf(alice.address));
    expect(burned).to.equal(expectedBurn);
  });

  it("sell refills daily limit credit (48h sliding)", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.alice).buy(parseEther("50"));
    // sell ~$23 worth (200 flow) -> refill credit ~$23.
    await f.protocol.connect(f.alice).sell(parseEther("200"));
    // try buying $73 within same window (50 base + 23 credit allowed).
    // Need to wait 24h to reset boughtToday counter.
    await time.increase(24 * 3600 + 1);
    // Now: base 50, refill credit ~23 still in window.
    // Buy $70 should succeed (50 + 20 used of 23 credit).
    await f.protocol.connect(f.alice).buy(parseEther("70"));
  });

  it("rejects sell with zero income limit", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await expect(
      f.protocol.connect(f.alice).sell(parseEther("1")),
    ).to.be.revertedWithCustomError(f.protocol, "InsufficientLimit");
  });
});

describe("Flow — extendTree + marketing payout", function () {
  it("extends 1 month, distributes 5 USDT", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.alice).extendTree(1);
    const u = await f.protocol.userState(f.alice.address);
    // activeUntil ~ now + 30 days.
    const now = await time.latest();
    expect(u._activeUntil).to.be.greaterThan(BigInt(now + 29 * 86400));
  });

  it("rejects 0 or 4+ months", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await expect(
      f.protocol.connect(f.alice).extendTree(0),
    ).to.be.revertedWithCustomError(f.protocol, "InvalidExtendMonths");
    await expect(
      f.protocol.connect(f.alice).extendTree(4),
    ).to.be.revertedWithCustomError(f.protocol, "InvalidExtendMonths");
  });

  it("caps stack at 90 days", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.alice).extendTree(3); // 90 days from now
    await expect(
      f.protocol.connect(f.alice).extendTree(1),
    ).to.be.revertedWithCustomError(f.protocol, "ExtendCapExceeded");
  });

  it("10-level marketing payout: each ancestor receives correct level reward", async function () {
    const f = await loadFixture(deployFixture);
    // Build a 10-deep chain: root <- a0 <- a1 <- ... <- a9.
    // We have alice, bob, carol, dave, eve, frank + 4 from rest.
    const chain = [f.alice, f.bob, f.carol, f.dave, f.eve, f.frank, ...f.rest.slice(0, 4)];
    expect(chain.length).to.equal(10);

    // Activate each under previous; activate all so they're "active" via extendTree.
    let prev = ZeroAddress;
    for (const u of chain) {
      await f.protocol.connect(u).activate(prev);
      await f.protocol.connect(u).extendTree(1);
      prev = u.address;
    }

    // Last user pays extendTree again — ancestors should each receive their level reward.
    const last = chain[9];
    const balsBefore = [];
    for (let i = 0; i < 9; i++) {
      balsBefore.push(await f.usdt.balanceOf(chain[i].address));
    }

    // Paid for 1 month of extension by `last`. The walk goes UP from last:
    // a8 (L1=0.1), a7 (L2=0.1), a6 (L3=0.1), a5 (L4=0.5), a4 (L5=0.5),
    // a3 (L6=0.5), a2 (L7=0.8), a1 (L8=0.8), a0 (L9=0.8). L10 = root => dust.
    await f.protocol.connect(last).extendTree(1);

    const expected = [
      parseEther("0.8"), // a0 at L9
      parseEther("0.8"), // a1 at L8
      parseEther("0.8"), // a2 at L7
      parseEther("0.5"), // a3 at L6
      parseEther("0.5"), // a4 at L5
      parseEther("0.5"), // a5 at L4
      parseEther("0.1"), // a6 at L3
      parseEther("0.1"), // a7 at L2
      parseEther("0.1"), // a8 at L1
    ];
    for (let i = 0; i < 9; i++) {
      const balAfter = await f.usdt.balanceOf(chain[i].address);
      const gained = balAfter - balsBefore[i];
      expect(gained).to.equal(
        expected[i],
        `ancestor ${i} got wrong reward`,
      );
    }
  });

  it("inactive ancestor: their share -> dust (treasury)", async function () {
    const f = await loadFixture(deployFixture);
    // alice (no extend) <- bob (extend) — bob pays extendTree, alice
    // is inactive so her L1 share goes to treasury.
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.bob).activate(f.alice.address);
    const treasuryBefore = await f.protocol.treasuryUSDT();
    const aliceBefore = await f.usdt.balanceOf(f.alice.address);
    await f.protocol.connect(f.bob).extendTree(1);
    expect(await f.usdt.balanceOf(f.alice.address)).to.equal(aliceBefore);
    // treasury increased by at least the marketing dust + 4 USDT direct + 1-USDT-pool excluded.
    expect(await f.protocol.treasuryUSDT()).to.be.greaterThan(treasuryBefore);
  });
});

describe("Flow — spillover", function () {
  it("4th referral spills into a child of the referrer", async function () {
    const f = await loadFixture(deployFixture);
    // alice with 3 direct referrals — bob, carol, dave fill her L1.
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.bob).activate(f.alice.address);
    await f.protocol.connect(f.carol).activate(f.alice.address);
    await f.protocol.connect(f.dave).activate(f.alice.address);

    // Alice is at depth 1 (under tree root). Her direct referrals occupy
    // her L1 child slots, so they sit at depth 2.
    expect(await f.tree.getDepth(f.alice.address)).to.equal(1n);
    expect(await f.tree.getDepth(f.bob.address)).to.equal(2n);
    expect(await f.tree.getDepth(f.carol.address)).to.equal(2n);
    expect(await f.tree.getDepth(f.dave.address)).to.equal(2n);

    // 4th — alice's slots full -> spill into the lightest of {bob,carol,dave}.
    // Whichever we pick, the new node lands at depth 3.
    await f.protocol.connect(f.eve).activate(f.alice.address);
    expect(await f.tree.getDepth(f.eve.address)).to.equal(3n);

    // Eve's parent is one of bob/carol/dave.
    const parent = await f.tree.getParent(f.eve.address);
    expect(
      [f.bob.address, f.carol.address, f.dave.address].includes(parent),
    ).to.equal(true);
  });
});

describe("Flow — GWT", function () {
  it("claimGWT mints accumulated fee credit 1:1", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await f.protocol.connect(f.alice).buy(parseEther("50")); // fee 10
    expect(await f.protocol.pendingGWT(f.alice.address)).to.equal(
      parseEther("10"),
    );
    await f.protocol.connect(f.alice).claimGWT();
    expect(await f.gwt.balanceOf(f.alice.address)).to.equal(parseEther("10"));
    expect(await f.protocol.pendingGWT(f.alice.address)).to.equal(0n);
  });

  it("claim with nothing reverts", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    await expect(
      f.protocol.connect(f.alice).claimGWT(),
    ).to.be.revertedWithCustomError(f.protocol, "NothingToClaim");
  });

  it("buyIncomeLimitWithGWT: 4 GWT -> +5 USDT limit, fee $2, capped at 10% lifetime", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    // accumulate enough GWT — buy a few times.
    await f.protocol.connect(f.alice).buy(parseEther("50"));
    await time.increase(24 * 3600 + 1);
    await f.protocol.connect(f.alice).buy(parseEther("50"));
    await f.protocol.connect(f.alice).claimGWT();
    // alice has 20 GWT, lifetime limit = 200 USDT. Cap = 20 USDT income limit.
    // 4 GWT -> 5 USDT limit, fee $2.
    const limitBefore = await f.protocol.incomeLimit(f.alice.address);
    await f.protocol.connect(f.alice).buyIncomeLimitWithGWT(parseEther("4"));
    expect(await f.protocol.incomeLimit(f.alice.address)).to.equal(
      limitBefore + parseEther("5"),
    );
    // Try to redeem more than 10% cap (20 USDT limit). 16 GWT -> 20 USDT. We
    // already used 5, so 16 GWT -> 20 USDT would push lifetimeGwtRedeem to 25.
    await expect(
      f.protocol.connect(f.alice).buyIncomeLimitWithGWT(parseEther("16")),
    ).to.be.revertedWithCustomError(f.protocol, "GwtRedeemCapExceeded");
  });
});

describe("Flow — admin / pausing", function () {
  it("pause blocks user actions", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.admin).pause();
    await expect(
      f.protocol.connect(f.alice).activate(ZeroAddress),
    ).to.be.revertedWithCustomError(f.protocol, "EnforcedPause");
  });

  it("withdrawTreasury reduces treasuryUSDT and transfers", async function () {
    const f = await loadFixture(deployFixture);
    await f.protocol.connect(f.alice).activate(ZeroAddress);
    const t = await f.protocol.treasuryUSDT();
    const balBefore = await f.usdt.balanceOf(f.treasury.address);
    await f.protocol.connect(f.admin).withdrawTreasury(t, f.treasury.address);
    expect(await f.protocol.treasuryUSDT()).to.equal(0n);
    expect(await f.usdt.balanceOf(f.treasury.address)).to.equal(balBefore + t);
  });
});
