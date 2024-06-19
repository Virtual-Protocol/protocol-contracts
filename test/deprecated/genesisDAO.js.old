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

describe("GenesisDAO", function () {
  const PROPOSAL_THRESHOLD = parseEther("100000000");
  const QUORUM = parseEther("10000");
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

    const dao = await ethers.deployContract(
      "VirtualGenesisDAO",
      [veToken.target, 0, 100, 0],
      {}
    );
    await dao.waitForDeployment();
    await dao.grantRole("0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63", deployer.address); // EXECUTOR_ROLE

    const demoToken = await ethers.deployContract(
      "BMWToken",
      [deployer.address],
      {}
    );
    await demoToken.waitForDeployment();

    return { veToken, dao, demoToken };
  }

  async function createProposalFixture() {
    const [deployer, voter, recipient] = await ethers.getSigners();
    const { veToken, dao, demoToken } = await loadFixture(deployGovFixture);
    // Proposal creator will need 100m tokens
    await veToken.oracleTransfer(
      [ethers.ZeroAddress],
      [deployer.address],
      [PROPOSAL_THRESHOLD]
    );
    await veToken.delegate(deployer.address);

    await veToken.oracleTransfer(
      [ethers.ZeroAddress],
      [voter.address],
      [QUORUM]
    );
    await veToken.connect(voter).delegate(voter.address);

    const tx = await dao.propose(
      [demoToken.target],
      [0],
      [getMintCallData(demoToken, recipient.address, parseEther("100"))],
      "Give grant"
    );

    const filter = dao.filters.ProposalCreated;
    const events = await dao.queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];
    return { veToken, dao, demoToken, proposalId };
  }

  it("should allow early execution", async function () {
    const { veToken, dao, demoToken, proposalId } = await loadFixture(
      createProposalFixture
    );
    const tx = await dao.connect(this.signers[1]).castVote(proposalId, 1);
    // Ensure proposal is still in ACTIVE state
    expect(await dao.state(proposalId)).to.be.equal(1n);

    // // Try to execute proposal
    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("0")
    );

    await expect(dao.earlyExecute(proposalId)).to.be.fulfilled;

    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("100")
    );
  });

  it("should not allow double executions", async function () {
    const { veToken, dao, demoToken, proposalId } = await loadFixture(
      createProposalFixture
    );
    const tx = await dao.connect(this.signers[1]).castVote(proposalId, 1);
    // Ensure proposal is still in ACTIVE state
    expect(await dao.state(proposalId)).to.be.equal(1n);

    // Try to execute proposal
    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("0")
    );

    await expect(dao.earlyExecute(proposalId)).to.be.fulfilled;

    await mine(10);

    await expect(dao.earlyExecute(proposalId)).to.be.reverted;
  });

  it("should not allow double executions", async function () {
    const { veToken, dao, demoToken, proposalId } = await loadFixture(
      createProposalFixture
    );
    const tx = await dao.connect(this.signers[1]).castVote(proposalId, 1);
    // Ensure proposal is still in ACTIVE state
    expect(await dao.state(proposalId)).to.be.equal(1n);

    // Try to execute proposal
    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("0")
    );

    await expect(dao.earlyExecute(proposalId)).to.be.fulfilled;

    await mine(100);

    await expect(dao.execute(proposalId)).to.be.reverted;

    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("100")
    );
  });

  it("should allow normal execution", async function () {
    const { veToken, dao, demoToken, proposalId } = await loadFixture(
      createProposalFixture
    );
    const tx = await dao.connect(this.signers[1]).castVote(proposalId, 1);
    // Ensure proposal is still in ACTIVE state
    expect(await dao.state(proposalId)).to.be.equal(1n);

    // Try to execute proposal
    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("0")
    );
    
    await mine(90);
    await expect(dao.execute(proposalId)).to.be.reverted;
    await mine(10);
    await expect(dao.execute(proposalId)).to.be.fulfilled;

    expect(await demoToken.balanceOf(this.accounts[2])).to.equal(
      parseEther("100")
    );
  });
});
