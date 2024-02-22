/*
Test scenario:
1. Accounts: [validator1, staker1, validator2, staker2]
2. Stakes: [100000, 2000, 5000, 20000]
3. Uptime: [3,1]
4. All contribution NFTs are owned by account #10
*/
const { expect } = require("chai");
const { toBeHex } = require("ethers/utils");
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { parseEther, formatEther } = require("ethers");

const getExecuteCallData = (factory, proposalId) => {
  return factory.interface.encodeFunctionData("executeApplication", [
    proposalId,
  ]);
};

const getMintServiceCalldata = async (serviceNft, virtualId, hash) => {
  return serviceNft.interface.encodeFunctionData("mint", [virtualId, hash]);
};

function getDescHash(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

describe("Rewards", function () {
  const PROPOSAL_THRESHOLD = parseEther("10000");
  const QUORUM = parseEther("10000");
  const STAKE_AMOUNTS = [
    parseEther("10000"),
    parseEther("2000"),
    parseEther("5000"),
    parseEther("20000"),
  ];
  const UPTIME = [3, 1];
  const REWARD_AMOUNT = parseEther("2000");

  const TOKEN_URI = "http://jessica";

  const genesisInput = {
    name: "Jessica",
    symbol: "JSC",
    tokenURI: "http://jessica",
    daoName: "Jessica DAO",
    cores: [0, 1, 2],
    tbaSalt:
      "0xa7647ac9429fdce477ebd9a95510385b756c757c26149e740abbab0ad1be2f16",
    tbaImplementation: ethers.ZeroAddress,
    daoVotingPeriod: 600,
    daoThreshold: 1000000000000000000000n,
  };

  async function deployBaseContracts() {
    const signers = await ethers.getSigners();

    const [deployer] = await ethers.getSigners();
    const veToken = await ethers.deployContract(
      "veVirtualToken",
      [deployer.address],
      {}
    );
    await veToken.waitForDeployment();

    const demoToken = await ethers.deployContract(
      "BMWToken",
      [deployer.address],
      {}
    );
    await demoToken.waitForDeployment();

    const protocolDAO = await ethers.deployContract(
      "VirtualProtocolDAO",
      [
        veToken.target,
        process.env.PROTOCOL_VOTING_DELAY,
        process.env.PROTOCOL_VOTING_PERIOD,
        process.env.PROTOCOL_PROPOSAL_THRESHOLD,
        process.env.PROTOCOL_QUORUM_NUMERATOR,
      ],
      {}
    );
    await protocolDAO.waitForDeployment();

    const personaNft = await ethers.deployContract("AgentNft", [
      deployer.address,
    ]);
    await personaNft.waitForDeployment();

    const personaToken = await ethers.deployContract("AgentToken");
    await personaToken.waitForDeployment();
    const personaDAO = await ethers.deployContract("AgentDAO");
    await personaDAO.waitForDeployment();

    const tba = await ethers.deployContract("ERC6551Registry");

    const personaFactory = await ethers.deployContract("AgentFactory");
    await personaFactory.initialize(
      personaToken.target,
      personaDAO.target,
      tba.target,
      demoToken.target,
      personaNft.target,
      protocolDAO.target,
      PROPOSAL_THRESHOLD,
      5,
      protocolDAO.target,
    );

    await personaNft.grantRole(
      await personaNft.MINTER_ROLE(),
      personaFactory.target
    );

    const reward = await ethers.deployContract("AgentReward", [], {});
    await reward.waitForDeployment();

    const contributionNft = await ethers.deployContract(
      "ContributionNft",
      [personaNft],
      {}
    );

    const serviceNft = await ethers.deployContract(
      "ServiceNft",
      [personaNft, contributionNft.target],
      {}
    );

    await personaNft.setContributionService(
      contributionNft.target,
      serviceNft.target
    );

    await reward.initialize(
      demoToken.target,
      personaNft.target,
      contributionNft.target,
      serviceNft.target,
      {
        uptimeWeight: 7000,
        stakeWeight: 3000,
        protocolShares: 1000,
        contributorShares: 5000,
        stakerShares: 9000,
        datasetShares: 7000,
        impactShares: 5000,
      },
      "2000000000000000000",
      2000
    );
    const role = await reward.GOV_ROLE();
    await reward.grantRole(role, signers[0].address);

    return {
      reward,
      veToken,
      protocolDAO,
      demoToken,
      personaFactory,
      personaNft,
      contributionNft,
      serviceNft,
    };
  }

  async function deployGenesisVirtual() {
    const contracts = await deployBaseContracts();
    const { personaFactory, veToken, protocolDAO, demoToken } = contracts;
    const [deployer] = await ethers.getSigners();

    // Prepare tokens for proposal
    await demoToken.mint(deployer.address, PROPOSAL_THRESHOLD);
    await demoToken.approve(personaFactory.target, PROPOSAL_THRESHOLD);

    await personaFactory.proposePersona(
      genesisInput.name,
      genesisInput.symbol,
      genesisInput.tokenURI,
      genesisInput.cores,
      genesisInput.tbaSalt,
      genesisInput.tbaImplementation,
      genesisInput.daoVotingPeriod,
      genesisInput.daoThreshold
    );

    const filter = personaFactory.filters.NewApplication;
    const events = await personaFactory.queryFilter(filter, -1);
    const event = events[0];
    const { id } = event.args;

    // Create proposal
    await veToken.oracleTransfer(
      [ethers.ZeroAddress],
      [deployer.address],
      [parseEther("100000000")]
    );
    await veToken.delegate(deployer.address);

    await protocolDAO.propose(
      [personaFactory.target],
      [0],
      [getExecuteCallData(personaFactory, id)],
      "Create Jessica"
    );

    const daoFilter = protocolDAO.filters.ProposalCreated;
    const daoEvents = await protocolDAO.queryFilter(daoFilter, -1);
    const daoEvent = daoEvents[0];
    const daoProposalId = daoEvent.args[0];

    await protocolDAO.castVote(daoProposalId, 1);
    await mine(600);

    await protocolDAO.execute(daoProposalId);
    const factoryFilter = personaFactory.filters.NewPersona;
    const factoryEvents = await personaFactory.queryFilter(factoryFilter, -1);
    const factoryEvent = factoryEvents[0];

    const { virtualId, token, dao } = factoryEvent.args;
    const persona = { virtualId, token, dao };
    return { ...contracts, persona };
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
      dao
        .propose([persona.token], [0], ["0x"], "Proposal 3")
        .then((tx) => tx.wait())
        .then((receipt) => receipt.logs[0].args[0]),
    ]);
    await dao.castVote(proposals[0], 1);
    await dao.castVote(proposals[1], 1);
    await dao.castVote(proposals[2], 1);
    await dao.connect(validator2).castVote(proposals[1], 1);

    // Distribute rewards
    await demoToken.mint(validator1, REWARD_AMOUNT);
    await demoToken.approve(reward.target, REWARD_AMOUNT);
    await reward.distributeRewards(REWARD_AMOUNT);

    return { ...base };
  }

  async function createContribution(
    coreId,
    maturity,
    parentId,
    isModel,
    desc,
    base,
    account
  ) {
    const signers = await ethers.getSigners();
    const { persona, serviceNft, contributionNft } = base;
    const personaDAO = await ethers.getContractAt("AgentDAO", persona.dao);

    const descHash = getDescHash(desc);

    const mintCalldata = await getMintServiceCalldata(
      serviceNft,
      persona.virtualId,
      descHash
    );

    await personaDAO.propose([serviceNft.target], [0], [mintCalldata], desc);
    const filter = personaDAO.filters.ProposalCreated;
    const events = await personaDAO.queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];

    await contributionNft.mint(
      account,
      persona.virtualId,
      coreId,
      TOKEN_URI,
      proposalId,
      parentId,
      isModel
    );

    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      1,
      "lfg",
      toBeHex(maturity, 32)
    );
    await personaDAO
      .connect(signers[1])
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", toBeHex(maturity, 32));
    await personaDAO
      .connect(signers[2])
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", toBeHex(maturity, 32));
    await mine(600);

    await personaDAO.execute(proposalId);

    return proposalId;
  }

  async function prepareContributions() {
    /*
    NFT 1 (LLM DS)	
    NFT 2 (LLM Model)	
    NFT 3 (Voice DS)	
    NFT 4 (Voice Model *current)	
    NFT5 (LLM Model *current)
    */
    const base = await stakeAndVote();
    const signers = await ethers.getSigners();
    const [validator1, staker1, validator2, staker2] = signers;
    const contributionList = [];
    const account = signers[10].address;

    // NFT 1 (LLM DS)
    let nft = await createContribution(0, 0, 0, false, "LLM DS", base, account);
    contributionList.push(nft);

    // NFT 2 (LLM Model)
    nft = await createContribution(0, 10, 0, true, "LLM Model", base, account);
    contributionList.push(nft);

    // NFT 3 (Voice DS)
    nft = await createContribution(1, 0, 0, false, "Voice DS", base, account);
    contributionList.push(nft);

    // NFT 4 (Voice Model *current)
    nft = await createContribution(
      1,
      40,
      0,
      true,
      "Voice Model",
      base,
      account
    );
    contributionList.push(nft);

    // NFT 5 (LLM Model *current)
    nft = await createContribution(
      0,
      20,
      contributionList[1],
      true,
      "LLM Model 2",
      base,
      account
    );
    contributionList.push(nft);

    await base.demoToken.mint(validator1, REWARD_AMOUNT);
    await base.demoToken.approve(base.reward.target, REWARD_AMOUNT);
    await base.reward.distributeRewards(REWARD_AMOUNT);

    return { contributionList, ...base };
  }

  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("should be able to retrieve past reward settings", async function () {
    const { reward } = await loadFixture(deployBaseContracts);
    const settings = [7000n, 3000n, 1000n, 5000n, 9000n, 7000n, 5000n];
    expect(await reward.getRewardSettings()).to.deep.equal(settings);
    let blockNumber = await ethers.provider.getBlockNumber();
    expect(await reward.getPastRewardSettings(blockNumber - 1)).to.deep.equal(
      settings
    );
    for (let i = 0; i < 10; i++) {
      const val = i + 2;
      let blockNumber = await ethers.provider.getBlockNumber();
      await reward.setRewardSettings(val, val, val, val, val, val, val);
      await mine(1);
      expect(await reward.getPastRewardSettings(blockNumber + 1)).to.deep.equal(
        [
          BigInt(val),
          BigInt(val),
          BigInt(val),
          BigInt(val),
          BigInt(val),
          BigInt(val),
          BigInt(val),
        ]
      );
    }
    expect(await reward.getRewardSettings()).to.deep.equal([
      11n,
      11n,
      11n,
      11n,
      11n,
      11n,
      11n,
    ]);
  });

  it("should allow withdrawal of protocol rewards", async function () {
    const { reward, demoToken } = await loadFixture(stakeAndVote);
    const [validator1] = this.accounts;

    expect(await demoToken.balanceOf(validator1)).to.equal(parseEther("0"));
    expect(await reward.protocolRewards()).to.equal(parseEther("200"));
    await reward.withdrawProtocolRewards();
    expect(await demoToken.balanceOf(validator1)).to.equal(parseEther("200"));
  });

  it("should calculate correct staker rewards", async function () {
    const { reward } = await loadFixture(stakeAndVote);
    const [validator1, staker1, validator2, staker2] = this.accounts;
    await mine(1);

    const total = await Promise.all([
      reward.getClaimableStakerRewards(validator1, 1),
      reward.getClaimableStakerRewards(staker1, 1),
      reward.getClaimableStakerRewards(validator2, 1),
      reward.getClaimableStakerRewards(staker2, 1),
    ]).then((rewards) => rewards.reduce((a, b) => a + b, 0n));
    expect(Math.ceil(parseFloat(formatEther(total)))).to.equal(810);
  });

  it("should withdraw correct staker rewards", async function () {
    const { reward, demoToken } = await loadFixture(stakeAndVote);
    const [validator1, staker1, validator2, staker2] = this.signers;
    await mine(1);

    expect(await demoToken.balanceOf(reward.target)).to.be.equal(
      parseEther("2000")
    );

    expect(await demoToken.balanceOf(validator1.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(staker1.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(validator2.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(staker2.address)).to.be.equal(
      parseEther("0")
    );

    await reward.claimStakerRewards(1);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator1))).toFixed(0)
    ).to.be.equal("420");

    await reward.connect(staker1).claimStakerRewards(1);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker1))).toFixed(0)
    ).to.be.equal("84");

    await reward.connect(validator2).claimStakerRewards(1);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator2))).toFixed(0)
    ).to.be.equal("61");

    await reward.connect(staker2).claimStakerRewards(1);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker2))).toFixed(0)
    ).to.be.equal("245");

    // Prevent double claim
    await reward.claimStakerRewards(1);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator1))).toFixed(0)
    ).to.be.equal("420");
    await expect(reward.connect(staker1).claimStakerRewards(1))
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker1))).toFixed(0)
    ).to.be.equal("84");
    await reward.connect(validator2).claimStakerRewards(1)
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator2))).toFixed(0)
    ).to.be.equal("61");
    await reward.connect(staker2).claimStakerRewards(1)
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker2))).toFixed(0)
    ).to.be.equal("245");
  });

  it("should calculate correct staker rewards", async function () {
    const { reward } = await loadFixture(stakeAndVote);
    const [validator1, staker1, validator2, staker2] = this.accounts;
    await mine(1);

    const amt1 = await reward.getClaimableValidatorRewards(validator1, 1);
    const amt2 = await reward.getClaimableValidatorRewards(staker1, 1);
    const amt3 = await reward.getClaimableValidatorRewards(validator2, 1);
    const amt4 = await reward.getClaimableValidatorRewards(staker2, 1);
    expect(Math.round(formatEther(amt1))).to.equal(56);
    expect(Math.round(formatEther(amt2))).to.equal(0);
    expect(Math.round(formatEther(amt3))).to.equal(34);
    expect(Math.round(formatEther(amt4))).to.equal(0);
  });

  it("should withdraw correct validator rewards", async function () {
    const { reward, demoToken } = await loadFixture(stakeAndVote);
    const [validator1, staker1, validator2, staker2] = this.signers;
    await mine(1);

    expect(await demoToken.balanceOf(reward.target)).to.be.equal(
      parseEther("2000")
    );

    expect(await demoToken.balanceOf(validator1.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(staker1.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(validator2.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(staker2.address)).to.be.equal(
      parseEther("0")
    );

    await reward.claimValidatorRewards(1);
    expect(
      Math.round(formatEther(await demoToken.balanceOf(validator1)))
    ).to.be.equal(56);

    await reward.connect(validator2).claimValidatorRewards(1);
    expect(
      Math.round(formatEther(await demoToken.balanceOf(validator2)))
    ).to.be.equal(34);

    // Prevent double claim
    expect(reward.claimValidatorRewards(1));
    expect(
      Math.round(formatEther(await demoToken.balanceOf(validator1)))
    ).to.be.equal(56);

    await reward.connect(staker1).claimValidatorRewards(1);
    expect(
      Math.round(formatEther(await demoToken.balanceOf(staker1)))
    ).to.be.equal(0);

    await reward.connect(validator2).claimValidatorRewards(1);
    expect(
      Math.round(formatEther(await demoToken.balanceOf(validator2)))
    ).to.be.equal(34);

    await reward.connect(staker2).claimValidatorRewards(1);
    expect(
      Math.round(formatEther(await demoToken.balanceOf(staker2)))
    ).to.be.equal(0);
  });

  it("should calculate correct model contributor rewards", async function () {
    const { contributionList, reward, serviceNft } = await loadFixture(
      prepareContributions
    );
    expect(await serviceNft.getMaturity(contributionList[0])).to.equal(0n);
    expect(await serviceNft.getMaturity(contributionList[1])).to.equal(10n);
    expect(await serviceNft.getMaturity(contributionList[2])).to.equal(0n);
    expect(await serviceNft.getMaturity(contributionList[3])).to.equal(40n);
    expect(await serviceNft.getMaturity(contributionList[4])).to.equal(20n);

    expect(await reward.getModelReward(contributionList[0])).to.deep.equal([
      parseEther("0"),
      parseEther("0"),
      parseEther("0"),
      parseEther("0"),
    ]);
    expect(await reward.getClaimableModelRewards(contributionList[0])).to.equal(
      0n
    );
    expect(await reward.getModelReward(contributionList[1])).to.deep.equal([
      parseEther("75"),
      parseEther("0"),
      parseEther("0"),
      parseEther("0"),
    ]);
    expect(await reward.getClaimableModelRewards(contributionList[1])).to.equal(
      parseEther("90")
    ); // 75 + 15 (NFT5's 20%)
    expect(await reward.getModelReward(contributionList[2])).to.deep.equal([
      parseEther("0"),
      parseEther("0"),
      parseEther("0"),
      parseEther("0"),
    ]);
    expect(await reward.getClaimableModelRewards(contributionList[2])).to.equal(
      parseEther("0")
    );
    expect(await reward.getModelReward(contributionList[3])).to.deep.equal([
      parseEther("367.5"),
      parseEther("0"),
      parseEther("0"),
      parseEther("0"),
    ]);
    expect(await reward.getClaimableModelRewards(contributionList[3])).to.equal(
      parseEther("367.5")
    );
    expect(await reward.getModelReward(contributionList[4])).to.deep.equal([
      parseEther("127.5"),
      parseEther("15"),
      parseEther("0"),
      parseEther("0"),
    ]);
    expect(await reward.getClaimableModelRewards(contributionList[4])).to.equal(
      parseEther("127.5")
    ); // 142.5 - 15 (NFT5's parent 20%)
  });

  it("should claim correct model contributor rewards", async function () {
    const { contributionList, reward, serviceNft, demoToken } =
      await loadFixture(prepareContributions);

    const taxCollector = this.signers[10];
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(0);

    await expect(
      reward.connect(taxCollector).claimModelRewards(contributionList[0])
    ).to.be.revertedWith("Not a model NFT");
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(0n);

    await expect(
      reward.connect(taxCollector).claimModelRewards(contributionList[1])
    )
      .to.emit(reward, "ModelRewardsClaimed")
      .withArgs(
        contributionList[1],
        taxCollector.address,
        parseEther("90"),
        parseEther("15")
      );
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(
      parseEther("90")
    );

    await expect(
      reward.connect(taxCollector).claimModelRewards(contributionList[2])
    ).to.be.revertedWith("Not a model NFT");
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(
      parseEther("90")
    );

    await expect(
      reward.connect(taxCollector).claimModelRewards(contributionList[3])
    )
      .to.emit(reward, "ModelRewardsClaimed")
      .withArgs(
        contributionList[3],
        taxCollector.address,
        parseEther("367.5"),
        parseEther("0")
      );
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(
      parseEther("457.5")
    );

    await expect(
      reward.connect(taxCollector).claimModelRewards(contributionList[4])
    )
      .to.emit(reward, "ModelRewardsClaimed")
      .withArgs(
        contributionList[4],
        taxCollector.address,
        parseEther("127.5"),
        parseEther("0")
      );
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(
      parseEther("585")
    );
  });

  it("should calculate correct dataset contributor rewards", async function () {
    const { contributionList, reward, serviceNft } = await loadFixture(
      prepareContributions
    );

    expect(
      await reward.getClaimableDatasetRewards(contributionList[0])
    ).to.equal(parseEther("157.5"));
    expect(
      await reward.getClaimableDatasetRewards(contributionList[1])
    ).to.equal(parseEther("0"));
    expect(
      await reward.getClaimableDatasetRewards(contributionList[2])
    ).to.equal(parseEther("157.5"));
    expect(
      await reward.getClaimableDatasetRewards(contributionList[3])
    ).to.equal(parseEther("0"));
    expect(
      await reward.getClaimableDatasetRewards(contributionList[4])
    ).to.equal(parseEther("0"));
  });

  it("should claim correct dataset rewards", async function () {
    const { contributionList, reward, demoToken } = await loadFixture(
      prepareContributions
    );
    const taxCollector = this.signers[10];
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(0);
    await expect(
      reward.claimDatasetRewards(contributionList[0])
    ).to.be.revertedWith("Only NFT owner can claim rewards");

    await expect(
      reward.connect(taxCollector).claimDatasetRewards(contributionList[0])
    )
      .to.emit(reward, "DatasetRewardsClaimed")
      .withArgs(contributionList[0], taxCollector.address, parseEther("157.5"));
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(
      parseEther("157.5")
    );

    await reward.connect(taxCollector).claimDatasetRewards(contributionList[1]);
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(
      parseEther("157.5")
    ); // Nothing to claim, balance remains the same

    await expect(
      reward.connect(taxCollector).claimDatasetRewards(contributionList[2])
    )
      .to.emit(reward, "DatasetRewardsClaimed")
      .withArgs(contributionList[2], taxCollector.address, parseEther("157.5"));
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(
      parseEther("315")
    );

    await reward.connect(taxCollector).claimDatasetRewards(contributionList[3]);
    await reward.connect(taxCollector).claimDatasetRewards(contributionList[4]);

    // Prevent double claim
    await reward.connect(taxCollector).claimDatasetRewards(contributionList[0]);
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(
      parseEther("315")
    ); // Nothing to claim, balance remains the same
  });

  it("should claim correct total rewards", async function () {
    const base = await loadFixture(stakeAndVote);
    const { reward, demoToken, contributionNft } = base;
    const [validator1, staker1, validator2, staker2] = this.signers;
    await mine(1);

    expect(await demoToken.balanceOf(validator1.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(staker1.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(validator2.address)).to.be.equal(
      parseEther("0")
    );
    expect(await demoToken.balanceOf(staker2.address)).to.be.equal(
      parseEther("0")
    );

    // Prepare contributions
    // validator1 = model contributor, staker1 = ds contributor
    // NFT 1 (LLM DS)
    const contributionList = [];
    let nft = await createContribution(
      0,
      0,
      0,
      false,
      "LLM DS",
      base,
      staker1.address
    );
    contributionList.push(nft);

    // NFT 2 (LLM Model)
    nft = await createContribution(
      0,
      10,
      0,
      true,
      "LLM Model",
      base,
      validator1.address
    );
    contributionList.push(nft);

    // NFT 3 (Voice DS)
    nft = await createContribution(
      1,
      0,
      0,
      false,
      "Voice DS",
      base,
      staker1.address
    );
    contributionList.push(nft);

    // NFT 4 (Voice Model *current)
    nft = await createContribution(
      1,
      40,
      0,
      true,
      "Voice Model",
      base,
      validator1.address
    );
    contributionList.push(nft);

    // NFT 5 (LLM Model *current)
    nft = await createContribution(
      0,
      20,
      contributionList[1],
      true,
      "LLM Model 2",
      base,
      validator1.address
    );
    contributionList.push(nft);

    await base.demoToken.mint(validator1.address, REWARD_AMOUNT);
    await base.demoToken.approve(reward.target, REWARD_AMOUNT);
    await base.reward.distributeRewards(REWARD_AMOUNT);
    await mine(1);
    //////////

    const expectedVSAmount = [856.51, 151.15, 221.85, 570.48];
    const expectedContributorAmount = [585, 315, 0, 0];

    for (let i = 0; i < 4; i++) {
      const { datasetNfts, modelNfts } = await getNfts(
        this.signers[i].address,
        contributionNft
      );
      expect(
        parseFloat(
          formatEther(
            await reward.getTotalClaimableRewards(
              this.signers[i].address,
              1,
              datasetNfts,
              modelNfts
            )
          )
        ).toFixed(2)
      ).to.equal(`${expectedVSAmount[i] + expectedContributorAmount[i]}`);
      await reward
        .connect(this.signers[i])
        .claimAllRewards(1, datasetNfts, modelNfts);
      expect(
        parseFloat(
          formatEther(await demoToken.balanceOf(this.signers[i].address))
        ).toFixed(2)
      ).to.be.equal(`${expectedVSAmount[i] + expectedContributorAmount[i]}`);
    }
  });

  async function getNfts(account, contributionNft) {
    const totalNfts = await contributionNft.balanceOf(account);
    const datasetNfts = [];
    const modelNfts = [];
    for (let i = 0; i < totalNfts; i++) {
      const id = await contributionNft.tokenOfOwnerByIndex(account, i);
      const isModel = await contributionNft.isModel(id);
      if (isModel) {
        modelNfts.push(id);
      } else {
        datasetNfts.push(id);
      }
    }
    return { datasetNfts, modelNfts };
  }
});
