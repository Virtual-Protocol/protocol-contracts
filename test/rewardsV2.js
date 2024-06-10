/*
Test scenario:
1. Accounts: [validator1, staker1, validator2, staker2]
2. Stakes: [100000, 2000, 5000, 20000]
3. Uptime: [3,1]
4. All contribution NFTs are owned by account #10
*/
const { expect } = require("chai");
const { toBeHex } = require("ethers/utils");
const abi = ethers.AbiCoder.defaultAbiCoder();
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { parseEther, formatEther } = require("ethers");

const getExecuteCallData = (factory, proposalId) => {
  return factory.interface.encodeFunctionData("executeApplication", [
    proposalId,
    false
  ]);
};

const getMintServiceCalldata = async (serviceNft, virtualId, hash) => {
  return serviceNft.interface.encodeFunctionData("mint", [virtualId, hash]);
};

function getDescHash(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

describe("RewardsV2", function () {
  const PROPOSAL_THRESHOLD = parseEther("100000"); //100k
  const MATURITY_SCORE = toBeHex(2000, 32); // 20%
  const IP_SHARE = 1000; // 10%

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

    const AgentNft = await ethers.getContractFactory("AgentNft");
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
    const minter = await ethers.deployContract("Minter", [
      service.target,
      contribution.target,
      agentNft.target,
      IP_SHARE,
      ipVault.address,
      agentFactory.target,
      deployer.address,
    ]);
    await minter.waitForDeployment();
    await agentFactory.setMinter(minter.target);
    await agentFactory.setMaturityDuration(86400 * 365 * 10); // 10years
    await agentFactory.setUniswapRouter(process.env.UNISWAP_ROUTER);
    await agentFactory.setTokenAdmin(deployer.address);
    await agentFactory.setTokenSupplyParams(
      process.env.AGENT_TOKEN_LIMIT,
      process.env.AGENT_TOKEN_LIMIT,
      process.env.BOT_PROTECTION
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
    await agentFactory.connect(founder).executeApplication(applicationId, false);

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

  async function stakeAndVote() {
    const signers = await ethers.getSigners();
    const [validator1, staker1, validator2, staker2] = signers;
    const base = await deployGenesisVirtual();
    const Token = await ethers.getContractFactory("AgentToken");
    const token = Token.attach(base.persona.token);
    const { persona, demoToken, personaNft, reward } = base;
    // Staking
    await personaNft.addValidator(1, validator2.address);
    await demoToken.mint(staker1.address, STAKE_AMOUNTS[1]);
    await demoToken.connect(staker1).approve(persona.token, STAKE_AMOUNTS[1]);
    await token
      .connect(staker1)
      .stake(STAKE_AMOUNTS[1], staker1.address, validator1.address);
    await demoToken.mint(validator2.address, STAKE_AMOUNTS[2]);
    await demoToken
      .connect(validator2)
      .approve(persona.token, STAKE_AMOUNTS[2]);
    await token
      .connect(validator2)
      .stake(STAKE_AMOUNTS[2], validator2.address, validator2.address);
    await demoToken.mint(staker2.address, STAKE_AMOUNTS[3]);
    await demoToken.connect(staker2).approve(persona.token, STAKE_AMOUNTS[3]);
    await token
      .connect(staker2)
      .stake(STAKE_AMOUNTS[3], staker2.address, validator2.address);

    // Propose & validate
    const Dao = await ethers.getContractFactory("AgentDAO");
    const dao = Dao.attach(persona.dao);

    const proposals = await Promise.all([
      dao
        .propose([persona.token], [0], ["0x"], "Proposal 1")
        .then((tx) => tx.wait())
        .then((receipt) => receipt.logs[0].args[0]),
      dao
        .propose([persona.token], [0], ["0x"], "Proposal 2")
        .then((tx) => tx.wait())
        .then((receipt) => receipt.logs[0].args[0]),
    ]);
    await dao.castVote(proposals[0], 1);
    await dao.connect(validator2).castVote(proposals[0], 1);
    await dao.connect(validator2).castVote(proposals[1], 1);

    // Distribute rewards
    await demoToken.mint(validator1, REWARD_AMOUNT);
    await demoToken.approve(reward.target, REWARD_AMOUNT);
    await reward.distributeRewards(REWARD_AMOUNT);
    await reward.distributeRewardsForAgents(0, [1]);

    return { ...base };
  }

  async function createContribution(
    coreId,
    maturity,
    parentId,
    isModel,
    datasetId,
    desc,
    base,
    account
  ) {
    const { founder } = await getAccounts();
    const { agent, serviceNft, contributionNft, minter } = base;
    const agentDAO = await ethers.getContractAt("AgentDAO", agent.dao);

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

    await contributionNft.mint(
      account,
      agent.virtualId,
      coreId,
      TOKEN_URI,
      proposalId,
      parentId,
      isModel,
      datasetId
    );

    const voteParams = isModel
      ? abi.encode(["uint256", "uint8[] memory"], [maturity, [0, 1, 1, 0, 2]])
      : "0x";
    await agentDAO
      .connect(founder)
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams);
    await mine(600);

    await agentDAO.execute(proposalId);
    await minter.mint(proposalId);

    return proposalId;
  }

  async function prepareContributions() {
    /*
    NFT 1 (LLM DS)	
    NFT 2 (LLM Model)	
    NFT 3 (Voice DS)	
    NFT 4 (Voice Model *current)
    NFT 5 (Visual model, no DS)
    */
    const base = await stakeAndVote();
    const signers = await ethers.getSigners();
    const [validator1, staker1, validator2, staker2] = signers;
    const contributionList = [];
    const account = signers[10].address;

    // NFT 1 (LLM DS)
    let nft = await createContribution(
      0,
      0,
      0,
      false,
      0,
      "LLM DS",
      base,
      account
    );
    contributionList.push(nft);

    // NFT 2 (LLM Model)
    nft = await createContribution(
      0,
      200,
      0,
      true,
      nft,
      "LLM Model",
      base,
      account
    );
    contributionList.push(nft);

    // NFT 3 (Voice DS)
    nft = await createContribution(
      1,
      0,
      0,
      false,
      0,
      "Voice DS",
      base,
      account
    );
    contributionList.push(nft);

    // NFT 4 (Voice Model *current)
    nft = await createContribution(
      1,
      100,
      0,
      true,
      nft,
      "Voice Model",
      base,
      account
    );
    contributionList.push(nft);

    nft = await createContribution(
      2,
      100,
      0,
      true,
      0,
      "Visual Model",
      base,
      account
    );
    contributionList.push(nft);

    await base.demoToken.mint(validator1, REWARD_AMOUNT);
    await base.demoToken.approve(base.reward.target, REWARD_AMOUNT);
    await base.reward.distributeRewards(REWARD_AMOUNT);
    await base.reward.distributeRewardsForAgents(1, [1]);

    return { contributionList, ...base };
  }

  before(async function () {});

  it("should mint agent token for successful contribution", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1 } = await getAccounts();
    const maturity = 55;
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );
    const balance1 = await agentToken.balanceOf(contributor1.address);
    expect(balance1).to.equal(0n);
    await createContribution(
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address
    );
    const balance2 = await agentToken.balanceOf(contributor1.address);
    expect(balance2).to.equal(parseEther(maturity.toString()));
  });

  it("should mint agent token for IP owner on successful contribution", async function () {
    const base = await loadFixture(deployWithAgent);
    const { ipVault, contributor1 } = await getAccounts();
    const maturity = 55;
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );
    const balance1 = await agentToken.balanceOf(ipVault.address);
    expect(balance1).to.equal(0n);
    await createContribution(
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address
    );

    const balance2 = await agentToken.balanceOf(ipVault.address);
    expect(balance2).to.equal(parseEther((maturity * 0.1).toString()));
  });
});
