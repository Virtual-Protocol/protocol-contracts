const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { setupNewLaunchpadTest } = require("./setup");
const {
  ERR_ZERO_ADDRESSES,
  ERR_AMOUNT_MUST_BE_GREATER_THAN_ZERO,
} = require("./const");

describe("FRouterV2", function () {
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
      const { fRouterV2, fFactoryV2, virtualToken } = contracts;

      expect(await fRouterV2.owner()).to.equal(owner.address);
      expect(await fRouterV2.factory()).to.equal(await fFactoryV2.getAddress());
      expect(await fRouterV2.assetToken()).to.equal(
        await virtualToken.getAddress()
      );
    });

    it("Should have correct roles set", async function () {
      const { owner } = accounts;
      const { fRouterV2 } = contracts;

      expect(
        await fRouterV2.hasRole(
          await fRouterV2.DEFAULT_ADMIN_ROLE(),
          owner.address
        )
      ).to.be.true;
    });
  });

  describe("getAmountsOut", function () {
    let tokenAddress, pairAddress;

    beforeEach(async function () {
      const { owner } = accounts;
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token and pair for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      tokenAddress = await mockToken.getAddress();

      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const tx = await fFactoryV2
        .connect(owner)
        .createPair(tokenAddress, await virtualToken.getAddress(), startTime);

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
      pairAddress = parsedEvent.args.pair;
    });

    it("Should calculate amounts out correctly", async function () {
      const { fRouterV2, virtualToken } = contracts;

      const amountIn = ethers.parseEther("100");

      // This will depend on the pair's reserves and k value
      // For now, just test that the function doesn't revert
      const amountOut = await fRouterV2.getAmountsOut(
        tokenAddress,
        await virtualToken.getAddress(),
        amountIn
      );

      expect(amountOut).to.be.a("bigint");
    });

    it("Should fail with zero token address", async function () {
      const { fRouterV2, virtualToken } = contracts;

      await expect(
        fRouterV2.getAmountsOut(
          ethers.ZeroAddress,
          await virtualToken.getAddress(),
          ethers.parseEther("100")
        )
      ).to.be.revertedWith(ERR_ZERO_ADDRESSES);
    });
  });

  describe("addInitialLiquidity", function () {
    let tokenAddress, pairAddress;

    beforeEach(async function () {
      const { owner } = accounts;
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token and pair for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      tokenAddress = await mockToken.getAddress();

      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const tx = await fFactoryV2
        .connect(owner)
        .createPair(tokenAddress, await virtualToken.getAddress(), startTime);

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
      pairAddress = parsedEvent.args.pair;
    });

    it("Should add initial liquidity successfully", async function () {
      const { bondingV2 } = contracts;

      const amountToken = ethers.parseEther("1000");
      const amountAsset = ethers.parseEther("1000");

      // Approve tokens for the router
      const tokenContract = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
        tokenAddress
      );
      await tokenContract
        .connect(accounts.owner)
        .approve(addresses.fRouterV2, amountToken);

      const tx = await fRouterV2
        .connect(bondingV2)
        .addInitialLiquidity(tokenAddress, amountToken, amountAsset);

      expect(tx).to.not.be.undefined;
    });

    it("Should fail with zero token address", async function () {
      const { bondingV2 } = contracts;

      await expect(
        fRouterV2
          .connect(bondingV2)
          .addInitialLiquidity(
            ethers.ZeroAddress,
            ethers.parseEther("1000"),
            ethers.parseEther("1000")
          )
      ).to.be.revertedWith(ERR_ZERO_ADDRESSES);
    });

    it("Should fail without EXECUTOR_ROLE", async function () {
      const { user1 } = accounts;
      const { fRouterV2 } = contracts;

      await expect(
        fRouterV2
          .connect(user1)
          .addInitialLiquidity(
            tokenAddress,
            ethers.parseEther("1000"),
            ethers.parseEther("1000")
          )
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fRouterV2.EXECUTOR_ROLE()}`
      );
    });
  });

  describe("buy", function () {
    let tokenAddress, pairAddress;

    beforeEach(async function () {
      const { owner } = accounts;
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token and pair for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      tokenAddress = await mockToken.getAddress();

      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const tx = await fFactoryV2
        .connect(owner)
        .createPair(tokenAddress, await virtualToken.getAddress(), startTime);

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
      pairAddress = parsedEvent.args.pair;
    });

    it("Should execute buy successfully", async function () {
      const { bondingV2, virtualToken } = contracts;
      const { user1 } = accounts;

      const amountIn = ethers.parseEther("100");

      // Approve virtual tokens for the router
      await virtualToken.connect(user1).approve(addresses.fRouterV2, amountIn);

      const tx = await fRouterV2
        .connect(bondingV2)
        .buy(amountIn, tokenAddress, user1.address);

      expect(tx).to.not.be.undefined;
    });

    it("Should fail with zero addresses", async function () {
      const { bondingV2 } = contracts;

      await expect(
        fRouterV2
          .connect(bondingV2)
          .buy(ethers.parseEther("100"), ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWith(ERR_ZERO_ADDRESSES);
    });

    it("Should fail with zero amount", async function () {
      const { bondingV2 } = contracts;
      const { user1 } = accounts;

      await expect(
        fRouterV2.connect(bondingV2).buy(0, tokenAddress, user1.address)
      ).to.be.revertedWith(ERR_AMOUNT_MUST_BE_GREATER_THAN_ZERO);
    });

    it("Should fail without EXECUTOR_ROLE", async function () {
      const { user1 } = accounts;
      const { fRouterV2 } = contracts;

      await expect(
        fRouterV2
          .connect(user1)
          .buy(ethers.parseEther("100"), tokenAddress, user1.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fRouterV2.EXECUTOR_ROLE()}`
      );
    });
  });

  describe("sell", function () {
    let tokenAddress, pairAddress;

    beforeEach(async function () {
      const { owner } = accounts;
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token and pair for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      tokenAddress = await mockToken.getAddress();

      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const tx = await fFactoryV2
        .connect(owner)
        .createPair(tokenAddress, await virtualToken.getAddress(), startTime);

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
      pairAddress = parsedEvent.args.pair;
    });

    it("Should execute sell successfully", async function () {
      const { bondingV2 } = contracts;
      const { user1 } = accounts;

      const amountIn = ethers.parseEther("100");

      // Approve tokens for the router
      const tokenContract = await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
        tokenAddress
      );
      await tokenContract.connect(user1).approve(addresses.fRouterV2, amountIn);

      const tx = await fRouterV2
        .connect(bondingV2)
        .sell(amountIn, tokenAddress, user1.address);

      expect(tx).to.not.be.undefined;
    });

    it("Should fail with zero addresses", async function () {
      const { bondingV2 } = contracts;

      await expect(
        fRouterV2
          .connect(bondingV2)
          .sell(
            ethers.parseEther("100"),
            ethers.ZeroAddress,
            ethers.ZeroAddress
          )
      ).to.be.revertedWith(ERR_ZERO_ADDRESSES);
    });

    it("Should fail without EXECUTOR_ROLE", async function () {
      const { user1 } = accounts;
      const { fRouterV2 } = contracts;

      await expect(
        fRouterV2
          .connect(user1)
          .sell(ethers.parseEther("100"), tokenAddress, user1.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fRouterV2.EXECUTOR_ROLE()}`
      );
    });
  });

  describe("graduate", function () {
    let tokenAddress, pairAddress;

    beforeEach(async function () {
      const { owner } = accounts;
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token and pair for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      tokenAddress = await mockToken.getAddress();

      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const tx = await fFactoryV2
        .connect(owner)
        .createPair(tokenAddress, await virtualToken.getAddress(), startTime);

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
      pairAddress = parsedEvent.args.pair;
    });

    it("Should graduate token successfully", async function () {
      const { bondingV2 } = contracts;

      const tx = await fRouterV2.connect(bondingV2).graduate(tokenAddress);

      expect(tx).to.not.be.undefined;
    });

    it("Should fail with zero token address", async function () {
      const { bondingV2 } = contracts;

      await expect(
        fRouterV2.connect(bondingV2).graduate(ethers.ZeroAddress)
      ).to.be.revertedWith(ERR_ZERO_ADDRESSES);
    });

    it("Should fail without EXECUTOR_ROLE", async function () {
      const { user1 } = accounts;
      const { fRouterV2 } = contracts;

      await expect(
        fRouterV2.connect(user1).graduate(tokenAddress)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fRouterV2.EXECUTOR_ROLE()}`
      );
    });
  });

  describe("approval", function () {
    let tokenAddress, pairAddress;

    beforeEach(async function () {
      const { owner } = accounts;
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token and pair for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      tokenAddress = await mockToken.getAddress();

      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const tx = await fFactoryV2
        .connect(owner)
        .createPair(tokenAddress, await virtualToken.getAddress(), startTime);

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
      pairAddress = parsedEvent.args.pair;
    });

    it("Should set approval successfully", async function () {
      const { bondingV2 } = contracts;
      const { user1 } = accounts;

      const amount = ethers.parseEther("1000");

      const tx = await fRouterV2
        .connect(bondingV2)
        .approval(pairAddress, tokenAddress, user1.address, amount);

      expect(tx).to.not.be.undefined;
    });

    it("Should fail with zero spender address", async function () {
      const { bondingV2 } = contracts;

      await expect(
        fRouterV2
          .connect(bondingV2)
          .approval(
            pairAddress,
            tokenAddress,
            ethers.ZeroAddress,
            ethers.parseEther("1000")
          )
      ).to.be.revertedWith(ERR_ZERO_ADDRESSES);
    });

    it("Should fail without EXECUTOR_ROLE", async function () {
      const { user1 } = accounts;
      const { fRouterV2 } = contracts;

      await expect(
        fRouterV2
          .connect(user1)
          .approval(
            pairAddress,
            tokenAddress,
            user1.address,
            ethers.parseEther("1000")
          )
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fRouterV2.EXECUTOR_ROLE()}`
      );
    });
  });

  describe("resetTime", function () {
    let tokenAddress, pairAddress;

    beforeEach(async function () {
      const { owner } = accounts;
      const { fFactoryV2, virtualToken } = contracts;

      // Create a mock token and pair for testing
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy(
        "Mock Token",
        "MOCK",
        owner.address,
        ethers.parseEther("1000000")
      );
      await mockToken.waitForDeployment();

      tokenAddress = await mockToken.getAddress();

      const startTime = Math.floor(Date.now() / 1000) + 3600;
      const tx = await fFactoryV2
        .connect(owner)
        .createPair(tokenAddress, await virtualToken.getAddress(), startTime);

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
      pairAddress = parsedEvent.args.pair;
    });

    it("Should reset time successfully", async function () {
      const { bondingV2 } = contracts;

      const newStartTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now

      const tx = await fRouterV2
        .connect(bondingV2)
        .resetTime(tokenAddress, newStartTime);

      expect(tx).to.not.be.undefined;
    });

    it("Should fail without EXECUTOR_ROLE", async function () {
      const { user1 } = accounts;
      const { fRouterV2 } = contracts;

      const newStartTime = Math.floor(Date.now() / 1000) + 7200;

      await expect(
        fRouterV2.connect(user1).resetTime(tokenAddress, newStartTime)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fRouterV2.EXECUTOR_ROLE()}`
      );
    });
  });

  describe("setTaxManager", function () {
    it("Should set tax manager successfully", async function () {
      const { owner, user1 } = accounts;
      const { fRouterV2 } = contracts;

      await fRouterV2.connect(owner).setTaxManager(user1.address);

      expect(await fRouterV2.taxManager()).to.equal(user1.address);
    });

    it("Should fail without admin role", async function () {
      const { user1, user2 } = accounts;
      const { fRouterV2 } = contracts;

      await expect(
        fRouterV2.connect(user1).setTaxManager(user2.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fRouterV2.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });

  describe("Access Control", function () {
    it("Should grant and revoke roles correctly", async function () {
      const { owner, user1 } = accounts;
      const { fRouterV2 } = contracts;

      const EXECUTOR_ROLE = await fRouterV2.EXECUTOR_ROLE();

      // Grant role
      await fRouterV2.connect(owner).grantRole(EXECUTOR_ROLE, user1.address);
      expect(await fRouterV2.hasRole(EXECUTOR_ROLE, user1.address)).to.be.true;

      // Revoke role
      await fRouterV2.connect(owner).revokeRole(EXECUTOR_ROLE, user1.address);
      expect(await fRouterV2.hasRole(EXECUTOR_ROLE, user1.address)).to.be.false;
    });

    it("Should fail to grant role without admin role", async function () {
      const { user1, user2 } = accounts;
      const { fRouterV2 } = contracts;

      const EXECUTOR_ROLE = await fRouterV2.EXECUTOR_ROLE();

      await expect(
        fRouterV2.connect(user1).grantRole(EXECUTOR_ROLE, user2.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${await fRouterV2.DEFAULT_ADMIN_ROLE()}`
      );
    });
  });
});
