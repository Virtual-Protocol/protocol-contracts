const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupNewLaunchpadTest } = require("./setup");
const { ERR_ZERO_ADDRESSES, BUY_TAX, SELL_TAX } = require("./const");

describe("FFactoryV2", function () {
  let setup;
  let contracts, accounts, addresses, params;

  before(async function () {
    setup = await loadFixture(setupNewLaunchpadTest);
    contracts = setup.contracts;
    accounts = setup.accounts;
    addresses = setup.addresses;
    params = setup.params;
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial parameters", async function () {
      const { owner } = accounts;
      const { fFactoryV2 } = contracts;

      expect(await fFactoryV2.owner()).to.equal(owner.address);
      expect(await fFactoryV2.buyTax()).to.equal(BUY_TAX);
      expect(await fFactoryV2.sellTax()).to.equal(SELL_TAX);
    });

    it("Should have correct roles set", async function () {
      const { owner } = accounts;
      const { fFactoryV2 } = contracts;

      expect(
        await fFactoryV2.hasRole(
          await fFactoryV2.DEFAULT_ADMIN_ROLE(),
          owner.address
        )
      ).to.be.true;
    });
  });

  describe("createPair", function () {
    it("Should create a new pair successfully", async function () {
      const { bondingV2, virtualToken } = contracts;
      const { owner } = accounts;

      // Create a mock token for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      const startTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      const tx = await fFactoryV2
        .connect(owner)
        .createPair(
          await mockToken.getAddress(),
          await virtualToken.getAddress(),
          startTime
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = fFactoryV2.interface.parseLog(log);
          return parsed.name === "PairCreated";
        } catch (e) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsedEvent = fFactoryV2.interface.parseLog(event);
      const pairAddress = parsedEvent.args.pair;

      expect(pairAddress).to.not.equal(ethers.ZeroAddress);
      expect(parsedEvent.args.tokenA).to.equal(await mockToken.getAddress());
      expect(parsedEvent.args.tokenB).to.equal(await virtualToken.getAddress());

      // Verify pair was stored
      const storedPair = await fFactoryV2.getPair(
        await mockToken.getAddress(),
        await virtualToken.getAddress()
      );
      expect(storedPair).to.equal(pairAddress);
    });

    it("Should fail with zero addresses", async function () {
      const { owner } = accounts;
      const { fFactoryV2 } = contracts;

      await expect(
        fFactoryV2
          .connect(owner)
          .createPair(
            ethers.ZeroAddress,
            ethers.ZeroAddress,
            Math.floor(Date.now() / 1000) + 3600
          )
      ).to.be.revertedWith(ERR_ZERO_ADDRESSES);
    });

    it("Should fail without CREATOR_ROLE", async function () {
      const { user1 } = accounts;
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        user1.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      await expect(
        fFactoryV2
          .connect(user1)
          .createPair(
            await mockToken.getAddress(),
            await virtualToken.getAddress(),
            Math.floor(Date.now() / 1000) + 3600
          )
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fFactoryV2.CREATOR_ROLE()}`
      );
    });
  });

  describe("getPair", function () {
    it("Should return correct pair address", async function () {
      const { bondingV2, virtualToken } = contracts;
      const { owner } = accounts;

      // Create a mock token for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      const startTime = Math.floor(Date.now() / 1000) + 3600;

      // Create pair
      const tx = await fFactoryV2
        .connect(owner)
        .createPair(
          await mockToken.getAddress(),
          await virtualToken.getAddress(),
          startTime
        );

      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          const parsed = fFactoryV2.interface.parseLog(log);
          return parsed.name === "PairCreated";
        } catch (e) {
          return false;
        }
      });

      const parsedEvent = fFactoryV2.interface.parseLog(event);
      const expectedPairAddress = parsedEvent.args.pair;

      // Get pair
      const pairAddress = await fFactoryV2.getPair(
        await mockToken.getAddress(),
        await virtualToken.getAddress()
      );

      expect(pairAddress).to.equal(expectedPairAddress);
    });

    it("Should return zero address for non-existent pair", async function () {
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        ethers.ZeroAddress,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      const pairAddress = await fFactoryV2.getPair(
        await mockToken.getAddress(),
        await virtualToken.getAddress()
      );

      expect(pairAddress).to.equal(ethers.ZeroAddress);
    });
  });

  describe("allPairsLength", function () {
    it("Should return correct number of pairs", async function () {
      const { fFactoryV2 } = contracts;

      const initialLength = await fFactoryV2.allPairsLength();
      expect(initialLength).to.equal(0);
    });

    it("Should increment after creating pairs", async function () {
      const { bondingV2, virtualToken } = contracts;
      const { owner } = accounts;

      const initialLength = await fFactoryV2.allPairsLength();

      // Create a mock token for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      const startTime = Math.floor(Date.now() / 1000) + 3600;

      // Create pair
      await fFactoryV2
        .connect(owner)
        .createPair(
          await mockToken.getAddress(),
          await virtualToken.getAddress(),
          startTime
        );

      const newLength = await fFactoryV2.allPairsLength();
      expect(newLength).to.equal(initialLength + 1n);
    });
  });

  describe("setRouter", function () {
    it("Should set router successfully", async function () {
      const { owner } = accounts;
      const { fFactoryV2, fRouterV2 } = contracts;

      // Deploy a new router for testing
      const FRouterV2 = await ethers.getContractFactory("FRouter");
      const newRouter = await upgrades.deployProxy(
        FRouterV2,
        [addresses.fFactoryV2, addresses.virtualToken],
        { initializer: "initialize" }
      );
      await newRouter.waitForDeployment();

      await fFactoryV2.connect(owner).setRouter(await newRouter.getAddress());

      expect(await fFactoryV2.router()).to.equal(await newRouter.getAddress());
    });

    it("Should fail without admin role", async function () {
      const { user1 } = accounts;
      const { fFactoryV2 } = contracts;

      await expect(
        fFactoryV2.connect(user1).setRouter(user1.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fFactoryV2.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });

  describe("setTaxVault", function () {
    it("Should set tax vault successfully", async function () {
      const { owner, user1 } = accounts;
      const { fFactoryV2 } = contracts;

      await fFactoryV2.connect(owner).setTaxVault(user1.address);

      expect(await fFactoryV2.taxVault()).to.equal(user1.address);
    });

    it("Should fail without admin role", async function () {
      const { user1, user2 } = accounts;
      const { fFactoryV2 } = contracts;

      await expect(
        fFactoryV2.connect(user1).setTaxVault(user2.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fFactoryV2.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });

  describe("setBuyTax", function () {
    it("Should set buy tax successfully", async function () {
      const { owner } = accounts;
      const { fFactoryV2 } = contracts;

      const newBuyTax = 200; // 2%
      await fFactoryV2.connect(owner).setBuyTax(newBuyTax);

      expect(await fFactoryV2.buyTax()).to.equal(newBuyTax);
    });

    it("Should fail without admin role", async function () {
      const { user1 } = accounts;
      const { fFactoryV2 } = contracts;

      await expect(fFactoryV2.connect(user1).setBuyTax(200)).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fFactoryV2.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });

  describe("setSellTax", function () {
    it("Should set sell tax successfully", async function () {
      const { owner } = accounts;
      const { fFactoryV2 } = contracts;

      const newSellTax = 200; // 2%
      await fFactoryV2.connect(owner).setSellTax(newSellTax);

      expect(await fFactoryV2.sellTax()).to.equal(newSellTax);
    });

    it("Should fail without admin role", async function () {
      const { user1 } = accounts;
      const { fFactoryV2 } = contracts;

      await expect(
        fFactoryV2.connect(user1).setSellTax(200)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fFactoryV2.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });

  describe("Access Control", function () {
    it("Should grant and revoke roles correctly", async function () {
      const { owner, user1 } = accounts;
      const { fFactoryV2 } = contracts;

      const CREATOR_ROLE = await fFactoryV2.CREATOR_ROLE();

      // Grant role
      await fFactoryV2.connect(owner).grantRole(CREATOR_ROLE, user1.address);
      expect(await fFactoryV2.hasRole(CREATOR_ROLE, user1.address)).to.be.true;

      // Revoke role
      await fFactoryV2.connect(owner).revokeRole(CREATOR_ROLE, user1.address);
      expect(await fFactoryV2.hasRole(CREATOR_ROLE, user1.address)).to.be.false;
    });

    it("Should fail to grant role without admin role", async function () {
      const { user1, user2 } = accounts;
      const { fFactoryV2 } = contracts;

      const CREATOR_ROLE = await fFactoryV2.CREATOR_ROLE();

      await expect(
        fFactoryV2.connect(user1).grantRole(CREATOR_ROLE, user2.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fFactoryV2.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });
});
