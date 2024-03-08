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
  ]);
};

const getMintServiceCalldata = async (serviceNft, virtualId, hash) => {
  return serviceNft.interface.encodeFunctionData("mint", [virtualId, hash]);
};

function getDescHash(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

describe("Rewards", function () {
  const PROPOSAL_THRESHOLD = parseEther("5000");
  const QUORUM = parseEther("10000");
  const STAKE_AMOUNTS = [
    parseEther("5000"),
    parseEther("100000"),
    parseEther("5000"),
    parseEther("2000"),
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
      "VirtualGenesisDAO",
      [veToken.target, 0, 100, 0],
      {}
    );
    await protocolDAO.waitForDeployment();

    const personaNft = await ethers.deployContract("AgentNft");
    await personaNft.initialize(deployer.address);
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
      PROPOSAL_THRESHOLD,
      5,
      protocolDAO.target,
      deployer.address
    );

    await personaNft.grantRole(
      await personaNft.MINTER_ROLE(),
      personaFactory.target
    );

    const reward = await ethers.deployContract("AgentReward", [], {});
    await reward.waitForDeployment();

    const contributionNft = await ethers.deployContract("ContributionNft");
    await contributionNft.initialize(personaNft);

    const serviceNft = await ethers.deployContract("ServiceNft");
    await serviceNft.initialize(
      personaNft,
      contributionNft.target,
      process.env.DATASET_SHARES
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
        protocolShares: 1000,
        contributorShares: 5000,
        stakerShares: 9000,
        parentShares: 2000,
        stakeThreshold: "1000000000000000000000",
      }
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
    ]);
    await dao.castVote(proposals[0], 1);
    await dao.connect(validator2).castVote(proposals[0], 1);
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
    datasetId,
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
      isModel,
      datasetId
    );

    const voteParams = isModel
      ? abi.encode(["uint256", "uint8[] memory"], [maturity, [0, 1, 1, 0, 2]])
      : "0x";
    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      1,
      "lfg",
      voteParams
    );
    await personaDAO
      .connect(signers[2])
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams);
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

    return { contributionList, ...base };
  }

  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("should be able to retrieve past reward settings", async function () {
    const { reward } = await loadFixture(deployBaseContracts);
    const settings = [1000n, 5000n, 9000n, 2000n, 1000000000000000000000n];
    expect(await reward.getRewardSettings()).to.deep.equal(settings);
    let blockNumber = await ethers.provider.getBlockNumber();
    expect(await reward.getPastRewardSettings(blockNumber - 1)).to.deep.equal(
      settings
    );
    for (let i = 0; i < 10; i++) {
      const val = i + 2;
      let blockNumber = await ethers.provider.getBlockNumber();
      await reward.setRewardSettings(val, val, val, val, val);
      await mine(1);
      expect(await reward.getPastRewardSettings(blockNumber + 1)).to.deep.equal(
        [BigInt(val), BigInt(val), BigInt(val), BigInt(val), BigInt(val)]
      );
    }
    expect(await reward.getRewardSettings()).to.deep.equal([
      11n,
      11n,
      11n,
      11n,
      11n,
    ]);
  });

  it("should calculate correct staker and validator rewards", async function () {
    const { reward, persona } = await loadFixture(stakeAndVote);
    const [validator1, staker1, validator2, staker2] = this.accounts;
    await mine(1);

    expect(
      parseFloat(
        formatEther(await reward.getTotalClaimableRewards(validator1, [1], []))
      ).toFixed(4)
    ).to.be.equal("60.2679");
    expect(
      parseFloat(
        formatEther(await reward.getTotalClaimableRewards(staker1, [1], []))
      ).toFixed(4)
    ).to.be.equal("361.6071");
    expect(
      parseFloat(
        formatEther(await reward.getTotalClaimableRewards(validator2, [1], []))
      ).toFixed(4)
    ).to.be.equal("41.7857");
    expect(
      parseFloat(
        formatEther(await reward.getTotalClaimableRewards(staker2, [1], []))
      ).toFixed(4)
    ).to.be.equal("14.4643");
  });

  it("should withdraw correct staker and validator rewards", async function () {
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

    await reward.claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator1))).toFixed(4)
    ).to.be.equal("60.2679");

    await reward.connect(staker1).claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker1))).toFixed(4)
    ).to.be.equal("361.6071");

    await reward.connect(validator2).claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator2))).toFixed(4)
    ).to.be.equal("41.7857");

    await reward.connect(staker2).claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker2))).toFixed(4)
    ).to.be.equal("14.4643");

    // Prevent double claim
    await reward.claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator1))).toFixed(4)
    ).to.be.equal("60.2679");
    await expect(reward.connect(staker1).claimAllRewards([1], []));
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker1))).toFixed(4)
    ).to.be.equal("361.6071");
    await expect(reward.connect(validator2).claimAllRewards([1], []));
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator2))).toFixed(4)
    ).to.be.equal("41.7857");
    await expect(reward.connect(staker2).claimAllRewards([1], []));
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker2))).toFixed(4)
    ).to.be.equal("14.4643");
  });

  it("should calculate correct contributor rewards", async function () {
    const { contributionList, demoToken, reward, serviceNft } =
      await loadFixture(prepareContributions);
    const taxCollector = this.signers[10];
    expect(await serviceNft.getMaturity(contributionList[0])).to.equal(200n);
    expect(await serviceNft.getMaturity(contributionList[1])).to.equal(200n);
    expect(await serviceNft.getMaturity(contributionList[2])).to.equal(100n);
    expect(await serviceNft.getMaturity(contributionList[3])).to.equal(100n);

    expect(await serviceNft.getImpact(contributionList[0])).to.equal(140n);
    expect(await serviceNft.getImpact(contributionList[1])).to.equal(60n);
    expect(await serviceNft.getImpact(contributionList[2])).to.equal(70n);
    expect(await serviceNft.getImpact(contributionList[3])).to.equal(30n);

    expect(
      formatEther(
        await reward.getTotalClaimableRewards(
          taxCollector.address,
          [],
          [contributionList[0]]
        )
      )
    ).to.be.equal("210.0");
    expect(
      formatEther(
        await reward.getTotalClaimableRewards(
          taxCollector.address,
          [],
          [contributionList[1]]
        )
      )
    ).to.be.equal("90.0");
    expect(
      formatEther(
        await reward.getTotalClaimableRewards(
          taxCollector.address,
          [],
          [contributionList[2]]
        )
      )
    ).to.be.equal("210.0");
    expect(
      formatEther(
        await reward.getTotalClaimableRewards(
          taxCollector.address,
          [],
          [contributionList[3]]
        )
      )
    ).to.be.equal("90.0");
    expect(
      formatEther(
        await reward.getTotalClaimableRewards(
          taxCollector.address,
          [],
          [contributionList[4]]
        )
      )
    ).to.be.equal("300.0");
  });

  it("should claim correct model contributor rewards", async function () {
    const { contributionList, reward, serviceNft, demoToken } =
      await loadFixture(prepareContributions);

    const taxCollector = this.signers[10];
    expect(await demoToken.balanceOf(taxCollector.address)).to.be.equal(0);

    await expect(
      reward.connect(taxCollector).claimAllRewards([], [contributionList[0]])
    ).to.be.fulfilled;
    expect(
      formatEther(await demoToken.balanceOf(taxCollector.address))
    ).to.be.equal("210.0");
    await expect(
      reward.connect(taxCollector).claimAllRewards([], [contributionList[1]])
    ).to.be.fulfilled;
    expect(
      formatEther(await demoToken.balanceOf(taxCollector.address))
    ).to.be.equal("300.0");
    await expect(
      reward.connect(taxCollector).claimAllRewards([], [contributionList[2]])
    ).to.be.fulfilled;
    expect(
      formatEther(await demoToken.balanceOf(taxCollector.address))
    ).to.be.equal("510.0");
    await expect(
      reward.connect(taxCollector).claimAllRewards([], [contributionList[3]])
    ).to.be.fulfilled;
    expect(
      formatEther(await demoToken.balanceOf(taxCollector.address))
    ).to.be.equal("600.0");
    await expect(
      reward.connect(taxCollector).claimAllRewards([], [contributionList[4]])
    ).to.be.fulfilled;
    expect(
      formatEther(await demoToken.balanceOf(taxCollector.address))
    ).to.be.equal("900.0");

    // Prevent double claim
    await expect(
      reward.connect(taxCollector).claimAllRewards([], contributionList)
    ).to.be.fulfilled;
    expect(
      formatEther(await demoToken.balanceOf(taxCollector.address))
    ).to.be.equal("900.0");
  });

  it("should claim correct total rewards", async function () {
    const { contributionList, reward, serviceNft, demoToken } =
      await loadFixture(prepareContributions);
    const [validator1, staker1, validator2, staker2] = this.signers;
    const taxCollector = this.signers[10];
    await mine(1);

    await reward.connect(validator1).claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator1))).toFixed(4)
    ).to.be.equal("163.5842");
    await reward.connect(staker1).claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker1))).toFixed(4)
    ).to.be.equal("981.5051");
    await reward.connect(validator2).claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(validator2))).toFixed(4)
    ).to.be.equal("83.5714");
    await reward.connect(staker2).claimAllRewards([1], []);
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(staker2))).toFixed(4)
    ).to.be.equal("28.9286");

    await expect(
      reward.connect(taxCollector).claimAllRewards([], contributionList)
    ).to.be.fulfilled;
    expect(
      parseFloat(formatEther(await demoToken.balanceOf(taxCollector))).toFixed(
        4
      )
    ).to.be.equal("900.0000");
  });

  it("should withdraw correct protocol rewards", async function () {
    const { contributionList, reward, serviceNft, demoToken } =
      await loadFixture(prepareContributions);
    const treasury = this.signers[9];

    expect(await demoToken.balanceOf(treasury.address)).to.be.equal(
      parseEther("0")
    );
    await reward.withdrawProtocolRewards(treasury.address);
    expect(await demoToken.balanceOf(treasury.address)).to.be.equal(
      parseEther("400")
    );
  });

  it("should withdraw correct validator pool rewards", async function () {
    const { contributionList, reward, serviceNft, demoToken } =
      await loadFixture(prepareContributions);
    const treasury = this.signers[9];

    expect(await demoToken.balanceOf(treasury.address)).to.be.equal(
      parseEther("0")
    );
    await reward.withdrawValidatorPoolRewards(treasury.address);
    expect(
      parseFloat(
        formatEther(await demoToken.balanceOf(treasury.address))
      ).toFixed(4)
    ).to.be.equal("542.4107");
  });
});
