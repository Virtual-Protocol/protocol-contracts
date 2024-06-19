const { expect } = require("chai");
const { toBeHex } = require("ethers/utils");
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { parseEther } = require("ethers");

const getMintServiceCalldata = async (serviceNft, virtualId, hash) => {
  return serviceNft.interface.encodeFunctionData("mint", [virtualId, hash]);
};

function getDescHash(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

describe("AgentDAO", function () {
  const PROPOSAL_THRESHOLD = parseEther("100000"); //100k

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
    const [
      deployer,
      ipVault,
      founder,
      contributor1,
      contributor2,
      validator1,
      validator2,
      treasury,
      trader,
    ] = await ethers.getSigners();
    return {
      deployer,
      ipVault,
      founder,
      contributor1,
      contributor2,
      validator1,
      validator2,
      treasury,
      trader,
    };
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
      await ethers.getContractFactory("AgentFactoryV2"),
      [
        agentToken.target,
        agentVeToken.target,
        agentDAO.target,
        process.env.TBA_REGISTRY,
        virtualToken.target,
        agentNft.target,
        PROPOSAL_THRESHOLD,
        deployer.address,
      ]
    );
    await agentFactory.waitForDeployment();
    await agentNft.grantRole(await agentNft.MINTER_ROLE(), agentFactory.target);
    const minter = await upgrades.deployProxy(
      await ethers.getContractFactory("Minter"),
      [
        service.target,
        contribution.target,
        agentNft.target,
        process.env.IP_SHARES,
        process.env.IMPACT_MULTIPLIER,
        ipVault.address,
        agentFactory.target,
        deployer.address,
        process.env.MAX_IMPACT,
      ]
    );
    await minter.waitForDeployment();
    await agentFactory.setMaturityDuration(86400 * 365 * 10); // 10years
    await agentFactory.setUniswapRouter(process.env.UNISWAP_ROUTER);
    await agentFactory.setTokenAdmin(deployer.address);
    await agentFactory.setTokenSupplyParams(
      process.env.AGENT_TOKEN_LIMIT,
      process.env.AGENT_TOKEN_LP_SUPPLY,
      process.env.AGENT_TOKEN_VAULT_SUPPLY,
      process.env.AGENT_TOKEN_LIMIT,
      process.env.AGENT_TOKEN_LIMIT,
      process.env.BOT_PROTECTION,
      minter.target
    );
    await agentFactory.setTokenTaxParams(
      process.env.TAX,
      process.env.TAX,
      process.env.SWAP_THRESHOLD,
      treasury.address
    );
    return {
      virtualToken,
      agentFactory,
      agentNft,
      serviceNft: service,
      contributionNft: contribution,
      minter,
    };
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

  it("should auto early execution when forVotes == totalSupply", async function () {
    const base = await loadFixture(deployWithAgent);
    const { founder } = await getAccounts();
    const { agent, serviceNft } = base;
    const agentDAO = await ethers.getContractAt("AgentDAO", agent.dao);
    const desc = "test";
    const descHash = getDescHash(desc);

    const mintCalldata = await getMintServiceCalldata(
      serviceNft,
      agent.virtualId,
      descHash
    );

    await agentDAO.propose([serviceNft.target], [0], [mintCalldata], desc);
    const filter = agentDAO.filters.ProposalCreated;
    const events = await agentDAO.queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];

    // Proposal not executed yet
    await expect(serviceNft.ownerOf(proposalId)).to.be.reverted;
    await mine(10);
    await agentDAO
      .connect(founder)
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", "0x");

    // Proposal should be auto executed
    expect(await serviceNft.ownerOf(proposalId)).to.equal(agent.tba);
    const state = await agentDAO.state(proposalId);
    expect(state).to.equal(7n);
    await expect(agentDAO.execute(proposalId)).to.be.reverted;
  });

  it("should not allow early execution when forVotes < totalSupply although met quorum", async function () {
    const base = await loadFixture(deployWithAgent);
    const { founder, deployer, trader, treasury, contributor1 } =
      await getAccounts();
    const {
      agent,
      serviceNft,
      contributionNft,
      minter,
      virtualToken,
      agentFactory,
    } = base;
    const agentDAO = await ethers.getContractAt("AgentDAO", agent.dao);
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);
    const lpToken = await ethers.getContractAt("IUniswapV2Pair", agent.lp);
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    const desc = "test";
    const descHash = getDescHash(desc);

    const mintCalldata = await getMintServiceCalldata(
      serviceNft,
      agent.virtualId,
      descHash
    );

    ///////////////////////////
    // Buy from LP
    ///////////////////////////
    await virtualToken.mint(trader.address, parseEther("10000"));
    const router = await ethers.getContractAt(
      "IUniswapV2Router02",
      process.env.UNISWAP_ROUTER
    );
    await virtualToken
      .connect(trader)
      .approve(router.target, parseEther("20000"));
    await agentToken
      .connect(trader)
      .approve(router.target, parseEther("20000"));
    const amountToBuy = parseEther("1000");
    const capital = parseEther("10000");
    await router
      .connect(trader)
      .swapTokensForExactTokens(
        amountToBuy,
        capital,
        [virtualToken.target, agent.token],
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 6000)
      );

    // Provide liquidity
    await router
      .connect(trader)
      .addLiquidity(
        agentToken.target,
        virtualToken.target,
        parseEther("97"),
        parseEther("100"),
        0,
        0,
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 6000)
      );
    const lpBalance = await lpToken.balanceOf(trader.address);
    await lpToken.connect(trader).approve(veToken.target, parseEther("100"));
    await veToken.connect(founder).setCanStake(true);
    await veToken
      .connect(trader)
      .stake(lpBalance, trader.address, trader.address);

    ///////////////////////////
    await agentDAO.propose([serviceNft.target], [0], [mintCalldata], desc);
    const filter = agentDAO.filters.ProposalCreated;
    const events = await agentDAO.queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];

    await mine(10);
    await agentDAO.castVoteWithReasonAndParams(proposalId, 1, "lfg", "0x");
    const state = await agentDAO.state(proposalId);
    expect(state).to.equal(1n);
    await expect(agentDAO.execute(proposalId)).to.be.rejected;
  });
});
