const { parseEther, formatEther, toBeHex } = require("ethers/utils");
const { ethers } = require("hardhat");
const abi = ethers.AbiCoder.defaultAbiCoder();
const { expect } = require("chai");
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const getSetImpactMulCalldata = async (minter, virtualId, multiplier) => {
  return minter.interface.encodeFunctionData("setImpactMulOverride", [
    virtualId,
    multiplier,
  ]);
};

const getSetIPShareCalldata = async (minter, virtualId, share) => {
  return minter.interface.encodeFunctionData("setIPShareOverride", [
    virtualId,
    share,
  ]);
};

const getMintServiceCalldata = async (serviceNft, virtualId, hash) => {
  return serviceNft.interface.encodeFunctionData("mint", [virtualId, hash]);
};

describe("Contribution", function () {
  const PROPOSAL_THRESHOLD = parseEther("100000"); //100k
  const TREASURY_AMOUNT = parseEther("1000000"); //1M
  const TOKEN_URI = "http://jessica";

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
      virtualTreasury,
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
      virtualTreasury,
      trader,
    };
  };

  async function deployBaseContracts() {
    const { deployer, ipVault, treasury, virtualTreasury } =
      await getAccounts();

    const virtualToken = await ethers.deployContract(
      "VirtualToken",
      [TREASURY_AMOUNT, deployer.address],
      {}
    );
    await virtualToken.waitForDeployment();

    const EloCalculator = await ethers.getContractFactory("EloCalculator");
    const eloCalculator = await upgrades.deployProxy(EloCalculator, [
      deployer.address,
    ]);

    const AgentNft = await ethers.getContractFactory("AgentNftV2");
    const agentNft = await upgrades.deployProxy(AgentNft, [deployer.address]);
    await agentNft.connect(deployer).setEloCalculator(eloCalculator.target);

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
    await agentFactory.grantRole(
      await agentFactory.WITHDRAW_ROLE(),
      deployer.address
    );

    const rewards = await upgrades.deployProxy(
      await ethers.getContractFactory("AgentRewardV2"),
      [
        virtualToken.target,
        agentNft.target,
        {
          protocolShares: process.env.PROTOCOL_SHARES,
          stakerShares: process.env.STAKER_SHARES,
        },
      ],
      {}
    );
    await rewards.waitForDeployment();
    await rewards.grantRole(await rewards.GOV_ROLE(), deployer.address);

    return {
      virtualToken,
      agentFactory,
      agentNft,
      serviceNft: service,
      contributionNft: contribution,
      minter,
      rewards,
    };
  }

  async function createApplication(base, founder, idx) {
    const { agentFactory, virtualToken } = base;

    // Prepare tokens for proposal
    await virtualToken.mint(founder.address, PROPOSAL_THRESHOLD);
    await virtualToken
      .connect(founder)
      .approve(agentFactory.target, PROPOSAL_THRESHOLD);
    const tx = await agentFactory
      .connect(founder)
      .proposeAgent(
        genesisInput.name + "-" + idx,
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
    return id;
  }

  async function deployWithApplication() {
    const base = await deployBaseContracts();

    const { founder } = await getAccounts();
    const id = await createApplication(base, founder, 0);
    return { applicationId: id, ...base };
  }

  async function createAgent(base, applicationId) {
    const { agentFactory } = base;
    await agentFactory.executeApplication(applicationId, true);

    const factoryFilter = agentFactory.filters.NewPersona;
    const factoryEvents = await agentFactory.queryFilter(factoryFilter, -1);
    const factoryEvent = factoryEvents[0];
    return factoryEvent.args;
  }

  async function deployWithAgent() {
    const base = await deployWithApplication();
    const { applicationId } = base;

    const { founder } = await getAccounts();

    const { virtualId, token, veToken, dao, tba, lp } = await createAgent(
      base,
      applicationId
    );

    const veTokenContract = await ethers.getContractAt("AgentVeToken", veToken);
    await veTokenContract.connect(founder).delegate(founder.address); // We want to vote instead of letting default delegatee to vote

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

  async function createContribution(
    virtualId,
    coreId,
    parentId,
    isModel,
    datasetId,
    desc,
    base,
    account,
    voters,
    votes
  ) {
    const { serviceNft, contributionNft, minter, agentNft } = base;
    const daoAddr = (await agentNft.virtualInfo(virtualId)).dao;
    const veAddr = (await agentNft.virtualLP(virtualId)).veToken;
    const agentDAO = await ethers.getContractAt("AgentDAO", daoAddr);

    const descHash = getDescHash(desc);

    const mintCalldata = await getMintServiceCalldata(
      serviceNft,
      virtualId,
      descHash
    );

    await agentDAO.propose([serviceNft.target], [0], [mintCalldata], desc);
    const filter = agentDAO.filters.ProposalCreated;
    const events = await agentDAO.queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];

    await contributionNft.mint(
      account,
      virtualId,
      coreId,
      TOKEN_URI,
      proposalId,
      parentId,
      isModel,
      datasetId
    );
    const voteParams = isModel ? abi.encode(["uint8[] memory"], [votes]) : "0x";

    for (const voter of voters) {
      await agentDAO
        .connect(voter)
        .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams);
    }

    await mine(600);

    if (isModel) {
      await minter.mint(proposalId);
    }

    return proposalId;
  }

  function getDescHash(str) {
    return ethers.keccak256(ethers.toUtf8Bytes(str));
  }

  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("should be able to mint a new contribution NFT", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, founder } = await getAccounts();
    const { contributionNft, agent } = base;
    const veAddr = agent.veToken;
    const veToken = await ethers.getContractAt("AgentVeToken", veAddr);
    await veToken.connect(founder).delegate(founder.address);
    const balance1 = await contributionNft.balanceOf(contributor1.address);
    expect(balance1).to.equal(0n);

    const contributionId = await createContribution(
      1,
      0,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    const balance2 = await contributionNft.balanceOf(contributor1.address);
    expect(balance2).to.equal(1n);
    expect(await contributionNft.ownerOf(contributionId)).to.be.equal(
      contributor1.address
    );
  });

  it("should mint agent token for successful model contribution", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, founder } = await getAccounts();
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );
    const balance1 = await agentToken.balanceOf(contributor1.address);
    expect(balance1).to.equal(0n);
    await createContribution(
      1,
      0,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );
    const balance2 = await agentToken.balanceOf(contributor1.address);
    expect(balance2).to.equal(parseEther("100000"));
  });

  it("should mint agent token for IP owner on successful contribution", async function () {
    const base = await loadFixture(deployWithAgent);
    const { ipVault, contributor1, founder } = await getAccounts();
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );
    const balance1 = await agentToken.balanceOf(ipVault.address);
    expect(balance1).to.equal(0n);
    await createContribution(
      1,
      0,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    const balance2 = await agentToken.balanceOf(ipVault.address);
    expect(balance2).to.equal(parseEther("10000"));
  });

  it("should mint agent token for model & dataset contribution", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, contributor2, founder } = await getAccounts();
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );

    // No agent token minted for dataset contribution
    const c1 = await createContribution(
      1,
      0,
      0,
      false,
      0,
      "Dataset",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );
    const balance1 = await agentToken.balanceOf(contributor1.address);
    expect(balance1).to.equal(0n);

    await createContribution(
      1,
      0,
      0,
      true,
      c1,
      "Test model",
      base,
      contributor2.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    const balance2 = await agentToken.balanceOf(contributor2.address);
    expect(balance2).to.equal(parseEther("30000"));

    const balance12 = await agentToken.balanceOf(contributor1.address);
    expect(balance12).to.equal(parseEther("70000"));
  });

  it("should allow adjusting global agent token multiplier", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, contributor2, founder } = await getAccounts();
    const { minter } = base;
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );
    await minter.setImpactMultiplier(20000000); //2x

    // No agent token minted for dataset contribution
    const c1 = await createContribution(
      1,
      0,
      0,
      false,
      0,
      "Dataset",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );
    const balance1 = await agentToken.balanceOf(contributor1.address);
    expect(balance1).to.equal(0n);

    await createContribution(
      1,
      0,
      0,
      true,
      c1,
      "Test model",
      base,
      contributor2.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    const balance2 = await agentToken.balanceOf(contributor2.address);
    expect(balance2).to.equal(parseEther("60000"));

    const balance12 = await agentToken.balanceOf(contributor1.address);
    expect(balance12).to.equal(parseEther("140000"));
  });

  it("should allow adjusting agent token multiplier", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, contributor2, founder } = await getAccounts();
    const { minter, agent } = base;
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);
    await minter.setImpactMulOverride(agent.virtualId, 20000000); //2x
    // No agent token minted for dataset contribution
    const c1 = await createContribution(
      1,
      0,
      0,
      false,
      0,
      "Dataset",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );
    const balance1 = await agentToken.balanceOf(contributor1.address);
    expect(balance1).to.equal(0n);

    await createContribution(
      1,
      0,
      0,
      true,
      c1,
      "Test model",
      base,
      contributor2.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    const balance2 = await agentToken.balanceOf(contributor2.address);
    expect(balance2).to.equal(parseEther("60000"));

    const balance12 = await agentToken.balanceOf(contributor1.address);
    expect(balance12).to.equal(parseEther("140000"));
  });

  it("should not allow adjusting agent token multiplier by public", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, contributor2, founder } = await getAccounts();
    const { minter, agent } = base;
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);

    await expect(
      minter.connect(founder).setImpactMulOverride(agent.virtualId, 20000)
    ).to.be.reverted;

    // No agent token minted for dataset contribution
    const c1 = await createContribution(
      1,
      0,
      0,
      false,
      0,
      "Dataset",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );
    const balance1 = await agentToken.balanceOf(contributor1.address);
    expect(balance1).to.equal(0n);

    await createContribution(
      1,
      0,
      0,
      true,
      c1,
      "Test model",
      base,
      contributor2.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    const balance2 = await agentToken.balanceOf(contributor2.address);
    expect(balance2).to.equal(parseEther("30000"));

    const balance12 = await agentToken.balanceOf(contributor1.address);
    expect(balance12).to.equal(parseEther("70000"));
  });

  it("should be able to adjust the global IP share", async function () {
    const base = await loadFixture(deployWithAgent);
    const { deployer, contributor1, ipVault, founder } = await getAccounts();
    const { minter, agent } = base;
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);

    await minter.connect(deployer).setIPShare(5000);

    await createContribution(
      1,
      0,
      0,
      true,
      0,
      "Test model",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    const balance = await agentToken.balanceOf(ipVault.address);
    expect(balance).to.equal(parseEther("50000"));
  });

  it("should be able to adjust the IP share per agent", async function () {
    const base = await loadFixture(deployWithAgent);
    const { ipVault, contributor1, contributor2, founder } =
      await getAccounts();
    const { minter, agent } = base;
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);

    await veToken.connect(founder).delegate(founder.address);

    const agentDAO = await ethers.getContractAt("AgentDAO", agent.dao);

    const calldata = await getSetIPShareCalldata(
      minter,
      agent.virtualId,
      1000n
    );

    await agentDAO.propose(
      [minter.target],
      [0],
      [calldata],
      "Set agent token multiplier"
    );
    const filter = agentDAO.filters.ProposalCreated;
    const events = await agentDAO.queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];

    await mine(1);
    await agentDAO.connect(founder).castVote(proposalId, 1);

    // No agent token minted for dataset contribution
    const c1 = await createContribution(
      1,
      0,
      0,
      false,
      0,
      "Dataset",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    await createContribution(
      1,
      0,
      0,
      true,
      c1,
      "Test model",
      base,
      contributor2.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    const balance = await agentToken.balanceOf(ipVault.address);
    expect(balance).to.equal(parseEther("10000"));
  });

  it("should get max 215 elo rating for one sided votes", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, contributor2, founder } = await getAccounts();
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );

    // First contribution always gets 100 impact
    await createContribution(
      1,
      0,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    expect(await agentToken.balanceOf(contributor2.address)).to.equal(0);
    // Second contribution gets 215 impact
    const nftId = await createContribution(
      1,
      0,
      0,
      true,
      0,
      "Test 2",
      base,
      contributor2.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );
    expect(await base.serviceNft.getImpact(nftId)).to.be.equal(215n);
    expect(await base.serviceNft.getMaturity(nftId)).to.be.equal(315n);
    const balance2 = await agentToken.balanceOf(contributor2.address);
    expect(balance2).to.equal(parseEther("215000"));
  });

  it("should calculate correct elo rating", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, contributor2, founder } = await getAccounts();
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );

    // First contribution always gets 100 impact
    await createContribution(
      1,
      0,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [founder],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    );

    expect(await agentToken.balanceOf(contributor2.address)).to.equal(0);
    // Second contribution gets 215 impact
    const nftId = await createContribution(
      1,
      0,
      0,
      true,
      0,
      "Test 2",
      base,
      contributor2.address,
      [founder],
      [1, 1, 1, 1, 1, 2, 0, 3, 1, 1]
    );

    expect(await base.serviceNft.getImpact(nftId)).to.be.equal(142n);
    expect(await base.serviceNft.getMaturity(nftId)).to.be.equal(242n);
    const balance2 = await agentToken.balanceOf(contributor2.address);
    expect(balance2).to.equal(parseEther("142000"));
  });
});
