/*
We will test the end-to-end implementation of a Virtual genesis initiation

1. Founder sends 100k $VIRTUAL tokens to factory propose an Agent
2. Founder executes the proposal
3. Factory generates following items:
    a. Token (For contribution)
    b. DAO
    c. Liquidity Pool
    d. Agent NFT
    e. Staking Token
4. Factory then mint 100k $Agent tokens
5. Factory adds 100k $VIRTUAL and $Agent tokens to the LP in exchange for $ALP
6. Factory stakes the $ALP and set recipient of stake tokens $sALP to founder
*/
const { parseEther, toBeHex, formatEther } = require("ethers/utils");
const { expect } = require("chai");
const {
  loadFixture,
  mine,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("AgentFactoryV2", function () {
  const PROPOSAL_THRESHOLD = parseEther("50000"); // 50k
  const MATURITY_SCORE = toBeHex(2000, 32); // 20%
  const IP_SHARE = 1000; // 10%

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
    const [deployer, ipVault, founder, poorMan, trader, treasury] =
      await ethers.getSigners();
    return { deployer, ipVault, founder, poorMan, trader, treasury };
  };

  async function deployBaseContracts() {
    const { deployer, ipVault, treasury } = await getAccounts();

    const virtualToken = await ethers.deployContract(
      "VirtualToken",
      [PROPOSAL_THRESHOLD, deployer.address],
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
    const minter = await upgrades.deployProxy(
      await ethers.getContractFactory("Minter"),
      [
        service.target,
        contribution.target,
        agentNft.target,
        process.env.IP_SHARES,
        process.env.IMPACT_MULTIPLIER,
        ipVault.address,
        agentFactory.target,
        deployer.address,
        process.env.MAX_IMPACT,
      ]
    );
    await minter.waitForDeployment();
    await agentFactory.setMaturityDuration(86400 * 365 * 10); // 10years
    await agentFactory.setUniswapRouter(process.env.UNISWAP_ROUTER);
    await agentFactory.setTokenAdmin(deployer.address);
    await agentFactory.setTokenSupplyParams(
      process.env.AGENT_TOKEN_LIMIT,
      process.env.AGENT_TOKEN_LP_SUPPLY,
      process.env.AGENT_TOKEN_VAULT_SUPPLY,
      process.env.AGENT_TOKEN_LIMIT,
      process.env.AGENT_TOKEN_LIMIT,
      process.env.BOT_PROTECTION,
      minter.target
    );

    await agentFactory.setTokenTaxParams(
      process.env.TAX,
      process.env.TAX,
      process.env.SWAP_THRESHOLD,
      treasury.address
    );

    return { virtualToken, agentFactory, agentNft, minter };
  }

  async function deployWithApplication() {
    const base = await deployBaseContracts();
    const { agentFactory, virtualToken } = base;
    const { founder } = await getAccounts();

    // Prepare tokens for proposal
    await virtualToken.mint(founder.address, PROPOSAL_THRESHOLD);
    await virtualToken
      .connect(founder)
      .approve(agentFactory.target, PROPOSAL_THRESHOLD);

    const tx = await agentFactory
      .connect(founder)
      .proposeAgent(
        genesisInput.name,
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
    return { applicationId: id, ...base };
  }

  async function deployWithAgent() {
    const base = await deployWithApplication();
    const { agentFactory, applicationId } = base;

    const { founder } = await getAccounts();
    await agentFactory
      .connect(founder)
      .executeApplication(applicationId, false);

    const factoryFilter = agentFactory.filters.NewPersona;
    const factoryEvents = await agentFactory.queryFilter(factoryFilter, -1);
    const factoryEvent = factoryEvents[0];

    const { virtualId, token, veToken, dao, tba, lp } = await factoryEvent.args;

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

  before(async function () {});

  it("should be able to propose a new agent", async function () {
    const { agentFactory, virtualToken } = await loadFixture(
      deployBaseContracts
    );

    const { founder } = await getAccounts();

    // Prepare tokens for proposal
    await virtualToken.mint(founder.address, PROPOSAL_THRESHOLD);
    await virtualToken
      .connect(founder)
      .approve(agentFactory.target, PROPOSAL_THRESHOLD);

    const tx = await agentFactory
      .connect(founder)
      .proposeAgent(
        genesisInput.name,
        genesisInput.symbol,
        genesisInput.tokenURI,
        genesisInput.cores,
        genesisInput.tbaSalt,
        genesisInput.tbaImplementation,
        genesisInput.daoVotingPeriod,
        genesisInput.daoThreshold
      );
    expect(tx).to.emit(agentFactory, "NewApplication");

    expect(await virtualToken.balanceOf(founder.address)).to.be.equal(0n);

    const filter = agentFactory.filters.NewApplication;
    const events = await agentFactory.queryFilter(filter, -1);
    const event = events[0];
    const { id } = event.args;
    expect(id).to.be.equal(1n);
  });

  it("should deny new Persona proposal when insufficient asset token", async function () {
    const { agentFactory } = await loadFixture(deployBaseContracts);
    const { poorMan } = await getAccounts();
    await expect(
      agentFactory
        .connect(poorMan)
        .proposeAgent(
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

  it("should allow application execution by proposer", async function () {
    const { applicationId, agentFactory, virtualToken } = await loadFixture(
      deployWithApplication
    );
    const { founder } = await getAccounts();
    await expect(
      agentFactory.connect(founder).executeApplication(applicationId, false)
    ).to.emit(agentFactory, "NewPersona");

    // Check genesis components
    // C1: Agent Token
    // C2: LP Pool + Initial liquidity
    // C3: Agent veToken
    // C4: Agent DAO
    // C5: Agent NFT
    // C6: TBA
    // C7: Stake liquidity token to get veToken
  });

  it("agent component C1: Agent Token", async function () {
    const { agent, minter } = await loadFixture(deployWithAgent);
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);
    expect(await agentToken.totalSupply()).to.be.equal(
      parseEther(process.env.AGENT_TOKEN_LIMIT)
    );
    expect(await agentToken.balanceOf(minter.target)).to.be.equal(
      parseEther(process.env.AGENT_TOKEN_VAULT_SUPPLY)
    );
  });

  it("agent component C2: LP Pool", async function () {
    const { agent, virtualToken } = await loadFixture(deployWithAgent);
    const lp = await ethers.getContractAt("IUniswapV2Pair", agent.lp);

    const t0 = await lp.token0();
    const t1 = await lp.token1();

    const addresses = [agent.token, virtualToken.target];
    expect(addresses).contain(t0);
    expect(addresses).contain(t1);

    // t0 and t1 will change position dynamically
    const reserves = await lp.getReserves();
    expect(reserves[0]).to.be.equal(
      t0 === agent.token
        ? parseEther(process.env.AGENT_TOKEN_LP_SUPPLY)
        : PROPOSAL_THRESHOLD
    );
    expect(reserves[1]).to.be.equal(
      t1 === agent.token
        ? parseEther(process.env.AGENT_TOKEN_LP_SUPPLY)
        : PROPOSAL_THRESHOLD
    );
  });

  it("agent component C3: Agent veToken", async function () {
    const { agent } = await loadFixture(deployWithAgent);
    const { founder } = await getAccounts();

    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    const balance = parseFloat(
      formatEther(await veToken.balanceOf(founder.address))
    ).toFixed(2);
    const lp = await ethers.getContractAt("ERC20", agent.lp);
    const votes = parseFloat(
      formatEther(await veToken.getVotes(founder.address))
    ).toFixed(2);
    expect(balance).to.equal("1581138.83");
    expect(votes).to.equal("1581138.83");
  });

  it("agent component C4: Agent DAO", async function () {
    const { agent } = await loadFixture(deployWithAgent);
    const dao = await ethers.getContractAt("AgentDAO", agent.dao);
    expect(await dao.token()).to.be.equal(agent.veToken);
    expect(await dao.name()).to.be.equal(genesisInput.daoName);
  });

  it("agent component C5: Agent NFT", async function () {
    const { agent, agentNft } = await loadFixture(deployWithAgent);
    const virtualInfo = await agentNft.virtualInfo(agent.virtualId);
    expect(virtualInfo.dao).to.equal(agent.dao);
    expect(virtualInfo.coreTypes).to.deep.equal(genesisInput.cores);
    const virtualLP = await agentNft.virtualLP(agent.virtualId);
    expect(virtualLP.pool).to.be.equal(agent.lp);
    expect(virtualLP.veToken).to.be.equal(agent.veToken);

    expect(await agentNft.tokenURI(agent.virtualId)).to.equal(
      genesisInput.tokenURI
    );

    expect(virtualInfo.tba).to.equal(agent.tba);
  });

  it("agent component C6: TBA", async function () {
    // TBA means whoever owns the NFT can move the account assets
    // We will test by minting VIRTUAL to the TBA and then use the treasury account to transfer it out
    const { agent, agentNft, virtualToken } = await loadFixture(
      deployWithAgent
    );
    const { deployer, poorMan } = await getAccounts();

    const amount = parseEther("500");
    await virtualToken.mint(agent.tba, amount);
    expect(await virtualToken.balanceOf(agent.tba)).to.be.equal(amount);
    expect(await virtualToken.balanceOf(poorMan.address)).to.be.equal(0n);

    // Now move it
    const data = virtualToken.interface.encodeFunctionData("transfer", [
      poorMan.address,
      amount,
    ]);

    const tba = await ethers.getContractAt("IExecutionInterface", agent.tba);

    await tba.execute(virtualToken.target, 0, data, 0);
    const balance = await virtualToken.balanceOf(poorMan.address);
    expect(balance).to.be.equal(amount);
  });

  it("agent component C7: Mint initial Agent tokens", async function () {
    // TBA means whoever owns the NFT can move the account assets
    // We will test by minting VIRTUAL to the TBA and then use the treasury account to transfer it out
    const { agent, agentNft, virtualToken } = await loadFixture(
      deployWithAgent
    );
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);
    expect(await agentToken.totalSupply()).to.be.equal(
      parseEther(process.env.AGENT_TOKEN_LIMIT)
    );
    expect(await agentToken.balanceOf(agent.lp)).to.be.equal(
      parseEther(process.env.AGENT_TOKEN_LP_SUPPLY)
    );
  });

  it("should allow staking on public agent", async function () {
    // Need to provide LP first
    const { agent, agentNft, virtualToken } = await loadFixture(
      deployWithAgent
    );
    const { trader, poorMan, founder } = await getAccounts();
    const router = await ethers.getContractAt(
      "IUniswapV2Router02",
      process.env.UNISWAP_ROUTER
    );
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);

    // Buy tokens
    const amountToBuy = parseEther("10000000");
    const capital = parseEther("200000000");
    await virtualToken.mint(trader.address, capital);
    await virtualToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, capital);

    await router
      .connect(trader)
      .swapTokensForExactTokens(
        amountToBuy,
        capital,
        [virtualToken.target, agent.token],
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 600000)
      );
    ////
    // Start providing liquidity
    const lpToken = await ethers.getContractAt("ERC20", agent.lp);
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await veToken.connect(founder).setCanStake(true);
    expect(await lpToken.balanceOf(trader.address)).to.be.equal(0n);
    await agentToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, parseEther("10000000"));
    await virtualToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, parseEther("10000000"));

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
        Math.floor(new Date().getTime() / 1000 + 6000)
      );
    /////////////////
    // Staking, and able to delegate to anyone
    await lpToken.connect(trader).approve(agent.veToken, parseEther("10"));
    await expect(
      veToken
        .connect(trader)
        .stake(parseEther("10"), trader.address, poorMan.address)
    ).to.be.not.reverted;
  });

  it("should deny staking on private agent", async function () {
    // Need to provide LP first
    const { agent, agentNft, virtualToken } = await loadFixture(
      deployWithAgent
    );
    const { trader, poorMan } = await getAccounts();
    const router = await ethers.getContractAt(
      "IUniswapV2Router02",
      process.env.UNISWAP_ROUTER
    );
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);

    // Buy tokens
    const amountToBuy = parseEther("90");
    const capital = parseEther("200");
    await virtualToken.mint(trader.address, capital);
    await virtualToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, capital);

    await router
      .connect(trader)
      .swapTokensForExactTokens(
        amountToBuy,
        capital,
        [virtualToken.target, agent.token],
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 6000)
      );
    ////
    // Start providing liquidity
    const lpToken = await ethers.getContractAt("ERC20", agent.lp);
    expect(await lpToken.balanceOf(trader.address)).to.be.equal(0n);
    await agentToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, amountToBuy);
    await virtualToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, capital);
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
        Math.floor(new Date().getTime() / 1000 + 6000)
      );
    /////////////////
    // Staking
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await expect(
      veToken
        .connect(trader)
        .stake(parseEther("10"), trader.address, poorMan.address)
    ).to.be.revertedWith("Staking is disabled for private agent");
  });

  it("should be able to set new validator and able to update score", async function () {
    // Need to provide LP first
    const { agent, agentNft } = await loadFixture(deployWithAgent);
    const agentDAO = await ethers.getContractAt("AgentDAO", agent.dao);
    const { founder, poorMan } = await getAccounts();
    expect(await agentDAO.proposalCount()).to.be.equal(0n);

    // First proposal
    const tx = await agentDAO.propose(
      [founder.address],
      [0],
      ["0x"],
      "First proposal"
    );
    const filter = agentDAO.filters.ProposalCreated;
    const events = await agentDAO.queryFilter(filter, -1);
    const event = events[0];

    const { proposalId } = event.args;

    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await veToken.connect(founder).delegate(poorMan.address);

    expect(await agentDAO.proposalCount()).to.be.equal(1n);
    const blockNumber = await ethers.provider.getBlockNumber();

    expect(
      await agentDAO.getPastScore(poorMan.address, blockNumber - 1)
    ).to.be.equal(0n);

    // Deliberation does not count as vote
    await agentDAO
      .connect(poorMan)
      .castVoteWithReasonAndParams(proposalId, 3, "", MATURITY_SCORE);
    expect(
      await agentNft.validatorScore(agent.virtualId, poorMan.address)
    ).to.be.equal(0n);

    // Normal votes
    await agentDAO
      .connect(poorMan)
      .castVoteWithReasonAndParams(proposalId, 1, "", MATURITY_SCORE);
    expect(
      await agentNft.validatorScore(agent.virtualId, poorMan.address)
    ).to.be.equal(1n);
  });

  it("should be able to set new validator after created proposals and have correct score", async function () {
    const { agent, agentNft, virtualToken } = await loadFixture(
      deployWithAgent
    );
    const { trader, poorMan, founder } = await getAccounts();
    const router = await ethers.getContractAt(
      "IUniswapV2Router02",
      process.env.UNISWAP_ROUTER
    );
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);

    // Get trader to stake on poorMan so that we have 2 validators
    // Buy tokens
    const amountToBuy = parseEther("1000000");
    const capital = parseEther("200000");
    await virtualToken.mint(trader.address, capital);
    await virtualToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, capital);

    await router
      .connect(trader)
      .swapTokensForExactTokens(
        amountToBuy,
        capital,
        [virtualToken.target, agent.token],
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 6000)
      );
    ////
    // Start providing liquidity
    const lpToken = await ethers.getContractAt("ERC20", agent.lp);
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await veToken.connect(founder).setCanStake(true);
    expect(await lpToken.balanceOf(trader.address)).to.be.equal(0n);
    await agentToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, amountToBuy);
    await virtualToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, capital);
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
        Math.floor(new Date().getTime() / 1000 + 6000)
      );

    const agentDAO = await ethers.getContractAt("AgentDAO", agent.dao);
    // First proposal
    await agentDAO.propose([founder.address], [0], ["0x"], "First proposal");
    await agentDAO.propose([founder.address], [0], ["0x"], "Second proposal");

    const filter = agentDAO.filters.ProposalCreated;
    let events = await agentDAO.queryFilter(filter, -1);
    let event = events[0];
    const { proposalId: secondId } = event.args;
    await agentDAO
      .connect(founder)
      .castVoteWithReasonAndParams(secondId, 1, "", MATURITY_SCORE);

    const initialScore = await agentNft.validatorScore(
      agent.virtualId,
      poorMan.address
    );
    expect(initialScore).to.be.equal(0n);

    // Stake will automatically adds the validator
    await lpToken.connect(trader).approve(agent.veToken, parseEther("10"));
    await veToken
      .connect(trader)
      .stake(parseEther("10"), trader.address, poorMan.address);

    const newScore = await agentNft.validatorScore(
      agent.virtualId,
      poorMan.address
    );
    expect(newScore).to.be.equal(2n);
  });

  it("should allow withdrawal", async function () {
    const { applicationId, agentFactory, virtualToken } = await loadFixture(
      deployWithApplication
    );
    const { founder } = await getAccounts();
    await agentFactory.connect(founder).withdraw(applicationId);
    expect(await virtualToken.balanceOf(founder.address)).to.be.equal(
      PROPOSAL_THRESHOLD
    );
  });

  it("should lock initial LP", async function () {
    const { agent, agentNft, virtualToken } = await loadFixture(
      deployWithAgent
    );
    // Founder unable to withdraw LP initially
    const { founder } = await getAccounts();
    const agentVeToken = await ethers.getContractAt(
      "AgentVeToken",
      agent.veToken
    );
    await expect(
      agentVeToken.connect(founder).withdraw(parseEther("10"))
    ).to.be.revertedWith("Not mature yet");
  });

  it("should allow manual unlock staked LP", async function () {
    const { agent, agentNft, virtualToken } = await loadFixture(
      deployWithAgent
    );
    const { founder, deployer } = await getAccounts();
    // Assign admin role
    await agentNft.grantRole(await agentNft.ADMIN_ROLE(), deployer);
    const agentVeToken = await ethers.getContractAt(
      "AgentVeToken",
      agent.veToken
    );
    // Unable to withdraw staked LP initially
    await expect(agentVeToken.connect(founder).withdraw(parseEther("10"))).to.be
      .reverted;

    // Unlock
    await expect(agentVeToken.setMatureAt(0)).to.not.be.reverted;
    await agentNft.setBlacklist(agent.virtualId, true);
    expect(await agentNft.isBlacklisted(agent.virtualId)).to.be.equal(true);

    // Able to withdraw after unlock
    await expect(agentVeToken.connect(founder).withdraw(parseEther("10"))).to
      .not.be.reverted;
  });

  it("should not allow staking on blacklisted agent", async function () {
    const { agent, agentNft, virtualToken } = await loadFixture(
      deployWithAgent
    );
    const { founder, deployer, trader } = await getAccounts();
    // Assign admin role
    await agentNft.grantRole(await agentNft.ADMIN_ROLE(), deployer);
    const agentToken = await ethers.getContractAt("AgentToken", agent.token);
    const agentVeToken = await ethers.getContractAt(
      "AgentVeToken",
      agent.veToken
    );
    // Unable to withdraw staked LP initially
    await expect(agentVeToken.connect(founder).withdraw(parseEther("10"))).to.be
      .reverted;

    // Unlock
    await agentVeToken.setMatureAt(0);
    await agentNft.setBlacklist(agent.virtualId, true);
    await agentNft.isBlacklisted(agent.virtualId);

    // Unable to stake on blacklisted agent
    // Get trader to stake on poorMan so that we have 2 validators
    // Buy tokens
    const router = await ethers.getContractAt(
      "IUniswapV2Router02",
      process.env.UNISWAP_ROUTER
    );
    const amountToBuy = parseEther("1000000");
    const capital = parseEther("2000000");
    await virtualToken.mint(trader.address, capital);
    await virtualToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, capital);

    await router
      .connect(trader)
      .swapTokensForExactTokens(
        amountToBuy,
        capital,
        [virtualToken.target, agent.token],
        trader.address,
        Math.floor(new Date().getTime() / 1000 + 6000)
      );
    ////
    // Start providing liquidity
    const lpToken = await ethers.getContractAt("ERC20", agent.lp);
    const veToken = await ethers.getContractAt("AgentVeToken", agent.veToken);
    await veToken.connect(founder).setCanStake(true);
    expect(await lpToken.balanceOf(trader.address)).to.be.equal(0n);
    await agentToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, amountToBuy);
    await virtualToken
      .connect(trader)
      .approve(process.env.UNISWAP_ROUTER, capital);
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
        Math.floor(new Date().getTime() / 1000 + 6000)
      );
    ///
    await lpToken.connect(trader).approve(agent.veToken, parseEther("10"));
    await expect(
      veToken
        .connect(trader)
        .stake(parseEther("10"), trader.address, trader.address)
    ).to.be.revertedWith("Agent Blacklisted");
  });
});
