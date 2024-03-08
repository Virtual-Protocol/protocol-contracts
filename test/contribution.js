/*
We will test the end-to-end implementation of a Contribution flow till Service.

1. Prepare 100k tokens
2. Propose a new Persona at AgentFactory
3. Once received proposalId from AgentFactory, create a proposal at ProtocolDAO
4. Vote on the proposal
5. Execute the proposal
*/
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
  ]);
};

const getMintServiceCalldata = async (serviceNft, virtualId, hash) => {
  return serviceNft.interface.encodeFunctionData("mint", [virtualId, hash]);
};

describe("Contribution", function () {
  const PROPOSAL_THRESHOLD = parseEther("100000");
  const CONTRIBUTION_DESC = "LLM Model #1001";
  const TOKEN_URI = "http://virtuals.io";

  async function deployBaseContracts() {
    const signers = await ethers.getSigners();
    const [deployer] = signers;
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

    const AgentNft = await ethers.getContractFactory("AgentNft");
    const personaNft = await upgrades.deployProxy(AgentNft, [deployer.address]);

    const personaToken = await ethers.deployContract("AgentToken");
    await personaToken.waitForDeployment();
    const personaDAO = await ethers.deployContract("AgentDAO");
    await personaDAO.waitForDeployment();

    const tba = await ethers.deployContract("ERC6551Registry");

    const personaFactory = await upgrades.deployProxy(
      await ethers.getContractFactory("AgentFactory"),
      [
        personaToken.target,
        personaDAO.target,
        tba.target,
        demoToken.target,
        personaNft.target,
        PROPOSAL_THRESHOLD,
        5,
        protocolDAO.target,
        deployer.address,
      ]
    );
    
    await personaNft.grantRole(
      await personaNft.MINTER_ROLE(),
      personaFactory.target
    );

    const contribution = await upgrades.deployProxy(
      await ethers.getContractFactory("ContributionNft"),
      [personaNft.target],
      {}
    );

    const service = await upgrades.deployProxy(
      await ethers.getContractFactory("ServiceNft"),
      [personaNft.target, contribution.target, process.env.DATASET_SHARES],
      {}
    );

    await personaNft.setContributionService(
      contribution.target,
      service.target
    );

    return {
      veToken,
      protocolDAO,
      demoToken,
      personaFactory,
      personaNft,
      contribution,
      service,
    };
  }

  async function deployGenesisVirtual() {
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

    const { virtualId, token, dao, tba } = factoryEvent.args;
    const persona = { virtualId, token, dao, tba };
    return { ...contracts, persona };
  }

  async function proposeContribution() {
    const signers = await ethers.getSigners();
    const base = await loadFixture(deployGenesisVirtual);
    const { persona, personaNft, service, demoToken } = base;
    const descHash = getDescHash(CONTRIBUTION_DESC);

    const personaDaoContract = await ethers.getContractFactory("AgentDAO");
    const mintCalldata = await getMintServiceCalldata(
      service,
      persona.virtualId,
      descHash
    );

    // Prepare tokens for other validator
    const [validator1, validator2, validator3] = signers;
    await demoToken.mint(validator2.address, parseEther("50000"));
    await demoToken
      .connect(validator2)
      .approve(persona.token, parseEther("50000"));
    await demoToken.mint(validator3.address, parseEther("70000"));
    await demoToken
      .connect(validator3)
      .approve(persona.token, parseEther("70000"));
    // // Set as validator
    await personaNft.addValidator(persona.virtualId, validator2.address);
    await personaNft.addValidator(persona.virtualId, validator3.address);
    const tokenInstance = await ethers.getContractAt(
      "AgentToken",
      persona.token
    );
    await tokenInstance
      .connect(validator2)
      .stake(parseEther("50000"), validator2.address, validator2.address);
    await tokenInstance
      .connect(validator3)
      .stake(parseEther("70000"), validator3.address, validator3.address);

    await personaDaoContract
      .attach(persona.dao)
      .propose([service.target], [0], [mintCalldata], CONTRIBUTION_DESC);
    const filter = personaDaoContract.attach(persona.dao).filters
      .ProposalCreated;
    const events = await personaDaoContract
      .attach(persona.dao)
      .queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];
    return { ...base, proposalId };
  }

  function getDescHash(str) {
    return ethers.keccak256(ethers.toUtf8Bytes(str));
  }

  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("should be able to mint a new contribution", async function () {
    const { proposalId, contribution, persona } = await loadFixture(
      proposeContribution
    );

    // Mint contribution
    await expect(
      contribution.mint(
        this.accounts[1],
        persona.virtualId,
        0,
        TOKEN_URI,
        proposalId,
        "0x0000000000000000000000000000000000000000",
        true,
        0
      )
    ).to.emit(contribution, "NewContribution");

    expect(await contribution.ownerOf(proposalId)).to.be.equal(
      this.accounts[1]
    );
  });

  it("should mint service nft once proposal accepted", async function () {
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
    // We need 51% to reach quorum
    const voteParams = abi.encode(
      ["uint256", "uint8[] memory"],
      [20, [0, 1, 1, 0, 2]]
    );

    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      1,
      "lfg",
      voteParams
    );
    await personaDAO
      .connect(this.signers[2])
      .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams);
    await mine(600);
    await personaDAO.execute(proposalId);

    expect(await service.ownerOf(proposalId)).to.be.equal(persona.tba);
    expect(await service.tokenURI(proposalId)).to.be.equal(TOKEN_URI);
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
