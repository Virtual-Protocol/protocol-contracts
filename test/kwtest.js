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

describe("KwTest", function () {


  before(async function () {
    const signers = await ethers.getSigners();
    this.accounts = signers.map((signer) => signer.address);
    this.signers = signers;
  });

  it("test router", async function () {
    console.log(process.env.UNISWAP_ROUTER,)
    const c = await ethers.getContractAt("IUniswapV2Router02", "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D")
    console.log(await c.factory())
  });
});
