/*
We will test the end-to-end implementation of a Virtual genesis initiation

1. Prepare 100k tokens
2. Propose a new Persona at AgentFactory
3. Once received proposalId from AgentFactory, create a proposal at ProtocolDAO
4. Vote on the proposal
5. Execute the proposal
*/
const { parseEther, toBeHex } = require("ethers/utils");
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

describe("AgentFactory", function () {
  const PROPOSAL_THRESHOLD = parseEther("100000");
  const QUORUM = parseEther("10000");
  const PROTOCOL_DAO_VOTING_PERIOD = 300;
  const MATURITY_SCORE = toBeHex(2000, 32); // 20%

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
      [veToken.target, 0, PROTOCOL_DAO_VOTING_PERIOD, PROPOSAL_THRESHOLD, 500],
      {}
    );
    await protocolDAO.waitForDeployment();

    const AgentNft = await ethers.getContractFactory("AgentNft");
    const personaNft = await upgrades.deployProxy(AgentNft, [deployer.address]);

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

    return { veToken, protocolDAO, demoToken, personaFactory, personaNft };
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
    await mine(PROTOCOL_DAO_VOTING_PERIOD);

    await protocolDAO.execute(daoProposalId);
    const factoryFilter = personaFactory.filters.NewPersona;
    const factoryEvents = await personaFactory.queryFilter(factoryFilter, -1);
    const factoryEvent = factoryEvents[0];

    const { virtualId, token, dao } = factoryEvent.args;
    const persona = { virtualId, token, dao };
    return { ...contracts, persona };
  }

  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("should deny new Persona proposal when insufficient asset token", async function () {
    const { personaFactory, personaNft } = await loadFixture(
      deployBaseContracts
    );

    await expect(
      personaFactory.proposePersona(
        genesisInput.name,
        genesisInput.symbol,
        genesisInput.tokenURI,
        genesisInput.cores,
        genesisInput.tbaSalt,
        genesisInput.tbaImplementation,
        genesisInput.daoVotingPeriod,
        genesisInput.daoThreshold
      )
    ).to.be.revertedWith("Insufficient asset token");
  });

  it("should propose a new Persona", async function () {
    const { personaFactory, personaNft, demoToken } = await loadFixture(
      deployBaseContracts
    );

    // Prepare tokens for proposal
    await demoToken.mint(this.accounts[0], PROPOSAL_THRESHOLD);
    expect(await demoToken.balanceOf(this.accounts[0])).to.be.equal(
      PROPOSAL_THRESHOLD
    );
    await demoToken.approve(personaFactory.target, PROPOSAL_THRESHOLD);

    const tx = await personaFactory.proposePersona(
      genesisInput.name,
      genesisInput.symbol,
      genesisInput.tokenURI,
      genesisInput.cores,
      genesisInput.tbaSalt,
      genesisInput.tbaImplementation,
      genesisInput.daoVotingPeriod,
      genesisInput.daoThreshold
    );
    expect(tx).to.emit(personaFactory, "NewPersona");

    expect(await demoToken.balanceOf(this.accounts[0])).to.be.equal(0n);

    const filter = personaFactory.filters.NewApplication;
    const events = await personaFactory.queryFilter(filter, -1);
    const event = events[0];
    const { id } = event.args;
    expect(id).to.not.be.equal(0n);
  });

  it("should allow proposal execution by DAO", async function () {
    const { personaFactory, personaNft, demoToken, veToken, protocolDAO } =
      await loadFixture(deployBaseContracts);

    const [deployer] = this.signers;

    // Prepare tokens for proposal
    await demoToken.mint(this.accounts[0], PROPOSAL_THRESHOLD);
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
      "LFG"
    );

    const daoFilter = protocolDAO.filters.ProposalCreated;
    const daoEvents = await protocolDAO.queryFilter(daoFilter, -1);
    const daoEvent = daoEvents[0];
    const daoProposalId = daoEvent.args[0];

    await protocolDAO.castVote(daoProposalId, 1);
    await mine(PROTOCOL_DAO_VOTING_PERIOD);

    await expect(protocolDAO.execute(daoProposalId)).to.emit(
      personaFactory,
      "NewPersona"
    );
    const factoryFilter = personaFactory.filters.NewPersona;
    const factoryEvents = await personaFactory.queryFilter(factoryFilter, -1);
    const factoryEvent = factoryEvents[0];

    const { virtualId, token, dao, tba } = factoryEvent.args;
    const persona = { virtualId, token, dao, tba };

    // Check if the Persona was created successfully
    const firstToken = await personaFactory.allTokens(0);
    const firstDao = await personaFactory.allDAOs(0);
    expect(firstToken).to.not.equal(ethers.ZeroAddress);
    expect(firstDao).to.not.equal(ethers.ZeroAddress);

    const AgentDAO = await ethers.getContractFactory("AgentDAO");
    const daoInstance = AgentDAO.attach(dao);
    expect(await daoInstance.token()).to.equal(token);
    expect(await daoInstance.name()).to.equal(genesisInput.daoName);
    expect(await daoInstance.proposalThreshold()).to.equal(
      genesisInput.daoThreshold
    );
    expect(await daoInstance.votingPeriod()).to.equal(
      genesisInput.daoVotingPeriod
    );

    const AgentToken = await ethers.getContractFactory("AgentToken");
    const tokenInstance = AgentToken.attach(token);
    expect(await tokenInstance.name()).to.equal(genesisInput.name);
    expect(await tokenInstance.symbol()).to.equal(genesisInput.symbol);

    const virtualInfo = await personaNft.virtualInfo(persona.virtualId);
    expect(virtualInfo.dao).to.equal(dao);
    expect(virtualInfo.coreTypes).to.deep.equal(genesisInput.cores);

    expect(await personaNft.tokenURI(virtualId)).to.equal(
      genesisInput.tokenURI
    );
    expect((await personaNft.virtualInfo(virtualId)).tba).to.equal(tba);

    expect(await personaNft.isValidator(virtualId, deployer)).to.equal(true);

    expect(await tokenInstance.balanceOf(deployer)).to.equal(
      PROPOSAL_THRESHOLD
    );
    expect(await tokenInstance.getVotes(deployer)).to.equal(PROPOSAL_THRESHOLD);
  });

  it("should allow to stake on new persona", async function () {
    const [validator, staker] = this.accounts;
    const { persona, demoToken } = await loadFixture(deployGenesisVirtual);

    const AgentToken = await ethers.getContractFactory("AgentToken");
    const tokenInstance = AgentToken.attach(persona.token);
    // Prepare tokens for staking
    // The validatory should have 100k sToken initially because of the initiation stake
    expect(await demoToken.balanceOf(validator)).to.be.equal(0n);
    expect(await demoToken.balanceOf(staker)).to.be.equal(0n);
    expect(await tokenInstance.balanceOf(validator)).to.be.equal(
      PROPOSAL_THRESHOLD
    );
    expect(await tokenInstance.balanceOf(staker)).to.be.equal(0n);
    expect(await tokenInstance.getVotes(validator)).to.be.equal(
      PROPOSAL_THRESHOLD
    );
    expect(await tokenInstance.getVotes(staker)).to.be.equal(0n);
    await demoToken.mint(staker, QUORUM);

    const stakeAmount = parseEther("100");
    await demoToken
      .connect(this.signers[1])
      .approve(persona.token, stakeAmount);
    await tokenInstance
      .connect(this.signers[1])
      .stake(stakeAmount, staker, validator);

    expect(await demoToken.balanceOf(validator)).to.be.equal(0n);
    expect(await demoToken.balanceOf(staker)).to.be.equal(QUORUM - stakeAmount);
    expect(await tokenInstance.balanceOf(validator)).to.be.equal(
      PROPOSAL_THRESHOLD
    );
    expect(await tokenInstance.balanceOf(staker)).to.be.equal(stakeAmount);
    expect(await tokenInstance.getVotes(validator)).to.be.equal(
      stakeAmount + PROPOSAL_THRESHOLD
    );
    expect(await tokenInstance.getVotes(staker)).to.be.equal(0n);
  });

  it("should not allow staking and delegate to non-validator", async function () {
    const [validator, staker] = this.accounts;
    const { persona, demoToken } = await loadFixture(deployGenesisVirtual);
    const AgentToken = await ethers.getContractFactory("AgentToken");
    const tokenInstance = AgentToken.attach(persona.token);

    await demoToken.mint(staker, QUORUM);
    const stakeAmount = parseEther("100");
    await demoToken
      .connect(this.signers[1])
      .approve(persona.token, stakeAmount);
    await expect(
      tokenInstance.connect(this.signers[1]).stake(stakeAmount, staker, staker)
    ).to.be.revertedWith("Delegatee is not a validator");
  });

  it("should be able to set new validator and receive delegation", async function () {
    const [validator, staker] = this.accounts;
    const { persona, demoToken, personaNft } = await loadFixture(
      deployGenesisVirtual
    );
    const AgentToken = await ethers.getContractFactory("AgentToken");
    const tokenInstance = AgentToken.attach(persona.token);

    await demoToken.mint(staker, QUORUM);
    const stakeAmount = parseEther("100");
    await demoToken
      .connect(this.signers[1])
      .approve(persona.token, stakeAmount);
    await expect(
      tokenInstance.connect(this.signers[1]).stake(stakeAmount, staker, staker)
    ).to.be.revertedWith("Delegatee is not a validator");

    await personaNft.addValidator(persona.virtualId, staker);

    await expect(
      tokenInstance.connect(this.signers[1]).stake(stakeAmount, staker, staker)
    ).to.not.be.revertedWith("Delegatee is not a validator");
  });

  it("should be able to set new validator and able to update score", async function () {
    const [validator, staker] = this.accounts;
    const { persona, demoToken, personaNft, personaFactory } =
      await loadFixture(deployGenesisVirtual);
    const AgentDAO = await ethers.getContractFactory("AgentDAO");
    const personaDAO = AgentDAO.attach(persona.dao);
    expect(
      await personaNft.validatorScore(persona.virtualId, validator)
    ).to.be.equal(0n);
    expect(await personaDAO.proposalCount()).to.be.equal(0n);

    // First proposal
    const tx = await personaDAO.propose(
      [validator],
      [0],
      ["0x"],
      "First proposal"
    );
    const filter = personaDAO.filters.ProposalCreated;
    const events = await personaDAO.queryFilter(filter, -1);
    const event = events[0];

    const { proposalId } = event.args;

    expect(await personaDAO.proposalCount()).to.be.equal(1n);
    expect(
      await personaNft.validatorScore(persona.virtualId, validator)
    ).to.be.equal(0n);

    // Deliberation does not count as vote
    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      3,
      "",
      MATURITY_SCORE
    );
    expect(
      await personaNft.validatorScore(persona.virtualId, validator)
    ).to.be.equal(0n);

    // Normal votes
    await personaDAO.castVoteWithReasonAndParams(
      proposalId,
      1,
      "",
      MATURITY_SCORE
    );
    expect(
      await personaNft.validatorScore(persona.virtualId, validator)
    ).to.be.equal(1n);
  });

  it("should be able to set new validator after created proposals and have correct score", async function () {
    const [validator, validator2] = this.accounts;
    const { persona, demoToken, personaNft, personaFactory } =
      await loadFixture(deployGenesisVirtual);
    const AgentDAO = await ethers.getContractFactory("AgentDAO");
    const personaDAO = AgentDAO.attach(persona.dao);

    // First proposal
    await personaDAO.propose([validator], [0], ["0x"], "First proposal");
    await personaDAO.propose([validator], [0], ["0x"], "Second proposal");

    const filter = personaDAO.filters.ProposalCreated;
    let events = await personaDAO.queryFilter(filter, -1);
    let event = events[0];
    const { proposalId: secondId } = event.args;
    await personaDAO.castVoteWithReasonAndParams(
      secondId,
      1,
      "",
      MATURITY_SCORE
    );

    // Validator #2 joins when we have 2 proposals
    await personaNft.addValidator(persona.virtualId, validator2);
    expect(
      await personaNft.validatorScore(persona.virtualId, validator)
    ).to.be.equal(1n);
    expect(
      await personaNft.validatorScore(persona.virtualId, validator2)
    ).to.be.equal(2n);
    expect(await personaDAO.proposalCount()).to.be.equal(2n);

    await personaDAO.propose([validator], [0], ["0x"], "Third proposal");
    events = await personaDAO.queryFilter(filter, -1);
    event = events[0];
    const { proposalId: thirdId } = event.args;
    await personaDAO
      .connect(this.signers[1])
      .castVoteWithReasonAndParams(thirdId, 1, "", MATURITY_SCORE);
    expect(
      await personaNft.validatorScore(persona.virtualId, validator)
    ).to.be.equal(1n);
    expect(
      await personaNft.validatorScore(persona.virtualId, validator2)
    ).to.be.equal(3n);
    expect(await personaDAO.proposalCount()).to.be.equal(3n);
  });
});
