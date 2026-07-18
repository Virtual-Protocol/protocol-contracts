
> 🌱 **$GENESIS — where every agent begins**
>
> Before staking, before governance, before the first contribution — there's Genesis. $GENESIS marks the origin point: the token tied to an agent's very first on-chain breath, from application to instantiation.
>
> No agent exists without a Genesis. This is the root of it all. 🌐

**CA:** `0xaa5837e6244c57c93b69aa205322f586474cf739`

# Example: Launching $ARIA —  Example Token

> ⚠️ **Disclaimer**: `$ARIA` is a **completely fictional token**, created solely for demonstration/educational purposes to show how the Virtual Protocol ecosystem works.

---

## Narrative context

A team of developers wants to launch a new on-chain AI agent called **ARIA** (symbol: `$ARIA`), using the Virtual Protocol infrastructure as an architectural reference.

### Test actors
- **John** — founder, applies to create ARIA
- **Giulia** — staker, locks VIRTUAL to gain voting power
- **Validator1** — validator who approves technical contributions
- **Contributor1** — developer who proposes an improvement to ARIA's model

---

## Step-by-step
### Step 0 — The contract

CA: 0x6591f5122e6389616e858406681cb1e94b1349ad

### Step 1 — Application (Genesis)
John sends `100 VIRTUAL` as a deposit and calls `AgentFactory.proposeAgent()` to register ARIA, specifying name, symbol (`$ARIA`), and the core's initial parameters.

**Check**: the contract transfers the 100 VIRTUAL to `AgentFactory` and creates a pending entry.

### Step 2 — Community vote
John proposes on `VirtualGenesisDAO` the action `AgentFactory.executeApplication(applicationId)`. Giulia and 3 other wallets vote `FOR` until the quorum of **10,000 votes** is reached.

**Check**: the proposal becomes executable before the standard expiry, thanks to early execution once quorum is reached.

### Step 3 — Execution and instantiation
Anyone executes the proposal. The contract:
1. Clones `AgentToken` → creates `$ARIA`
2. Clones `AgentDAO` → creates ARIA's specific DAO
3. Mints an `AgentNft` representing the agent
4. John stakes his VIRTUAL and receives `$ARIA` in return
5. A **TBA (Token Bound Account)** is created and linked to the AgentNft

**Check**: `AgentNft.ownerOf(tokenId)` returns the correct address, `$ARIA.totalSupply()` > 0.

### Step 4 — Giulia's staking
Giulia calls `AgentToken.stake(validatorAddress)`, depositing sVIRTUAL and delegating her vote to **Validator1**.

**Check**: she receives `$ARIA` proportionally, and her voting power is correctly delegated.

### Step 5 — Contribution proposal
Contributor1 proposes an improvement to ARIA's dataset on `AgentDAO` (action = `ServiceNft.mint`). After approval, they mint a `ContributionNft`, verifying that the caller is indeed the proposer.

### Step 6 — Core upgrade
Validator1 votes on the proposal on `AgentDAO`. Once executed:
- A `ServiceNft` is minted
- ARIA's **maturity score** is updated
- The **core service id** is incremented

**Check**: `AgentDAO.getMaturityScore()` has changed compared to the initial value.

### Step 7 — Reward distribution
The backend calls `AgentReward.distributeRewards()` with a simulated amount (e.g. `500 VIRTUAL`), split among protocol, stakers (Giulia), validators (Validator1), and contributors (Contributor1).

### Step 8 — Claim
Giulia calls `AgentReward.claimAllRewards()` and verifies that her VIRTUAL balance has increased by the expected amount.

---

## Main functions involved

| Contract | Function | Description |
|---|---|---|
| AgentFactory | `proposeAgent()` | Registers a new application for the agent (ARIA) |
| AgentFactory | `executeApplication(id)` | Executes instantiation after the vote |
| AgentToken | `stake(validator)` | Stakes VIRTUAL/sVIRTUAL, delegates vote |
| AgentToken | `withdraw()` | Withdraws the stake |
| AgentDAO | proposal + `ServiceNft.mint` | Contribution proposal and mint |
| AgentReward | `distributeRewards()` | Periodic reward distribution |
| AgentReward | `claimAllRewards()` | Claims accrued rewards |

---

## Network: Robinhood Chain (mainnet)

> This example specifically targets **Robinhood Chain mainnet**, not a generic EVM testnet. Use the details below when configuring Hardhat, wallets, or deploy scripts.

| Property | Value |
|---|---|
| Network name | Robinhood Chain |
| Chain ID | `4663` |
| Native gas token | ETH |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Block explorer (Blockscout) | `https://robinhoodchain.blockscout.com` |
| Verifier URL (for contract verification) | `https://robinhoodchain.blockscout.com/api/` |
| Underlying stack | Arbitrum Orbit L2, settling to Ethereum with blob data availability |

Notes:
- Robinhood Chain is fully permissionless — anyone can deploy a contract, provided the deployer address has ETH bridged to the chain to cover gas.
- Contract source/ABI verification and lookup through Blockscout's `v2` API now requires a Blockscout **Pro API key** (as of July 1, 2026); the public explorer UI itself still works for browsing without a key.
- Gas is sub-cent, but not free for contract deployment (the "gas-free for 90 days" promo covers trading actions only, not developer transactions).

---

## Example contract ($ARIA — fictional)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
// ⚠️ FICTIONAL EXAMPLE CONTRACT — FOR DEMONSTRATION PURPOSES ONLY
// $ARIA is not a real token and is not affiliated with Virtual Protocol
// or Robinhood. Reconstructed to illustrate a tax/liquidity ERC20
// pattern (Ownable2Step + blacklist + buy/sell tax) for testing on
// Robinhood Chain mainnet (chain ID 4663).
// ============================================================

CA: 0x6591f5122e6389616e858406681cb1e94b1349ad


interface ITaxAccountingAdapter {
    function computeTax(uint256 amount, bool isBuy) external view returns (uint256);
}

contract AriaToken {
    // ---- Metadata ----
    string public name = "Aria Token";
    string public symbol = "ARIA";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    // ---- Ownership (Ownable2Step pattern) ----
    address public owner;
    address public pendingOwner;

    // ---- Balances / allowances ----
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // ---- Blacklist ----
    mapping(address => bool) public blacklists;

    // ---- Liquidity pools ----
    mapping(address => bool) public liquidityPools;
    address public uniswapV2Pair;
    address public pairToken;

    // ---- Valid callers (helper contracts allowed to trigger internal ops) ----
    mapping(address => bool) public validCallers;

    // ---- Tax configuration ----
    uint256 public projectBuyTaxBasisPoints;
    uint256 public projectSellTaxBasisPoints;
    uint256 public totalBuyTaxBasisPoints;
    uint256 public totalSellTaxBasisPoints;
    uint256 public swapThresholdBasisPoints;
    uint256 public projectTaxPendingSwap;
    address public projectTaxRecipient;
    address public taxAccountingAdapter;

    // ---- Misc ----
    address public vault;
    uint256 public fundedDate;
    uint256 public botProtectionDurationInSeconds;
    bool private _initialized;

    // ---- Events ----
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event BlacklistUpdated(address indexed account, bool status);
    event LiquidityPoolUpdated(address indexed pool, bool status);
    event ValidCallerUpdated(address indexed caller, bool status);
    event ProjectTaxRatesUpdated(uint256 buyBps, uint256 sellBps);
    event ProjectTaxRecipientUpdated(address indexed recipient);
    event SwapThresholdUpdated(uint256 bps);
    event TaxAccountingAdapterUpdated(address indexed adapter);
    event TaxTokensDistributed(uint256 amount);
    event LiquidityAdded(uint256 tokenAmount, uint256 pairAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier notBlacklisted(address account) {
        require(!blacklists[account], "Address blacklisted");
        _;
    }

    // ---- Initialization (proxy-friendly pattern; overloaded per the ABI list) ----
    function initialize(
        address _owner,
        address _projectTaxRecipient,
        address _vault
    ) external {
        require(!_initialized, "Already initialized");
        _initialized = true;
        owner = _owner;
        projectTaxRecipient = _projectTaxRecipient;
        vault = _vault;
        fundedDate = block.timestamp;
        botProtectionDurationInSeconds = 60;
        emit OwnershipTransferred(address(0), _owner);
    }

    function initialize() external view returns (bool) {
        return _initialized;
    }

    // ---- Ownable2Step ----
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    // ---- ERC20 standard ----
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address _owner, address spender) external view returns (uint256) {
        return _allowances[_owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        _allowances[msg.sender][spender] += addedValue;
        emit Approval(msg.sender, spender, _allowances[msg.sender][spender]);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 current = _allowances[msg.sender][spender];
        require(current >= subtractedValue, "Allowance below zero");
        _allowances[msg.sender][spender] = current - subtractedValue;
        emit Approval(msg.sender, spender, _allowances[msg.sender][spender]);
        return true;
    }

    function transfer(address to, uint256 amount)
        external
        notBlacklisted(msg.sender)
        notBlacklisted(to)
        returns (bool)
    {
        _transferWithTax(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        notBlacklisted(from)
        notBlacklisted(to)
        returns (bool)
    {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "Allowance exceeded");
        _allowances[from][msg.sender] = currentAllowance - amount;
        _transferWithTax(from, to, amount);
        return true;
    }

    function _transferWithTax(address from, address to, uint256 amount) internal {
        require(_balances[from] >= amount, "Insufficient balance");

        uint256 taxBps = 0;
        if (liquidityPools[from]) {
            taxBps = totalBuyTaxBasisPoints; // buying from a pool
        } else if (liquidityPools[to]) {
            taxBps = totalSellTaxBasisPoints; // selling into a pool
        }

        uint256 taxAmount = (amount * taxBps) / 10_000;
        uint256 netAmount = amount - taxAmount;

        _balances[from] -= amount;
        _balances[to] += netAmount;
        emit Transfer(from, to, netAmount);

        if (taxAmount > 0) {
            _balances[address(this)] += taxAmount;
            projectTaxPendingSwap += taxAmount;
            emit Transfer(from, address(this), taxAmount);
        }
    }

    function burn(uint256 amount) external {
        require(_balances[msg.sender] >= amount, "Insufficient balance");
        _balances[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function burnFrom(address account, uint256 amount) external {
        uint256 currentAllowance = _allowances[account][msg.sender];
        require(currentAllowance >= amount, "Allowance exceeded");
        require(_balances[account] >= amount, "Insufficient balance");
        _allowances[account][msg.sender] = currentAllowance - amount;
        _balances[account] -= amount;
        totalSupply -= amount;
        emit Transfer(account, address(0), amount);
    }

    // ---- Blacklist management ----
    function addBlacklistAddress(address account) external onlyOwner {
        blacklists[account] = true;
        emit BlacklistUpdated(account, true);
    }

    function removeBlacklistAddress(address account) external onlyOwner {
        blacklists[account] = false;
        emit BlacklistUpdated(account, false);
    }

    // ---- Liquidity pool management ----
    function addLiquidityPool(address pool) external onlyOwner {
        liquidityPools[pool] = true;
        emit LiquidityPoolUpdated(pool, true);
    }

    function removeLiquidityPool(address pool) external onlyOwner {
        liquidityPools[pool] = false;
        emit LiquidityPoolUpdated(pool, false);
    }

    function isLiquidityPool(address pool) external view returns (bool) {
        return liquidityPools[pool];
    }

    function addInitialLiquidity(uint256 tokenAmount, uint256 pairAmount) external onlyOwner {
        require(_balances[owner] >= tokenAmount, "Insufficient balance");
        _balances[owner] -= tokenAmount;
        _balances[uniswapV2Pair] += tokenAmount;
        emit LiquidityAdded(tokenAmount, pairAmount);
    }

    // ---- Valid callers ----
    function addValidCaller(address caller) external onlyOwner {
        validCallers[caller] = true;
        emit ValidCallerUpdated(caller, true);
    }

    function removeValidCaller(address caller) external onlyOwner {
        validCallers[caller] = false;
        emit ValidCallerUpdated(caller, false);
    }

    function isValidCaller(address caller) external view returns (bool) {
        return validCallers[caller];
    }

    // ---- Tax configuration ----
    function setProjectTaxRates(uint256 buyBps, uint256 sellBps) external onlyOwner {
        require(buyBps <= 2500 && sellBps <= 2500, "Tax too high"); // 25% cap, example only
        projectBuyTaxBasisPoints = buyBps;
        projectSellTaxBasisPoints = sellBps;
        totalBuyTaxBasisPoints = buyBps;
        totalSellTaxBasisPoints = sellBps;
        emit ProjectTaxRatesUpdated(buyBps, sellBps);
    }

    function setProjectTaxRecipient(address recipient) external onlyOwner {
        projectTaxRecipient = recipient;
        emit ProjectTaxRecipientUpdated(recipient);
    }

    function setSwapThresholdBasisPoints(uint256 bps) external onlyOwner {
        swapThresholdBasisPoints = bps;
        emit SwapThresholdUpdated(bps);
    }

    function setTaxAccountingAdapter(address adapter) external onlyOwner {
        taxAccountingAdapter = adapter;
        emit TaxAccountingAdapterUpdated(adapter);
    }

    function distributeTaxTokens() external {
        require(validCallers[msg.sender] || msg.sender == owner, "Not authorized");
        uint256 amount = projectTaxPendingSwap;
        require(amount > 0, "Nothing to distribute");
        projectTaxPendingSwap = 0;
        _balances[address(this)] -= amount;
        _balances[projectTaxRecipient] += amount;
        emit Transfer(address(this), projectTaxRecipient, amount);
        emit TaxTokensDistributed(amount);
    }

    // ---- Withdraw helpers ----
    function withdrawERC20(address token, uint256 amount) external onlyOwner {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", owner, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Withdraw failed");
    }

    function withdrawETH(uint256 amount) external onlyOwner {
        (bool success, ) = owner.call{value: amount}("");
        require(success, "ETH withdraw failed");
    }

    // ---- Receive ETH ----
    receive() external payable {}
}
```

---

## Notes for running the test

- Target network for this example: **Robinhood Chain mainnet** (chain ID `4663`), using the RPC/explorer details in the section above.
- No real funds should be involved in a documentation/test context: treat all amounts (`100 VIRTUAL`, `500 VIRTUAL`, etc.) from the narrative as simulated, even though the underlying network is a real mainnet.
- Since Robinhood Chain is a real mainnet, any actual deployment does cost real gas (in ETH) — budget accordingly if you go beyond a local Hardhat fork.
- This file can be converted into a Mocha/Hardhat test suite (`describe("ARIA lifecycle")`) following the step order above, run first against a local fork of Robinhood Chain before ever touching mainnet directly.
