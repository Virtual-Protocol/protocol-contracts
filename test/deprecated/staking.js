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
  return factory.interface.encodeFunctionData("executeApplication", [
    proposalId,
  ]);
};

describe("Staking", function () {
  async function deployBaseContracts() {
    const [deployer] = await ethers.getSigners();
    const token = await ethers.deployContract(
      "VirtualToken",
      [parseEther("100"), deployer.address],
      {}
    );
    await token.waitForDeployment();

    const stakingArgs = require("../scripts/arguments/stakingArguments");
    stakingArgs[2] = token.target;

    const staking = await ethers.deployContract(
      "TimeLockStaking",
      stakingArgs,
      {}
    );
    await staking.waitForDeployment();

    return { token, staking };
  }

  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("should give correct bonus for 6months", async function () {
    const { token, staking } = await loadFixture(deployBaseContracts);

    const [account1, account2] = this.accounts;
    await token.approve(staking.target, parseEther("100"));
    const oneYear = 86400 * 365;

    await staking.deposit(parseEther("100"), Math.floor(oneYear / 2), account2);
    const balance = await staking.balanceOf(account2);
    expect(balance).to.equal(parseEther("150"));
  });

  it("should give correct bonus for year 1", async function () {
    const { token, staking } = await loadFixture(deployBaseContracts);

    const [account1, account2] = this.accounts;
    await token.approve(staking.target, parseEther("100"));
    const oneYear = 86400 * 365;

    await staking.deposit(parseEther("100"), oneYear, account2);
    const balance = await staking.balanceOf(account2);
    expect(balance).to.equal(parseEther("200"));
  });

  it("should give correct bonus for year 2", async function () {
    const { token, staking } = await loadFixture(deployBaseContracts);

    const [account1, account2] = this.accounts;
    await token.approve(staking.target, parseEther("100"));
    const oneYear = 86400 * 365;

    await staking.deposit(parseEther("100"), oneYear * 2, account2);
    const balance = await staking.balanceOf(account2);
    expect(balance).to.equal(parseEther("400"));
  });

  it("should give correct bonus for year 3", async function () {
    const { token, staking } = await loadFixture(deployBaseContracts);

    const [account1, account2] = this.accounts;
    await token.approve(staking.target, parseEther("100"));
    const oneYear = 86400 * 365;

    await staking.deposit(parseEther("100"), oneYear * 3, account2);
    const balance = await staking.balanceOf(account2);
    expect(balance).to.equal(parseEther("800"));
  });

  it("should give correct bonus for year 3.5", async function () {
    const { token, staking } = await loadFixture(deployBaseContracts);

    const [account1, account2] = this.accounts;
    await token.approve(staking.target, parseEther("100"));
    const oneYear = 86400 * 365;

    await staking.deposit(parseEther("100"), Math.floor(oneYear * 3.5), account2);
    const balance = await staking.balanceOf(account2);
    expect(balance).to.equal(parseEther("1200"));
  });

  it("should give correct bonus for year 4", async function () {
    const { token, staking } = await loadFixture(deployBaseContracts);

    const [account1, account2] = this.accounts;
    await token.approve(staking.target, parseEther("100"));
    const oneYear = 86400 * 365;

    await staking.deposit(parseEther("100"), oneYear * 4, account2);
    const balance = await staking.balanceOf(account2);
    expect(balance).to.equal(parseEther("1600"));
  });

  it("should allow adjustDeposits", async function() {
    const { token, staking } = await loadFixture(deployBaseContracts);
    const [deployer, admin] = this.signers
    await expect(staking.adjustAdminUnlock()).to.be.reverted;
    await expect(staking.connect(admin).adjustAdminUnlock()).to.be.reverted;

    await staking.grantRole(await staking.GOV_ROLE(), admin.address);
    await expect(staking.connect(admin).adjustAdminUnlock()).to.be.fulfilled;
  })
});
