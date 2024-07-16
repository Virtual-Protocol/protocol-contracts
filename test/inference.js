/*
Test delegation with history
*/
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = require("ethers/utils");
const { keccak256 } = require("ethers/crypto");

describe("AgentInference", function () {
  let token;
  let contract;
  const MIN_FEES = parseEther("1");
  const VIP_FEES = parseEther("3");

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;

    token = await ethers.deployContract("VirtualToken", [
      parseEther("1000000000"),
      this.accounts[0],
    ]);

    const Contract = await ethers.getContractFactory("AgentInference");
    contract = await upgrades.deployProxy(Contract, [
      this.accounts[0],
      token.target,
      MIN_FEES,
    ]);
  });

  it("should transfer token to provider", async function () {
    const [treasury, provider, user] = this.signers;
    // Prepare funds for user
    await token.transfer(user.address, parseEther("1000"));
    expect(await token.balanceOf(user.address)).to.be.equal(parseEther("1000"));
    expect(await token.balanceOf(provider.address)).to.be.equal(
      parseEther("0")
    );

    await token
      .connect(user)
      .approve(contract.target, parseEther("1000000000"));

    // Start inference
    const hash = keccak256(ethers.toUtf8Bytes("hello world!"));
    await expect(
      contract.connect(user).prompt(hash, provider.address)
    ).to.be.emit(contract, "Prompt");
    expect(await token.balanceOf(user.address)).to.be.equal(parseEther("999"));
    expect(await token.balanceOf(provider.address)).to.be.equal(
      parseEther("1")
    );
  });

  it("should be able to customize fees per provider", async function () {
    const [treasury, provider, user] = this.signers;
    // Prepare funds for user
    await token.transfer(user.address, parseEther("1000"));
    expect(await token.balanceOf(user.address)).to.be.equal(parseEther("1000"));
    expect(await token.balanceOf(provider.address)).to.be.equal(
      parseEther("0")
    );

    await token
      .connect(user)
      .approve(contract.target, parseEther("1000000000"));

    await expect(contract.setFees(provider.address, VIP_FEES)).to.be.emit(
      contract,
      "FeesUpdated"
    );

    // Start inference
    const hash = keccak256(ethers.toUtf8Bytes("hello world!"));
    await expect(
      contract.connect(user).prompt(hash, provider.address)
    ).to.be.emit(contract, "Prompt");
    expect(await token.balanceOf(user.address)).to.be.equal(parseEther("997"));
    expect(await token.balanceOf(provider.address)).to.be.equal(
      parseEther("3")
    );
  });
});
