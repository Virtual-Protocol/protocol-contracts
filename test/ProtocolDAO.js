const { parseEther } = require("ethers/utils");
const { keccak256 } = require("ethers/crypto");
const { expect } = require("chai");
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const getMintCallData = (token, to, amount) => {
  return token.interface.encodeFunctionData("mint", [to, amount]);
};

describe("ProtocolDAO", function () {
  const PROPOSAL_THRESHOLD = parseEther("100000000");
  const QUORUM = parseEther("50000000");
  const VOTING_PERIOD = parseInt(process.env.PROTOCOL_VOTING_PERIOD);

  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  async function deployGovFixture() {
    const [deployer] = await ethers.getSigners();
    const veToken = await ethers.deployContract(
      "veVirtualToken",
      [deployer.address],
      {}
    );
    await veToken.waitForDeployment();

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

    const demoToken = await ethers.deployContract(
      "BMWToken",
      [deployer.address],
      {}
    );
    await demoToken.waitForDeployment();

    return { veToken, protocolDAO, demoToken };
  }

  async function createProposalFixture() {
    const [deployer, voter, recipient] = await ethers.getSigners();
    const { veToken, protocolDAO, demoToken } = await loadFixture(
      deployGovFixture
    );
    // Proposal creator will need 100m tokens
    await veToken.oracleTransfer(
      [ethers.ZeroAddress],
      [deployer.address],
      [PROPOSAL_THRESHOLD]
    );
    await veToken.delegate(deployer.address);

    // Voter will need 1m tokens to reach quorum
    await veToken.oracleTransfer(
      [ethers.ZeroAddress],
      [voter.address],
      [QUORUM]
    );
    await veToken.connect(voter).delegate(voter.address);

    const tx = await protocolDAO.propose(
      [demoToken.target],
      [0],
      [getMintCallData(demoToken, recipient.address, parseEther("100"))],
      "Give grant"
    );

    const filter = protocolDAO.filters.ProposalCreated;
    const events = await protocolDAO.queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];
    return { veToken, protocolDAO, demoToken, proposalId };
  }

  it("should deny create proposal when voting token under proposal threshold", async function () {
    const { protocolDAO, demoToken } = await loadFixture(deployGovFixture);
    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("0")
    );
    await expect(
      protocolDAO.propose(
        [demoToken.target],
        [0],
        [getMintCallData(demoToken, this.accounts[2], parseEther("100"))],
        "Give grant"
      )
    ).to.be.reverted;
    expect((await demoToken.balanceOf(this.accounts[2])).toString()).to.equal(
      "0"
    );
  });

  it("should allow create proposal when voting token >= proposal threshold", async function () {
    const { protocolDAO, veToken, demoToken } = await loadFixture(
      deployGovFixture
    );
    await veToken.oracleTransfer(
      [ethers.ZeroAddress],
      [this.accounts[0]],
      [PROPOSAL_THRESHOLD]
    );
    await veToken.delegate(this.accounts[0]);

    const proposalId = await protocolDAO.propose(
      [demoToken.target],
      [0],
      [getMintCallData(demoToken, this.accounts[2], parseEther("100"))],
      "Give grant"
    );
    expect(proposalId.toString()).to.emit(protocolDAO, "ProposalCreated");
  });

  it("should deny proposal execution when quorum not reached", async function () {
    const { protocolDAO, demoToken, proposalId } = await loadFixture(
      createProposalFixture
    );

    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("0")
    );
    await expect(protocolDAO.execute(proposalId)).to.be.reverted;
  });

  it("should deny proposal execution when quorum reached but proposal still going", async function () {
    const { protocolDAO, demoToken, proposalId } = await loadFixture(
      createProposalFixture
    );

    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("0")
    );
    // Vote
    const tx = await protocolDAO
      .connect(this.signers[1])
      .castVote(proposalId, 1);

    await expect(protocolDAO.execute(proposalId)).to.be.reverted;
  });

  it("should allow proposal execution when quorum reached and voting period ended", async function () {
    const { protocolDAO, demoToken, proposalId } = await loadFixture(
      createProposalFixture
    );

    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("0")
    );
    // Vote
    const tx = await protocolDAO
      .connect(this.signers[1])
      .castVote(proposalId, 1);

    await mine(VOTING_PERIOD);

    await expect(protocolDAO.execute(proposalId)).to.emit(
      protocolDAO,
      "ProposalExecuted"
    );
    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("100")
    );
  });

  it("should be able to cast vote by sig", async function () {
    const { protocolDAO, veToken, proposalId } = await loadFixture(
      createProposalFixture
    );

    const [deployer, voter, recipient, relayer] = this.signers;
    const blockNumber = (await ethers.provider.getBlockNumber()) - 1;

    const voterVotes = await protocolDAO.getVotes(voter, blockNumber);
    expect(voterVotes).to.equal(QUORUM);

    const relayerVotes = await protocolDAO.getVotes(relayer, blockNumber);
    expect(relayerVotes).to.equal(0);

    const currentVotes = await protocolDAO.proposalVotes(proposalId);
    expect(currentVotes).to.be.deep.equal([0n, 0n, 0n]);

    // Get ether balances
    const voterEtherBalance = await ethers.provider.getBalance(voter);
    expect(voterEtherBalance).to.be.lt(10000000000000000000000n);
    const relayerEtherBalance = await ethers.provider.getBalance(relayer);
    expect(relayerEtherBalance).to.be.lessThan(10000000000000000000000n);

    // Voter sign vote

    // Sign a signature to be used in castVoteBySig
    const domainData = await protocolDAO.eip712Domain();
    const domain = {
      name: domainData.name,
      version: domainData.version,
      chainId: domainData.chainId,
      verifyingContract: domainData.verifyingContract,
    };
    const nonce = await protocolDAO.nonces(voter);

    const sig = await voter.signTypedData(
      domain,
      {
        ExtendedBallot: [
          { name: "proposalId", type: "uint256" },
          { name: "support", type: "uint8" },
          { name: "voter", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "reason", type: "string" },
          { name: "params", type: "bytes" },
        ],
      },
      {
        proposalId,
        support: 1,
        voter: voter.address,
        nonce,
        reason: "Hello",
        params: ethers.ZeroAddress,
      }
    );

    const tx = await protocolDAO.castVoteWithReasonAndParamsBySig(
      proposalId,
      1,
      voter.address,
      "Hello",
      ethers.ZeroAddress,
      sig
    );

    const latestVotes = await protocolDAO.proposalVotes(proposalId);
    expect(latestVotes).to.be.deep.equal([0n, QUORUM, 0n]);
  });
});
