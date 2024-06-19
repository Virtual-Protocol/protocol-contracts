/*
Test delegation with history
*/
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Elo Rating", function () {
  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("should calculate correct elo", async function () {
    const [deployer] = await ethers.getSigners();
    const Contract = await ethers.getContractFactory("EloCalculator");
    const calculator = await upgrades.deployProxy(Contract, [deployer.address]);

    const res = await calculator.battleElo(100, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(res).to.be.equal(315n);
  });
});
