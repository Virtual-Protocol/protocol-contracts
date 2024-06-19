const { parseEther, formatEther, toBeHex } = require("ethers/utils");
const { ethers } = require("hardhat");
const abi = ethers.AbiCoder.defaultAbiCoder();
const { expect } = require("chai");
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const getExecuteCallData = (factory, proposalId) => {
  return factory.interface.encodeFunctionData("executeApplication", [
    proposalId,
    false,
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
    const minter = await ethers.deployContract("Minter", [
      service.target,
      contribution.target,
      agentNft.target,
      process.env.IP_SHARES,
      process.env.DATA_SHARES,
      process.env.IMPACT_MULTIPLIER,
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
    maturity,
    parentId,
    isModel,
    datasetId,
    desc,
    base,
    account,
    voters
  ) {
    const { serviceNft, contributionNft, minter, agentNft } = base;
    const daoAddr = (await agentNft.virtualInfo(virtualId)).dao;
    const veAddr = (await agentNft.virtualLP(virtualId)).veToken;
    const agentDAO = await ethers.getContractAt("AgentDAO", daoAddr);
    const veToken = await ethers.getContractAt("AgentVeToken", veAddr);

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
    const voteParams = isModel
      ? abi.encode(["uint256", "uint8[] memory"], [maturity, [0, 1, 1, 0, 2]])
      : "0x";

    for (const voter of voters) {
      await agentDAO
        .connect(voter)
        .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams);
    }

    await mine(600);

    await agentDAO.execute(proposalId);
    await minter.mint(proposalId);

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


  it("should set correct maturity score", async function () {
    const { persona, proposalId, service, contribution } = await loadFixture(
      proposeContribution
    );
    await contribution.mint(
      this.accounts[1],
      persona.virtualId,
      0,
      TOKEN_URI,
      proposalId,
      "0x0000000000000000000000000000000000000000",
      true,
      0
    );
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);
    /*
    Scenario: 
    1. Validator1 with 100000 votes set maturity score to 1500
    2. Validator2 with 50000 votes set maturity score to 2000
    3. Validator3 with 70000 votes set maturity score to 3000
    4. Maturity = (1500 * 100000 + 2000 * 50000 + 3000 * 50000) / 220000 = 2090.9090
    */
    const [validator1, validator2, validator3] = this.signers;
    const personaToken = await ethers.getContractAt(
      "AgentToken",
      persona.token
    );
    expect(
      formatEther(await personaToken.getVotes(validator1.address))
    ).to.be.equal("100000.0");
    expect(
      formatEther(await personaToken.getVotes(validator2.address))
    ).to.be.equal("50000.0");
    expect(
      formatEther(await personaToken.getVotes(validator3.address))
    ).to.be.equal("70000.0");
    const voteParams = abi.encode(
      ["uint256", "uint8[] memory"],
      [1500, [0, 1, 1, 0, 2]]
    );
    const voteParams2 = abi.encode(
      ["uint256", "uint8[] memory"],
      [2000, [0, 1, 1, 0, 2]]
    );
    const voteParams3 = abi.encode(
      ["uint256", "uint8[] memory"],
      [3000, [0, 1, 1, 0, 2]]
    );

    await expect(
      personaDAO.castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams)
    )
      .to.emit(personaDAO, "ValidatorEloRating")
      .withArgs(proposalId, validator1.address, 1500, [0, 1, 1, 0, 2]);
    await personaDAO
      .connect(validator2)
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams2);
    await personaDAO
      .connect(validator3)
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams3);
    await mine(43200 * 7);
    await personaDAO.execute(proposalId);
    expect(await service.getMaturity(proposalId)).to.be.equal(2090n);
    expect(await service.getImpact(proposalId)).to.be.equal(2090n);
  });

  it("should show correct impact score", async function () {
    const { persona, proposalId, service, contribution } = await loadFixture(
      proposeContribution
    );
    await contribution.mint(
      this.accounts[1],
      persona.virtualId,
      0,
      TOKEN_URI,
      proposalId,
      "0x0000000000000000000000000000000000000000",
      true,
      0
    );
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);
    /*
    Scenario: 
    Continuing from previous test case, the first service NFT has maturity score of 2090 and we are improving it to 4000, the impact should be 4000-2090 = 1910
    */
    // Proposal 1
    const voteParams = abi.encode(
      ["uint256", "uint8[] memory"],
      [1500, [0, 1, 1, 0, 2]]
    );
    const voteParams2 = abi.encode(
      ["uint256", "uint8[] memory"],
      [2000, [0, 1, 1, 0, 2]]
    );
    const voteParams3 = abi.encode(
      ["uint256", "uint8[] memory"],
      [3000, [0, 1, 1, 0, 2]]
    );
    const voteParams4 = abi.encode(
      ["uint256", "uint8[] memory"],
      [4000, [0, 1, 1, 0, 2]]
    );
    const [validator1, validator2, validator3] = this.signers;
    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      1,
      "lfg",
      voteParams
    );
    await personaDAO
      .connect(validator2)
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams2);
    await personaDAO
      .connect(validator3)
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams3);
    await mine(43200 * 7);
    await personaDAO.execute(proposalId);

    // Proposal 2
    const descHash = getDescHash(CONTRIBUTION_DESC + " V2");

    const personaDaoContract = await ethers.getContractFactory("AgentDAO");
    const mintCalldata = await getMintServiceCalldata(
      service,
      persona.virtualId,
      descHash
    );
    await personaDaoContract
      .attach(persona.dao)
      .propose(
        [service.target],
        [0],
        [mintCalldata],
        CONTRIBUTION_DESC + " V2"
      );
    const filter = personaDaoContract.attach(persona.dao).filters
      .ProposalCreated;
    const events = await personaDaoContract
      .attach(persona.dao)
      .queryFilter(filter, -1);
    const event = events[0];
    const proposalId2 = event.args[0];
    await contribution.mint(
      this.accounts[1],
      persona.virtualId,
      0,
      TOKEN_URI,
      proposalId2,
      proposalId,
      true,
      0
    );

    await personaDAO.castVoteWithReasonAndParams(
      proposalId2,
      1,
      "lfg",
      voteParams4
    );
    await personaDAO
      .connect(validator2)
      .castVoteWithReasonAndParams(proposalId2, 1, "lfg", voteParams4);
    await personaDAO
      .connect(validator3)
      .castVoteWithReasonAndParams(proposalId2, 1, "lfg", voteParams4);
    await mine(43200 * 7);
    await personaDAO.execute(proposalId2);

    expect(await service.getMaturity(proposalId2)).to.be.equal(4000n);
    expect(await service.getImpact(proposalId2)).to.be.equal(1910n);
  });

  it("should allow contribution admin to create proposal", async () => {
    const signers = await ethers.getSigners();
    const { persona, proposalId, service, contribution } = await loadFixture(
      proposeContribution
    );
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);
    await contribution.setAdmin(signers[15].address);
    await expect(
      personaDAO
        .connect(signers[15])
        .propose([personaDAO.target], [0], [ethers.ZeroAddress], "Test1")
    ).to.emit(personaDAO, "ProposalCreated");

    await expect(
      personaDAO
        .connect(signers[14])
        .propose([personaDAO.target], [0], [ethers.ZeroAddress], "Test2")
    ).to.be.reverted;

    await contribution.connect(signers[15]).setAdmin(signers[14].address);

    await expect(
      personaDAO
        .connect(signers[14])
        .propose([personaDAO.target], [0], [ethers.ZeroAddress], "Test3")
    ).to.emit(personaDAO, "ProposalCreated");
  });

  it("should increase validator score with for,against,abstain", async function () {
    const signers = await ethers.getSigners();
    const { persona, proposalId, service, contribution } = await loadFixture(
      proposeContribution
    );
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);

    const [validator1, validator2, validator3] = signers;
    const voteParams = abi.encode(
      ["uint256", "uint8[] memory"],
      [20, [0, 1, 1, 0, 2]]
    );

    expect(await personaDAO.scoreOf(validator1)).to.be.equal(0);
    expect(await personaDAO.scoreOf(validator2)).to.be.equal(0);
    expect(await personaDAO.scoreOf(validator3)).to.be.equal(0);
    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      0,
      "lfg",
      voteParams
    );
    await personaDAO
      .connect(validator2)
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams);
    await personaDAO
      .connect(validator3)
      .castVoteWithReasonAndParams(proposalId, 2, "lfg", voteParams);
    expect(await personaDAO.scoreOf(validator1)).to.be.equal(1n);
    expect(await personaDAO.scoreOf(validator2)).to.be.equal(1n);
    expect(await personaDAO.scoreOf(validator3)).to.be.equal(1n);
  });

  it("should reject double votes", async function () {
    const signers = await ethers.getSigners();
    const { persona, proposalId, service, contribution } = await loadFixture(
      proposeContribution
    );
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);

    const [validator1, validator2, validator3] = signers;
    const voteParams = abi.encode(
      ["uint256", "uint8[] memory"],
      [20, [0, 1, 1, 0, 2]]
    );

    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      0,
      "lfg",
      voteParams
    );
    await expect(
      personaDAO.castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams)
    ).to.be.reverted;
  });

  it("should not increase validator score with deliberate votes", async function () {
    const signers = await ethers.getSigners();
    const { persona, proposalId, service, contribution } = await loadFixture(
      proposeContribution
    );
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);

    const [validator1, validator2, validator3] = signers;
    const voteParams = abi.encode(
      ["uint256", "uint8[] memory"],
      [20, [0, 1, 1, 0, 2]]
    );

    expect(await personaDAO.scoreOf(validator1)).to.be.equal(0);
    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      3,
      "lfg",
      voteParams
    );
    expect(await personaDAO.scoreOf(validator1)).to.be.equal(0);
  });

  it("should not increase validator score with deliberate votes after a valid vote", async function () {
    const signers = await ethers.getSigners();
    const { persona, proposalId, service, contribution } = await loadFixture(
      proposeContribution
    );
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);

    const [validator1, validator2, validator3] = signers;
    const voteParams = abi.encode(
      ["uint256", "uint8[] memory"],
      [20, [0, 1, 1, 0, 2]]
    );

    expect(await personaDAO.scoreOf(validator1)).to.be.equal(0);
    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      1,
      "lfg",
      voteParams
    );
    expect(await personaDAO.scoreOf(validator1)).to.be.equal(1n);
    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      3,
      "lfg",
      voteParams
    );
    expect(await personaDAO.scoreOf(validator1)).to.be.equal(1n);
  });

  it("should not emit ValidatorEloRating for deliberate votes", async function () {
    const signers = await ethers.getSigners();
    const { persona, proposalId, service, contribution } = await loadFixture(
      proposeContribution
    );
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);

    // Only contribution proposal will emit ValidatorEloRating event
    await contribution.mint(
      this.accounts[1],
      persona.virtualId,
      0,
      TOKEN_URI,
      proposalId,
      "0x0000000000000000000000000000000000000000",
      true,
      0
    );

    const voteParams = abi.encode(
      ["uint256", "uint8[] memory"],
      [20, [0, 1, 1, 0, 2]]
    );

    await expect(
      personaDAO.castVoteWithReasonAndParams(proposalId, 3, "lfg", voteParams)
    ).to.not.to.emit(personaDAO, "ValidatorEloRating");
    await expect(
      personaDAO.castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams)
    ).to.emit(personaDAO, "ValidatorEloRating");
  });
});
