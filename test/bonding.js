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

    await agentFactory.setMaturityDuration(86400 * 365 * 10); // 10years
    await agentFactory.setUniswapRouter(process.env.UNISWAP_ROUTER);
    await agentFactory.setTokenAdmin(deployer.address);
    await agentFactory.setTokenSupplyParams(
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.AGENT_TOKEN_LP_SUPPLY,
      process.env.AGENT_TOKEN_VAULT_SUPPLY,
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.AGENT_TOKEN_SUPPLY,
      process.env.BOT_PROTECTION,
      deployer.address
    );

    await agentFactory.setTokenTaxParams(
      process.env.TAX,
      process.env.TAX,
      process.env.SWAP_THRESHOLD,
      treasury.address
    );

    ///////////////////////////////////////////////
    // Bonding

    const fFactory = await upgrades.deployProxy(
      await ethers.getContractFactory("FFactory"),
      [treasury.address, 1, 1]
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
        3500,
        5,
        agentFactory.target,
        parseEther("85000000"),
      ]
    );

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
      .executeApplication(applicationId, false);

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

  xit("should allow application execution by proposer", async function () {
    const { applicationId, agentFactory, virtualToken } = await loadFixture(
      deployWithApplication
    );
    const { founder } = await getAccounts();
    await expect(
      agentFactory.connect(founder).executeApplication(applicationId, false)
    ).to.emit(agentFactory, "NewPersona");
  });

  it("should be able to launch memecoin", async function () {
    const { virtualToken, bonding } = await loadFixture(deployBaseContracts);
    const { founder } = await getAccounts();

    await virtualToken.mint(founder.address, PROPOSAL_THRESHOLD);
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
        parseEther("101")
      );
  });
});
