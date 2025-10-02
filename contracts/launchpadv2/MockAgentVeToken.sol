// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../virtualPersona/IAgentVeToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";

contract MockAgentVeToken is IAgentVeToken, IVotes {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    address public founder;
    address public assetToken;
    uint256 public matureAt;
    address public agentNft;
    bool public canStake;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;

    // Voting power tracking
    mapping(address => uint256) private _votingPower;
    mapping(address => uint256) private _delegatedVotingPower;
    mapping(address => address) private _delegates;

    // Historical data
    mapping(address => mapping(uint256 => uint256)) private _checkpoints;
    mapping(address => uint256) private _numCheckpoints;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );

    constructor() {
        // Mock implementation
    }

    function initialize(
        string memory _name,
        string memory _symbol,
        address _founder,
        address _assetToken,
        uint256 _matureAt,
        address _agentNft,
        bool _canStake
    ) external override {
        name = _name;
        symbol = _symbol;
        founder = _founder;
        assetToken = _assetToken;
        matureAt = _matureAt;
        agentNft = _agentNft;
        canStake = _canStake;

        // Mint some initial tokens to founder
        _mint(_founder, 1000000 * 10 ** 18);
    }

    function stake(
        uint256 amount,
        address receiver,
        address delegatee
    ) external override {
        require(canStake, "Staking not allowed");
        require(amount > 0, "Amount must be greater than 0");

        // Transfer tokens from caller to this contract
        IERC20(assetToken).transferFrom(msg.sender, address(this), amount);

        // Mint veTokens to receiver
        _mint(receiver, amount);

        // Delegate if delegatee is provided
        if (delegatee != address(0)) {
            _delegate(receiver, delegatee);
        }
    }

    function withdraw(uint256 amount) external override {
        require(amount > 0, "Amount must be greater than 0");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");

        // Burn veTokens
        _burn(msg.sender, amount);

        // Transfer back asset tokens
        IERC20(assetToken).transfer(msg.sender, amount);
    }

    function getPastDelegates(
        address account,
        uint256 timepoint
    ) external view override returns (address) {
        require(timepoint < block.timestamp, "Future timepoint");
        return _delegates[account];
    }

    function getPastBalanceOf(
        address account,
        uint256 timepoint
    ) external view override returns (uint256) {
        require(timepoint < block.timestamp, "Future timepoint");
        return balanceOf[account];
    }

    // IVotes interface implementation
    function getVotes(
        address account
    ) external view override returns (uint256) {
        return _votingPower[account];
    }

    function getPastVotes(
        address account,
        uint256 timepoint
    ) external view override returns (uint256) {
        require(timepoint < block.timestamp, "Future timepoint");

        uint256 nCheckpoints = _numCheckpoints[account];
        if (nCheckpoints == 0) {
            return 0;
        }

        // Check the most recent checkpoint
        if (_checkpoints[account][nCheckpoints - 1] <= timepoint) {
            return _votingPower[account];
        }

        // Binary search
        uint256 low = 0;
        uint256 high = nCheckpoints - 1;

        while (high > low) {
            uint256 mid = (high + low + 1) / 2;
            if (_checkpoints[account][mid] <= timepoint) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return _votingPower[account];
    }

    function delegates(address account) external view returns (address) {
        return _delegates[account];
    }

    function getPastTotalSupply(
        uint256 timepoint
    ) external view returns (uint256) {
        require(timepoint < block.timestamp, "Future timepoint");
        return totalSupply;
    }

    function delegate(address delegatee) external override {
        _delegate(msg.sender, delegatee);
    }

    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        // Mock implementation - simplified
        _delegate(msg.sender, delegatee);
    }

    // ERC20 functions
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");

        allowance[from][msg.sender] = currentAllowance - amount;
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    // Internal functions
    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        _votingPower[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        _votingPower[from] -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Insufficient balance");

        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        _votingPower[from] -= amount;
        _votingPower[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _delegate(address delegator, address delegatee) internal {
        address currentDelegate = _delegates[delegator];
        uint256 delegatorBalance = balanceOf[delegator];

        _delegates[delegator] = delegatee;

        emit DelegateChanged(delegator, currentDelegate, delegatee);

        _moveVotingPower(currentDelegate, delegatee, delegatorBalance);
    }

    function _moveVotingPower(
        address src,
        address dst,
        uint256 amount
    ) internal {
        if (src != dst && amount > 0) {
            if (src != address(0)) {
                _delegatedVotingPower[src] -= amount;
                emit DelegateVotesChanged(
                    src,
                    _delegatedVotingPower[src] + amount,
                    _delegatedVotingPower[src]
                );
            }
            if (dst != address(0)) {
                _delegatedVotingPower[dst] += amount;
                emit DelegateVotesChanged(
                    dst,
                    _delegatedVotingPower[dst] - amount,
                    _delegatedVotingPower[dst]
                );
            }
        }
    }
}
