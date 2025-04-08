const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("Genesis Launch Tests", function () {
  let virtualToken;
  let genesis;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    console.log("\n=== Test Setup Started ===");

    try {
      // Get signers
      [owner, user1, user2] = await ethers.getSigners();
      console.log("Owner address:", owner.address);
      console.log("User1 address:", user1.address);
      console.log("User2 address:", user2.address);

      // Deploy ERC20Mock
      console.log("\nDeploying ERC20Mock...");
      const VirtualToken = await ethers.getContractFactory("ERC20Mock");
      virtualToken = await VirtualToken.deploy(
        "Virtual Token", // name
        "VT", // symbol
        owner.address, // initialAccount
        ethers.parseEther("1000000") // initialBalance
      );
      await virtualToken.waitForDeployment();
      console.log("ERC20Mock deployed to:", virtualToken.target);
      console.log(
        "Initial supply:",
        await virtualToken.balanceOf(owner.address)
      );

      // Deploy FGenesis implementation and proxy
      console.log("\nDeploying FGenesis...");
      const FGenesis = await ethers.getContractFactory("FGenesis", owner);

      // 部署实现合约
      const fGenesisImpl = await FGenesis.deploy();
      await fGenesisImpl.waitForDeployment();
      console.log("FGenesis implementation deployed to:", fGenesisImpl.target);

      // 部署代理合约
      const Proxy = await ethers.getContractFactory(
        "TransparentUpgradeableProxy"
      );
      const initializeData = fGenesisImpl.interface.encodeFunctionData(
        "initialize",
        [
          virtualToken.target, // virtualTokenAddress
          virtualToken.target, // virtualsFactory
          42525n, // reserveAmount - 使用 BigInt
          566n, // maxContributionVirtualAmount - 使用 BigInt
          1000000000000000000n, // creationFeeAmount - 使用 BigInt
          86400n, // duration - 使用 BigInt
        ]
      );

      const proxy = await Proxy.deploy(
        fGenesisImpl.target, // implementation address
        owner.address, // admin address
        initializeData // 编码初始化数据
      );
      await proxy.waitForDeployment();
      console.log("Proxy deployed to:", proxy.target);

      // 通过代理获取 FGenesis 实例
      const fGenesis = FGenesis.attach(proxy.target);

      // 验证 owner
      const fGenesisOwner = await fGenesis.owner();
      console.log("\nFGenesis ownership:");
      console.log("Current owner:", fGenesisOwner);
      console.log("Expected owner (deployer):", owner.address);

      // Set virtual token address
      console.log("\nSetting virtual token address...");
      await fGenesis.setVirtualTokenAddress(virtualToken.target);
      console.log("Virtual token address set to:", virtualToken.target);

      // Approve FGenesis to spend tokens
      const creationFee = ethers.parseEther("1"); // 创建费用是 1 token
      console.log("\nApproving FGenesis to spend tokens...");
      await virtualToken.approve(fGenesis.target, creationFee);
      console.log("Approved amount:", creationFee.toString());

      // Create Genesis
      const currentTime = await time.latest();
      const startTime = currentTime + 3600;
      const endTime = startTime + 86400;

      console.log("\nCreating Genesis through FGenesis...");
      const tx = await fGenesis.connect(owner).createGenesis(
        startTime,
        endTime,
        "Test Genesis",
        "TEST",
        [1], // cores
        "Test Description",
        "test.img",
        ["", "", "", ""] // urls
      );
      const receipt = await tx.wait();

      // 从 GenesisCreated 事件中获取地址
      const genesisAddress = receipt.logs.find(
        (log) => log.fragment?.name === "GenesisCreated"
      ).args[1]; // 直接获取第二个参数

      console.log("Genesis address from event:", genesisAddress);

      genesis = await ethers.getContractAt("Genesis", genesisAddress);
      console.log("Genesis created at:", genesis.target);

      // 验证创建后的状态
      console.log("\nVerifying Genesis state:");
      console.log("Start time:", await genesis.START_TIME());
      console.log("End time:", await genesis.END_TIME());
    } catch (error) {
      console.error("\n=== Error ===");
      console.error("Error message:", error.message);
      if (error.data) console.error("Error data:", error.data);
      throw error;
    }

    console.log("\n=== Test Setup Completed ===");
  });

  it("Should initialize correctly", async function () {
    expect(await genesis.START_TIME()).to.be.gt(0n);
    expect(await genesis.END_TIME()).to.be.gt(await genesis.START_TIME());
    expect(await genesis.virtualTokenAddress()).to.equal(virtualToken.target);
  });

  // Helper function to setup user participation
  async function setupUserParticipation(user, amount) {
    console.log("\n=== Setup User Participation ===");

    // Warp to after start time
    await time.increaseTo((await genesis.START_TIME()) + 1);

    // Transfer virtual tokens to user
    await virtualToken.transfer(user.address, amount);
    console.log("After transfer to user:");
    console.log(
      "- User virtual balance:",
      await virtualToken.balanceOf(user.address)
    );
    console.log(
      "- Genesis virtual balance:",
      await virtualToken.balanceOf(genesis.target)
    );

    // Approve Genesis contract
    await virtualToken.connect(user).approve(genesis.target, amount);
    console.log("After approval:");
    console.log(
      "- User allowance to Genesis:",
      await virtualToken.allowance(user.address, genesis.target)
    );

    // Participate
    await genesis.connect(user).participate(amount, user.address);
    console.log("After participate:");
    console.log(
      "- User virtual balance:",
      await virtualToken.balanceOf(user.address)
    );
    console.log(
      "- Genesis virtual balance:",
      await virtualToken.balanceOf(genesis.target)
    );
    console.log(
      "- User virtuals in Genesis:",
      await genesis.mapAddrToVirtuals(user.address)
    );
  }

  it("Should fail to create Genesis with insufficient fee", async function () {
    console.log("\n=== Testing Create Genesis With Insufficient Fee ===");

    await expect(
      genesis.participate(ethers.parseEther("1"), owner.address)
    ).to.be.revertedWith("Genesis has not started yet");
  });

  it("Should allow participation after start time", async function () {
    // 获取最大贡献限额
    const maxVirtuals = await genesis.maxContributionVirtualAmount();
    const amount = maxVirtuals / 2n; // 使用最大限额的一半
    console.log("\nMax virtuals per contribution:", maxVirtuals.toString());
    console.log("Participation amount:", amount.toString());

    // Transfer tokens to user1
    await virtualToken.transfer(user1.address, amount);
    console.log("Transferred tokens to user1");
    console.log("User1 balance:", await virtualToken.balanceOf(user1.address));

    // Approve Genesis contract
    await virtualToken.connect(user1).approve(genesis.target, amount);
    console.log("Approved Genesis contract");

    // 获取开始时间并确保时间调整正确
    const startTime = await genesis.START_TIME();
    console.log("Current time:", await time.latest());
    console.log("Start time:", startTime);

    // 调整时间到开始时间后的一段时间
    await time.increaseTo(startTime + 7200n); // 调整到开始时间后2小时
    console.log("New time:", await time.latest());

    // Participate
    await genesis.connect(user1).participate(amount, user1.address);
    console.log("Participation successful");

    // Verify participation
    const userVirtuals = await genesis.mapAddrToVirtuals(user1.address);
    console.log("User virtuals:", userVirtuals.toString());
    expect(userVirtuals).to.equal(amount);
  });

  // Add more test cases here...
});
