const { expect } = require("chai");
const { toBeHex } = require("ethers/utils");
const abi = ethers.AbiCoder.defaultAbiCoder();
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { parseEther, formatEther } = require("ethers");

const getMintServiceCalldata = async (serviceNft, virtualId, hash) => {
  return serviceNft.interface.encodeFunctionData("mint", [virtualId, hash]);
};

function getDescHash(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

describe("RewardsV2", function () {
  const PROPOSAL_THRESHOLD = parseEther("100000"); //100k
  const TREASURY_AMOUNT = parseEther("1000000"); //1M
  const MATURITY_SCORE = toBeHex(2000, 32); // 20%
  const IP_SHARE = 1000; // 10%

  const TOKEN_URI = "http://jessica";

  const genesisInput = {
    name: "Jessica",
    symbol: "JSC",
    tokenURI: "http://jessica",
    daoName: "Jessica DAO",
    cores: [0, 1, 2],
    tbaSalt:
      "0xa7647ac9429fdce477ebd9a95510385b756c757c26149e740abbab0ad1be2f16",
    tbaImplementation: process.env.TBA_IMPLEMENTATION,
    daoVotingPeriod: 600,
    daoThreshold: 1000000000000000000000n,
  };

  const getAccounts = async () => {
    const [
      deployer,
      ipVault,
      founder,
      contributor1,
      contributor2,
      validator1,
      validator2,
      treasury,
      virtualTreasury,
      trader,
    ] = await ethers.getSigners();
    return {
      deployer,
      ipVault,
      founder,
      contributor1,
      contributor2,
      validator1,
      validator2,
      treasury,
      virtualTreasury,
      trader,
    };
  };

  async function deployBaseContracts() {
    const { deployer, ipVault, treasury, virtualTreasury } =
      await getAccounts();

    const virtualToken = await ethers.deployContract(
      "VirtualToken",
      [TREASURY_AMOUNT, deployer.address],
      {}
    );
    await virtualToken.waitForDeployment();

    const AgentNft = await ethers.getContractFactory("AgentNftV2");
    const agentNft = await upgrades.deployProxy(AgentNft, [deployer.address]);

    const contribution = await upgrades.deployProxy(
      await ethers.getContractFactory("ContributionNft"),
      [agentNft.target],
      {}
    );

    const service = await upgrades.deployProxy(
      await ethers.getContractFactory("ServiceNft"),
      [agentNft.target, contribution.target, process.env.DATASET_SHARES],
      {}
    );

    await agentNft.setContributionService(contribution.target, service.target);

    // Implementation contracts
    const agentToken = await ethers.deployContract("AgentToken");
    await agentToken.waitForDeployment();
    const agentDAO = await ethers.deployContract("AgentDAO");
    await agentDAO.waitForDeployment();
    const agentVeToken = await ethers.deployContract("AgentVeToken");
    await agentVeToken.waitForDeployment();

    const agentFactory = await upgrades.deployProxy(
      await ethers.getContractFactory("AgentFactoryV2"),
      [
        agentToken.target,
        agentVeToken.target,
        agentDAO.target,
        process.env.TBA_REGISTRY,
        virtualToken.target,
        agentNft.target,
        PROPOSAL_THRESHOLD,
        deployer.address,
      ]
    );
    await agentFactory.waitForDeployment();
    await agentNft.grantRole(await agentNft.MINTER_ROLE(), agentFactory.target);
    const minter = await ethers.deployContract("Minter", [
      service.target,
      contribution.target,
      agentNft.target,
      process.env.IP_SHARES,
      process.env.DATA_SHARES,
      process.env.IMPACT_MULTIPLIER,
      ipVault.address,
      agentFactory.target,
      deployer.address,
    ]);
    await minter.waitForDeployment();
    await agentFactory.setMinter(minter.target);
    await agentFactory.setMaturityDuration(86400 * 365 * 10); // 10years
    await agentFactory.setUniswapRouter(process.env.UNISWAP_ROUTER);
    await agentFactory.setTokenAdmin(deployer.address);
    await agentFactory.setTokenSupplyParams(
      process.env.AGENT_TOKEN_LIMIT,
      process.env.AGENT_TOKEN_LIMIT,
      process.env.BOT_PROTECTION
    );
    await agentFactory.setTokenTaxParams(
      process.env.TAX,
      process.env.TAX,
      process.env.SWAP_THRESHOLD,
      treasury.address
    );
    await agentFactory.grantRole(
      await agentFactory.WITHDRAW_ROLE(),
      deployer.address
    );

    const rewards = await upgrades.deployProxy(
      await ethers.getContractFactory("AgentRewardV2"),
      [
        virtualToken.target,
        agentNft.target,
        {
          protocolShares: process.env.PROTOCOL_SHARES,
          stakerShares: process.env.STAKER_SHARES,
        },
      ],
      {}
    );
    await rewards.waitForDeployment();
    await rewards.grantRole(await rewards.GOV_ROLE(), deployer.address);

    return {
      virtualToken,
      agentFactory,
      agentNft,
      serviceNft: service,
      contributionNft: contribution,
      minter,
      rewards,
    };
  }

  async function createApplication(base, founder, idx) {
    const { agentFactory, virtualToken } = base;

    // Prepare tokens for proposal
    await virtualToken.mint(founder.address, PROPOSAL_THRESHOLD);
    await virtualToken
      .connect(founder)
      .approve(agentFactory.target, PROPOSAL_THRESHOLD);
    const tx = await agentFactory
      .connect(founder)
      .proposeAgent(
        genesisInput.name + "-" + idx,
        genesisInput.symbol,
        genesisInput.tokenURI,
        genesisInput.cores,
        genesisInput.tbaSalt,
        genesisInput.tbaImplementation,
        genesisInput.daoVotingPeriod,
        genesisInput.daoThreshold
      );

    const filter = agentFactory.filters.NewApplication;
    const events = await agentFactory.queryFilter(filter, -1);
    const event = events[0];
    const { id } = event.args;
    return id;
  }

  async function deployWithApplication() {
    const base = await deployBaseContracts();

    const { founder } = await getAccounts();
    const id = await createApplication(base, founder, 0);
    return { applicationId: id, ...base };
  }

  async function createAgent(base, applicationId) {
    const { agentFactory } = base;
    await agentFactory.executeApplication(applicationId, true);

    const factoryFilter = agentFactory.filters.NewPersona;
    const factoryEvents = await agentFactory.queryFilter(factoryFilter, -1);
    const factoryEvent = factoryEvents[0];
    return factoryEvent.args;
  }

  async function deployWithAgent() {
    const base = await deployWithApplication();
    const { applicationId } = base;

    const { founder } = await getAccounts();

    const { virtualId, token, veToken, dao, tba, lp } = await createAgent(
      base,
      applicationId
    );

    const veTokenContract = await ethers.getContractAt("AgentVeToken", veToken);
    await veTokenContract.connect(founder).delegate(founder.address); // We want to vote instead of letting default delegatee to vote

    return {
      ...base,
      agent: {
        virtualId,
        token,
        veToken,
        dao,
        tba,
        lp,
      },
    };
  }

  async function createContribution(
    virtualId,
    coreId,
    maturity,
    parentId,
    isModel,
    datasetId,
    desc,
    base,
    account,
    voters
  ) {
    const { serviceNft, contributionNft, minter, agentNft } = base;
    const daoAddr = (await agentNft.virtualInfo(virtualId)).dao;
    const veAddr = (await agentNft.virtualLP(virtualId)).veToken;
    const agentDAO = await ethers.getContractAt("AgentDAO", daoAddr);
    const veToken = await ethers.getContractAt("AgentVeToken", veAddr);

    const descHash = getDescHash(desc);

    const mintCalldata = await getMintServiceCalldata(
      serviceNft,
      virtualId,
      descHash
    );

    await agentDAO.propose([serviceNft.target], [0], [mintCalldata], desc);
    const filter = agentDAO.filters.ProposalCreated;
    const events = await agentDAO.queryFilter(filter, -1);
    const event = events[0];
    const proposalId = event.args[0];

    await contributionNft.mint(
      account,
      virtualId,
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

    for (const voter of voters) {
      await agentDAO
        .connect(voter)
        .castVoteWithReasonAndParams(proposalId, 1, "lfg", voteParams);
    }

    await mine(600);

    await agentDAO.execute(proposalId);
    await minter.mint(proposalId);

    return proposalId;
  }

  before(async function () {});

  it("should mint agent token for successful contribution", async function () {
    const base = await loadFixture(deployWithAgent);
    const { contributor1, founder } = await getAccounts();
    const maturity = 55;
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );
    const balance1 = await agentToken.balanceOf(contributor1.address);
    expect(balance1).to.equal(0n);
    await createContribution(
      1,
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [founder]
    );
    const balance2 = await agentToken.balanceOf(contributor1.address);
    expect(balance2).to.equal(parseEther(maturity.toString()));
  });

  it("should mint agent token for IP owner on successful contribution", async function () {
    const base = await loadFixture(deployWithAgent);
    const { ipVault, contributor1 } = await getAccounts();
    const maturity = 55;
    const agentToken = await ethers.getContractAt(
      "AgentToken",
      base.agent.token
    );
    const balance1 = await agentToken.balanceOf(ipVault.address);
    expect(balance1).to.equal(0n);
    await createContribution(
      1,
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [founder]
    );

    const balance2 = await agentToken.balanceOf(ipVault.address);
    expect(balance2).to.equal(parseEther((maturity * 0.1).toString()));
  });

  it("should be able to distribute protocol emission for single virtual", async function () {
    const base = await loadFixture(deployWithAgent);
    const { rewards, virtualToken, agent } = base;
    const { contributor1, founder, validator1 } = await getAccounts();
    const maturity = 100;
    // Founder should delegate to another person for us to test the different set of rewards
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await veToken.connect(founder).delegate(validator1.address);
    await mine(1);

    await createContribution(
      1,
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [validator1]
    );
    const rewardSize = 100000;
    await virtualToken.approve(
      rewards.target,
      parseEther(rewardSize.toString())
    );
    await expect(
      rewards.distributeRewards(parseEther(rewardSize.toString()), [1], false)
    ).to.not.be.reverted;
  });

  it("should be able to claim correct amount for staker and validator (no protocol share)", async function () {
    const base = await loadFixture(deployWithAgent);
    const { rewards, virtualToken, agent } = base;
    const { contributor1, founder, validator1 } = await getAccounts();
    const maturity = 100;
    // Founder should delegate to another person for us to test the different set of rewards
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await veToken.connect(founder).delegate(validator1.address);
    await mine(1);

    await createContribution(
      1,
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [validator1]
    );
    const rewardSize = 100000;
    await virtualToken.approve(
      rewards.target,
      parseEther(rewardSize.toString())
    );
    await rewards.distributeRewards(
      parseEther(rewardSize.toString()),
      [1],
      false
    );
    await mine(1);
    // Founder has 90% of the total rewards
    const founderSClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(founder.address, [1])
    );
    const founderVClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(founder.address, [1])
    );
    expect(founderSClaimable).to.equal("90000.0");
    expect(founderVClaimable).to.equal("0.0");

    // Validator has 10% of the total rewards
    const validatorSClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(validator1.address, [1])
    );
    const validatorVClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(
        validator1.address,
        [1],
        100
      )
    );
    expect(validatorSClaimable).to.equal("0.0");
    expect(validatorVClaimable).to.equal("10000.0");

    // Nothing for contributor
    const conributorSClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(
        contributor1.address,
        [1],
        100
      )
    );
    const contributorVClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(
        contributor1.address,
        [1],
        100
      )
    );
    expect(conributorSClaimable).to.equal("0.0");
    expect(contributorVClaimable).to.equal("0.0");
  });

  it("should be able to claim correct amount for staker and validator (has protocol share)", async function () {
    const base = await loadFixture(deployWithAgent);
    const { rewards, virtualToken, agent } = base;
    const { contributor1, founder, validator1 } = await getAccounts();
    const maturity = 100;
    // Founder should delegate to another person for us to test the different set of rewards
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await veToken.connect(founder).delegate(validator1.address);
    await mine(1);

    await createContribution(
      1,
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [validator1]
    );
    const rewardSize = 100000;
    await virtualToken.approve(
      rewards.target,
      parseEther(rewardSize.toString())
    );
    await rewards.distributeRewards(
      parseEther(rewardSize.toString()),
      [1],
      true
    );
    await mine(1);
    // Protocol shares = 10% = 10k
    // Founder has 90% of the remaining rewards = 90% x 90k
    const founderSClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(founder.address, [1])
    );
    const founderVClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(founder.address, [1])
    );
    expect(founderSClaimable).to.equal("81000.0");
    expect(founderVClaimable).to.equal("0.0");

    // Validator has 10% of the total rewards
    const validatorSClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(validator1.address, [1])
    );
    const validatorVClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(
        validator1.address,
        [1],
        100
      )
    );
    expect(validatorSClaimable).to.equal("0.0");
    expect(validatorVClaimable).to.equal("9000.0");

    // Nothing for contributor
    const conributorSClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(
        contributor1.address,
        [1],
        100
      )
    );
    const contributorVClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(
        contributor1.address,
        [1],
        100
      )
    );
    expect(conributorSClaimable).to.equal("0.0");
    expect(contributorVClaimable).to.equal("0.0");
  });

  it("should be able to distribute protocol emission for multiple virtuals with arbitrary LP values", async function () {
    const base = await loadFixture(deployWithAgent);
    const { agent, agentNft, virtualToken, rewards } = base;
    const {
      contributor1,
      contributor2,
      validator1,
      validator2,
      founder,
      trader,
    } = await getAccounts();
    // Create 3 more virtuals to sum up to 4
    const app2 = await createApplication(base, founder, 1);
    const agent2 = await createAgent(base, app2);
    const app3 = await createApplication(base, founder, 2);
    const agent3 = await createAgent(base, app3);
    const app4 = await createApplication(base, founder, 3);
    const agent4 = await createAgent(base, app4);

    // Create contributions for all 4 virtuals
    for (let i = 1; i <= 4; i++) {
      let veToken = await ethers.getContractAt(
        "AgentVeToken",
        (
          await agentNft.virtualLP(i)
        ).veToken
      );

      await veToken.connect(founder).delegate(validator1.address);
      await createContribution(
        i,
        0,
        100,
        0,
        true,
        0,
        `Test ${i}`,
        base,
        contributor1.address,
        [validator1]
      );
    }

    const router = await ethers.getContractAt(
      "IUniswapV2Router02",
      process.env.UNISWAP_ROUTER
    );
    // Trade on different LP
    await virtualToken.mint(trader.address, parseEther("300"));
    await virtualToken
      .connect(trader)
      .approve(router.target, parseEther("300"));
    for (let i of [1, 3, 4]) {
      const agentTokenAddr = (await agentNft.virtualInfo(i)).token;
      const amountToBuy = parseEther((20 * i).toString());
      const capital = parseEther("100");
      await router
        .connect(trader)
        .swapTokensForExactTokens(
          amountToBuy,
          capital,
          [virtualToken.target, agentTokenAddr],
          trader.address,
          Math.floor(new Date().getTime() / 1000 + 6000000)
        );
      await mine(1);
    }

    // Distribute rewards
    // Expectations:
    // virtual 4>3>1
    // virtual 2 = 0
    const rewardSize = 300000;
    await virtualToken.approve(
      rewards.target,
      parseEther(rewardSize.toString())
    );
    await rewards.distributeRewards(
      parseEther(rewardSize.toString()),
      [1, 3, 4],
      false
    );
    await mine(1);
    const rewards1 = await rewards.getTotalClaimableStakerRewards(
      founder.address,
      [1]
    );
    const rewards2 = await rewards.getTotalClaimableStakerRewards(
      founder.address,
      [2]
    );
    const rewards3 = await rewards.getTotalClaimableStakerRewards(
      founder.address,
      [3]
    );
    const rewards4 = await rewards.getTotalClaimableStakerRewards(
      founder.address,
      [4]
    );
    expect(rewards4).to.be.greaterThan(rewards3);
    expect(rewards3).to.be.greaterThan(rewards1);
    expect(rewards2).to.be.equal(0n);
  });

  it("should be able to distribute rewards based on validator uptime (validator2 is down)", async function () {
    const base = await loadFixture(deployWithAgent);
    const { rewards, virtualToken, agent, agentNft } = base;
    const { contributor1, founder, validator1, trader, validator2 } =
      await getAccounts();
    const maturity = 100;
    // Founder should delegate to another person for us to test the different set of rewards
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await veToken.connect(founder).delegate(validator1.address);
    await mine(1);

    const router = await ethers.getContractAt(
      "IUniswapV2Router02",
      process.env.UNISWAP_ROUTER
    );

    await virtualToken.mint(trader.address, parseEther("300"));
    await virtualToken
      .connect(trader)
      .approve(router.target, parseEther("300"));
    const agentTokenAddr = (await agentNft.virtualInfo(1)).token;
    const amountToBuy = parseEther("100");
    const capital = parseEther("150");
    await router
      .connect(trader)
      .swapTokensForExactTokens(
        amountToBuy,
        capital,
        [virtualToken.target, agentTokenAddr],
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 6000000)
      );
    await mine(1);
    await veToken.connect(trader).delegate(validator2.address);
    await mine(1);

    // Validator 1 voting
    await createContribution(
      1,
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [validator1]
    );
    const rewardSize = 100000;
    await virtualToken.approve(
      rewards.target,
      parseEther(rewardSize.toString())
    );
    await rewards.distributeRewards(
      parseEther(rewardSize.toString()),
      [1],
      false
    );
    await mine(1);

    // Staker1 + Validator 1
    const staker1SClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(founder.address, [1])
    );
    const staker1VClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(founder.address, [1])
    );
    expect(staker1SClaimable).to.equal("90000.0");
    expect(staker1VClaimable).to.equal("0.0");

    const validator1SClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(validator1.address, [1])
    );
    const validator1VClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(validator1.address, [1])
    );
    expect(validator1SClaimable).to.equal("0.0");
    expect(validator1VClaimable).to.equal("10000.0");

    // Staker2 + Validator 2
    const staker2SClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(trader.address, [1])
    );
    const staker2VClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(trader.address, [1])
    );
    expect(staker2SClaimable).to.equal("0.0");
    expect(staker2VClaimable).to.equal("0.0");

    const validator2SClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(trader.address, [1])
    );
    const validator2VClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(trader.address, [1])
    );
    expect(validator2SClaimable).to.equal("0.0");
    expect(validator2VClaimable).to.equal("0.0");
  });

  it("should be able to distribute rewards based on validator uptime (validator2 is up)", async function () {
    const base = await loadFixture(deployWithAgent);
    const { rewards, virtualToken, agent, agentNft } = base;
    const { contributor1, founder, validator1, trader, validator2 } =
      await getAccounts();
    const maturity = 100;

    const agentToken = await ethers.getContractAt("AgentToken", agent.token);
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    const lp = await ethers.getContractAt("IERC20", agent.lp);
    await veToken.connect(founder).delegate(validator1.address);
    await mine(1);

    const router = await ethers.getContractAt(
      "IUniswapV2Router02",
      process.env.UNISWAP_ROUTER
    );

    await virtualToken.mint(trader.address, parseEther("100000"));
    await virtualToken
      .connect(trader)
      .approve(router.target, parseEther("100000"));
    const agentTokenAddr = (await agentNft.virtualInfo(1)).token;
    const amountToBuy = parseEther("40000");
    const capital = parseEther("100000");
    await router
      .connect(trader)
      .swapTokensForExactTokens(
        amountToBuy,
        capital,
        [virtualToken.target, agentTokenAddr],
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 6000000)
      );
    await mine(1);
    await agentToken
      .connect(trader)
      .approve(router.target, await agentToken.balanceOf(trader.address));
    await router
      .connect(trader)
      .addLiquidity(
        agentToken.target,
        virtualToken.target,
        await agentToken.balanceOf(trader.address),
        await virtualToken.balanceOf(trader.address),
        0,
        0,
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 600000)
      );
    await mine(1);
    await lp.connect(trader).approve(veToken.target, await lp.balanceOf(trader.address));
    await veToken
      .connect(trader)
      .stake(await lp.balanceOf(trader.address), trader.address, validator2.address);
    await mine(1);

    // Validator 1 voting
    await createContribution(
      1,
      0,
      maturity,
      0,
      true,
      0,
      "Test",
      base,
      contributor1.address,
      [validator1, validator2]
    );
    const rewardSize = 100000;
    await virtualToken.approve(
      rewards.target,
      parseEther(rewardSize.toString())
    );
    await rewards.distributeRewards(
      parseEther(rewardSize.toString()),
      [1],
      false
    );
    await mine(1);

    // Staker1 + Validator 1
    const staker1SClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(founder.address, [1])
    );
    const staker1VClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(founder.address, [1])
    );
    expect(parseFloat(staker1SClaimable)).to.be.greaterThan(70000);
    expect(staker1VClaimable).to.equal("0.0");

    const validator1SClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(validator1.address, [1])
    );
    const validator1VClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(validator1.address, [1])
    );
    expect(validator1SClaimable).to.equal("0.0");
    expect(parseFloat(validator1VClaimable)).to.be.greaterThan(7000);

    // Staker2 + Validator 2
    const staker2SClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(trader.address, [1])
    );
    const staker2VClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(trader.address, [1])
    );
    expect(parseFloat(staker2SClaimable)).to.be.greaterThan(10000);
    expect(staker2VClaimable).to.equal("0.0");

    const validator2SClaimable = formatEther(
      await rewards.getTotalClaimableStakerRewards(validator2.address, [1])
    );
    const validator2VClaimable = formatEther(
      await rewards.getTotalClaimableValidatorRewards(validator2.address, [1])
    );
    expect(validator2SClaimable).to.equal("0.0");
    expect(parseFloat(validator2VClaimable)).to.be.greaterThan(1000);
  });
});
