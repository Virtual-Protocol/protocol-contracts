/*
We will test the end-to-end implementation of a Virtual genesis initiation

1. Founder sends 100k $VIRTUAL tokens to factory propose an Agent
2. Founder executes the proposal
3. Factory generates following items:
    a. Token (For contribution)
    b. DAO
    c. Liquidity Pool
    d. Agent NFT
    e. Staking Token
4. Factory then mint 100k $Agent tokens
5. Factory adds 100k $VIRTUAL and $Agent tokens to the LP in exchange for $ALP
6. Factory stakes the $ALP and set recipient of stake tokens $sALP to founder
*/
const { parseEther, toBeHex, formatEther } = require("ethers/utils");
const { expect } = require("chai");
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Bonding", function () {
  const PROPOSAL_THRESHOLD = parseEther("50000"); // 50k
  const MATURITY_SCORE = toBeHex(2000, 32); // 20%

  const genesisInput = {
    name: "Jessica",
    symbol: "JSC",
    tokenURI: "http://jessica",
    daoName: "Jessica DAO",
    cores: [0, 1, 2],
    tbaSalt:
      "0xa7647ac9429fdce477ebd9a95510385b756c757c26149e740abbab0ad1be2f16",
    tbaImplementation: process.env.TBA_IMPLEMENTATION,
    daoVotingPeriod: 600,
    daoThreshold: 1000000000000000000000n,
  };

  const getAccounts = async () => {
    const [deployer, ipVault, founder, poorMan, trader, treasury] =
      await ethers.getSigners();
    return { deployer, ipVault, founder, poorMan, trader, treasury };
  };

  async function deployBaseContracts() {
    const { deployer, ipVault, treasury } = await getAccounts();

    const virtualToken = await ethers.deployContract(
      "VirtualToken",
      [PROPOSAL_THRESHOLD, deployer.address],
      {}
    );
    await virtualToken.waitForDeployment();

    const AgentNft = await ethers.getContractFactory("AgentNftV2");
    const agentNft = await upgrades.deployProxy(AgentNft, [deployer.address]);

    const contribution = await upgrades.deployProxy(
      await ethers.getContractFactory("ContributionNft"),
      [agentNft.target],
      {}
    );

    const service = await upgrades.deployProxy(
      await ethers.getContractFactory("ServiceNft"),
      [agentNft.target, contribution.target, process.env.DATASET_SHARES],
      {}
    );

    await agentNft.setContributionService(contribution.target, service.target);

    // Implementation contracts
    const agentToken = await ethers.deployContract("AgentToken");
    await agentToken.waitForDeployment();
    const agentDAO = await ethers.deployContract("AgentDAO");
    await agentDAO.waitForDeployment();
    const agentVeToken = await ethers.deployContract("AgentVeToken");
    await agentVeToken.waitForDeployment();

    const agentFactory = await upgrades.deployProxy(
      await ethers.getContractFactory("AgentFactoryV3"),
      [
        agentToken.target,
        agentVeToken.target,
        agentDAO.target,
        process.env.TBA_REGISTRY,
        virtualToken.target,
        agentNft.target,
        PROPOSAL_THRESHOLD,
        deployer.address,
        1001,
      ]
    );
    await agentFactory.waitForDeployment();
    await agentNft.grantRole(await agentNft.MINTER_ROLE(), agentFactory.target);

    await agentFactory.setParams(
      86400 * 365 * 10,
      process.env.UNISWAP_ROUTER,
      deployer.address,
      deployer.address
    );

    await agentFactory.setTokenParams(
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.AGENT_TOKEN_LP_SUPPLY,
      process.env.AGENT_TOKEN_VAULT_SUPPLY,
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.BOT_PROTECTION,
      deployer.address,
      process.env.TAX,
      process.env.TAX,
      process.env.SWAP_THRESHOLD,
      treasury.address
    );

    ///////////////////////////////////////////////
    // Bonding

    const fFactory = await upgrades.deployProxy(
      await ethers.getContractFactory("FFactory"),
      [treasury.address, 0, 0]
    );
    await fFactory.waitForDeployment();
    await fFactory.grantRole(await fFactory.ADMIN_ROLE(), deployer);

    const fRouter = await upgrades.deployProxy(
      await ethers.getContractFactory("FRouter"),
      [fFactory.target, virtualToken.target]
    );
    await fRouter.waitForDeployment();
    await fFactory.setRouter(fRouter.target);

    const bonding = await upgrades.deployProxy(
      await ethers.getContractFactory("Bonding"),
      [
        fFactory.target,
        fRouter.target,
        treasury.address,
        100000, //100
        "1000000000",
        10000,
        100,
        agentFactory.target,
        parseEther("85000000"),
      ]
    );

    await bonding.setDeployParams([
      genesisInput.tbaSalt,
      genesisInput.tbaImplementation,
      genesisInput.daoVotingPeriod,
      genesisInput.daoThreshold,
    ]);
    await fFactory.grantRole(await fFactory.CREATOR_ROLE(), bonding.target);
    await fRouter.grantRole(await fRouter.EXECUTOR_ROLE(), bonding.target);
    await agentFactory.grantRole(
      await agentFactory.BONDING_ROLE(),
      bonding.target
    );

    return { virtualToken, agentFactory, agentNft, bonding, fRouter, fFactory };
  }

  async function deployWithApplication() {
    const base = await deployBaseContracts();
    const { agentFactory, virtualToken } = base;
    const { founder } = await getAccounts();

    // Prepare tokens for proposal
    await virtualToken.mint(founder.address, PROPOSAL_THRESHOLD);
    await virtualToken
      .connect(founder)
      .approve(agentFactory.target, PROPOSAL_THRESHOLD);

    const tx = await agentFactory
      .connect(founder)
      .proposeAgent(
        genesisInput.name,
        genesisInput.symbol,
        genesisInput.tokenURI,
        genesisInput.cores,
        genesisInput.tbaSalt,
        genesisInput.tbaImplementation,
        genesisInput.daoVotingPeriod,
        genesisInput.daoThreshold
      );

    const filter = agentFactory.filters.NewApplication;
    const events = await agentFactory.queryFilter(filter, -1);
    const event = events[0];
    const { id } = event.args;
    return { applicationId: id, ...base };
  }

  async function deployWithAgent() {
    const base = await deployWithApplication();
    const { agentFactory, applicationId } = base;

    const { founder } = await getAccounts();
    await agentFactory
      .connect(founder)
      .executeApplication(
        applicationId,
        false,
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );

    const factoryFilter = agentFactory.filters.NewPersona;
    const factoryEvents = await agentFactory.queryFilter(factoryFilter, -1);
    const factoryEvent = factoryEvents[0];

    const { virtualId, token, veToken, dao, tba, lp } = await factoryEvent.args;
    
    return {
      ...base,
      agent: {
        virtualId,
        token,
        veToken,
        dao,
        tba,
        lp,
      },
    };
  }

  before(async function () {});

  it("should allow application execution by proposer", async function () {
    const { applicationId, agentFactory, virtualToken, bonding } = await loadFixture(
      deployWithApplication
    );
    
    const { founder } = await getAccounts();
    const tx = await agentFactory
      .connect(founder)
      .executeApplication(
        applicationId,
        false,
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );

    // Get the event arguments
    const filter = agentFactory.filters.NewPersona;
    const events = await agentFactory.queryFilter(filter, -1);
    const event = events[0];
    const { virtualId, token, veToken, dao, tba, lp } = await event.args;
    expect(token).to.not.equal("0x0000000000000000000000000000000000000000");
    console.log("Token deployed at", token);
  });

  it("should be able to launch memecoin", async function () {
    const { virtualToken, bonding, router } = await loadFixture(
      deployBaseContracts
    );
    const { founder, treasury } = await getAccounts();

    await virtualToken.mint(founder.address, parseEther("200"));
    await virtualToken
      .connect(founder)
      .approve(bonding.target, parseEther("1000"));

    await bonding
      .connect(founder)
      .launch(
        "Cat",
        "$CAT",
        [0, 1, 2],
        "it is a cat",
        "",
        ["", "", "", ""],
        parseEther("200")
      );
    // Treasury should have 100 $V
    // We bought $CAT with 1$V

    const tokenInfo = await bonding.tokenInfo(bonding.tokenInfos(0));
    const token = await ethers.getContractAt("ERC20", tokenInfo.token);
    console.log("Token deployed at", tokenInfo.token);

    const pair = await ethers.getContractAt("FPair", tokenInfo.pair);
    const [r1, r2] = await pair.getReserves();

    console.log("Reserves", formatEther(r1), formatEther(r2));

    expect(
      formatEther(await virtualToken.balanceOf(treasury.address))
    ).to.be.equal("100.0");
    expect(
      formatEther(await virtualToken.balanceOf(tokenInfo.pair))
    ).to.be.equal("100.0");
    expect(
      formatEther(await virtualToken.balanceOf(founder.address))
    ).to.be.equal("0.0");

    expect(formatEther(await token.balanceOf(founder.address))).to.be.equal(
      "32258064.516129032258064517"
    );
  });

  it("should be able to graduate", async function () {
    const { virtualToken, bonding, fRouter } = await loadFixture(
      deployBaseContracts
    );
    const { founder, trader, treasury } = await getAccounts();

    await virtualToken.mint(founder.address, parseEther("200"));
    await virtualToken
      .connect(founder)
      .approve(bonding.target, parseEther("1000"));
    await virtualToken.mint(trader.address, parseEther("120000"));
    await virtualToken
      .connect(trader)
      .approve(fRouter.target, parseEther("120000"));

    await bonding
      .connect(founder)
      .launch(
        "Cat",
        "$CAT",
        [0, 1, 2],
        "it is a cat",
        "",
        ["", "", "", ""],
        parseEther("200")
      );

    const tokenInfo = await bonding.tokenInfo(await bonding.tokenInfos(0));
    expect(tokenInfo.agentToken).to.equal(
      "0x0000000000000000000000000000000000000000"
    );

    const now = Math.floor(Date.now() / 1000);
    await expect(
      bonding
        .connect(trader)
        .buy(parseEther("35000"), tokenInfo.token, "0", now + 300)
    ).to.emit(bonding, "Graduated");
    const tokenInfo2 = await bonding.tokenInfo(bonding.tokenInfos(0));

    const pair = await ethers.getContractAt("FPair", tokenInfo.pair);
    const [r1, r2] = await pair.getReserves();

    console.log("Reserves", formatEther(r1), formatEther(r2));
    console.log("Agent token", tokenInfo2.agentToken);
    expect(tokenInfo2.agentToken).to.not.equal(
      "0x0000000000000000000000000000000000000000"
    );
    expect(tokenInfo2.trading).to.equal(false);
    expect(tokenInfo2.tradingOnUniswap).to.equal(true);
  });
});
