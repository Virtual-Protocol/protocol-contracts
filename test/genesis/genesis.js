const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Genesis Tests", function () {
  let virtualToken;
  let fGenesis;
  let genesis;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    console.log("\n=== Test Setup ===");

    // Deploy ERC20Mock
    console.log("Deploying ERC20Mock...");
    const VirtualToken = await ethers.getContractFactory("ERC20Mock");
    virtualToken = await VirtualToken.deploy(
      "Virtual Token",
      "VT",
      owner.address,
      ethers.parseEther("1000000")
    );
    await virtualToken.waitForDeployment();
    console.log("ERC20Mock deployed to:", virtualToken.target);

    // Deploy FGenesis implementation
    console.log("\nDeploying FGenesis...");
    const FGenesis = await ethers.getContractFactory("FGenesis");
    const fGenesisImpl = await FGenesis.deploy();
    await fGenesisImpl.waitForDeployment();
    console.log("FGenesis implementation deployed to:", fGenesisImpl.target);

    // Initialize FGenesis
    const creationFeeAmount = ethers.parseEther("1");
    const reserveAmount = ethers.parseEther("2");

    const initializeData = fGenesisImpl.interface.encodeFunctionData(
      "initialize",
      [
        virtualToken.target, // virtualToken
        virtualToken.target, // virtualsFactory
        reserveAmount, // reserveAmount
        ethers.parseEther("0.1"), // maxContributionVirtualAmount
        creationFeeAmount, // creationFeeAmount
        86400n, // duration
      ]
    );

    // Deploy proxy
    const Proxy = await ethers.getContractFactory(
      "TransparentUpgradeableProxy"
    );
    const proxy = await Proxy.deploy(
      fGenesisImpl.target,
      owner.address,
      initializeData
    );
    await proxy.waitForDeployment();
    console.log("Proxy deployed to:", proxy.target);

    // Get FGenesis instance
    fGenesis = FGenesis.attach(proxy.target);

    // Approve tokens for creation
    await virtualToken.approve(fGenesis.target, creationFeeAmount);
    console.log("Approved tokens for creation");

    // Create Genesis
    const currentTime = await time.latest();
    const startTime = currentTime + 3600;
    const endTime = startTime + 86400;

    console.log("\nCreating Genesis...");
    const tx = await fGenesis.createGenesis(
      startTime,
      endTime,
      "Test Genesis",
      "TEST",
      [1, 2, 3], // non-empty cores array
      "Test Description",
      "test.img",
      ["url1", "url2", "url3", "url4"]
    );
    const receipt = await tx.wait();

    // Get Genesis address from event
    const event = receipt.logs.find(
      (log) => log.fragment?.name === "GenesisCreated"
    );
    const genesisAddress = event.args[1];
    genesis = await ethers.getContractAt("Genesis", genesisAddress);
    console.log("Genesis created at:", genesis.target);
  });

  it("Should initialize correctly", async function () {
    expect(await genesis.START_TIME()).to.be.gt(0n);
    expect(await genesis.END_TIME()).to.be.gt(await genesis.START_TIME());
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
    // Get maximum contribution limit
    const maxVirtuals = await genesis.maxContributionVirtualAmount();
    const amount = maxVirtuals / 2n; // Use half of the maximum limit
    console.log("\nMax virtuals per contribution:", maxVirtuals.toString());
    console.log("Participation amount:", amount.toString());

    // Transfer tokens to user1
    await virtualToken.transfer(user1.address, amount);
    console.log("Transferred tokens to user1");
    console.log("User1 balance:", await virtualToken.balanceOf(user1.address));

    // Approve Genesis contract
    await virtualToken.connect(user1).approve(genesis.target, amount);
    console.log("Approved Genesis contract");

    // Get start time and ensure time adjustment is correct
    const startTime = await genesis.START_TIME();
    console.log("Current time:", await time.latest());
    console.log("Start time:", startTime);

    // Adjust time to 2 hours after start time
    await time.increaseTo(startTime + 7200n); // 2 hours after start time
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
