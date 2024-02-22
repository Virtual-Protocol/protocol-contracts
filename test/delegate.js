/*
Test delegation with history
*/
const { parseEther, toBeHex } = require("ethers/utils");
const { expect } = require("chai");
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const getExecuteCallData = (factory, proposalId) => {
  return factory.interface.encodeFunctionData("executeApplication", [proposalId]);
};

describe("Delegation", function () {
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

    const personaNft = await ethers.deployContract("AgentNft", [
      deployer.address,
    ]);
    await personaNft.waitForDeployment();

    const contribution = await ethers.deployContract(
      "ContributionNft",
      [personaNft.target],
      {}
    );

    const service = await ethers.deployContract(
      "ServiceNft",
      [personaNft.target, contribution.target],
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

    const personaFactory = await ethers.deployContract("AgentFactory");
    await personaFactory.initialize(
      personaToken.target,
      personaDAO.target,
      tba.target,
      demoToken.target,
      personaNft.target,
      protocolDAO.target,
      parseEther("100000"),
      5
    );

    await personaNft.grantRole(
      await personaNft.MINTER_ROLE(),
      personaFactory.target
    );

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

    const personaTokenContract = await ethers.getContractAt(
      "AgentToken",
      persona.token
    );
    return { personaTokenContract };
  }

  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("should be able to retrieve past delegates", async function () {
    const { personaTokenContract } = await loadFixture(deployBaseContracts);

    const [account1, account2, account3] = this.accounts;
    await personaTokenContract.delegate(account1);
    mine(1);
    const block1 = await ethers.provider.getBlockNumber();
    expect(await personaTokenContract.delegates(account1)).to.equal(account1);

    await personaTokenContract.delegate(account2);
    mine(1);
    const block2 = await ethers.provider.getBlockNumber();

    await personaTokenContract.delegate(account3);
    mine(1);
    const block3 = await ethers.provider.getBlockNumber();

    expect(
      await personaTokenContract.getPastDelegates(account1, block2)
    ).to.equal(account2);
    expect(
      await personaTokenContract.getPastDelegates(account1, block3)
    ).to.equal(account3);
    expect(
      await personaTokenContract.getPastDelegates(account1, block1)
    ).to.equal(account1);
    expect(await personaTokenContract.delegates(account1)).to.equal(account3);
  });

  it("should be able to retrieve past delegates when there are more than 5 checkpoints", async function () {
    const { personaTokenContract } = await loadFixture(deployBaseContracts);
    const blockNumber = await ethers.provider.getBlockNumber();

    const [account1, account2, account3] = this.accounts;
    for (let i = 0; i < 8; i++) {
      await personaTokenContract.delegate(this.accounts[i]);
    }
    await mine(1);
    for (let i = 0; i < 8; i++) {
      expect(await personaTokenContract.getPastDelegates(account1, blockNumber + i + 1)).to.equal(
        this.accounts[i]
      );
    }
  });
});
