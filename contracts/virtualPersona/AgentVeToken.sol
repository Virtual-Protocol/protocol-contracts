// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "./IAgentVeToken.sol";
import "./IAgentNft.sol";
import "./ERC20Votes.sol";

contract AgentVeToken is IAgentVeToken, ERC20Upgradeable, ERC20Votes {
    using SafeERC20 for IERC20;
    using Checkpoints for Checkpoints.Trace208;

    address public immutable assetToken; // This is the token that is staked
    address public founder;
    uint256 public matureAt; // The timestamp when the founder can withdraw the tokens

    constructor(address _assetToken) {
        _disableInitializers();
        assetToken = _assetToken;
    }

    mapping(address => Checkpoints.Trace208) private _balanceCheckpoints;

    bool internal locked;

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    function initialize(
        string memory name,
        string memory symbol,
        address _founder,
        uint256 _matureAt
    ) external initializer {
        __ERC20_init(name, symbol);
        __ERC20Votes_init();

        founder = _founder;
        matureAt = _matureAt;
    }

    // Stakers have to stake their tokens and delegate to a validator
    function stake(
        uint256 amount,
        address receiver,
        address delegatee
    ) public {
        address sender = _msgSender();
        require(amount > 0, "Cannot stake 0");

        IERC20(assetToken).safeTransferFrom(sender, address(this), amount);
        _mint(receiver, amount);
        _delegate(receiver, delegatee);
        _balanceCheckpoints[receiver].push(
            clock(),
            SafeCast.toUint208(balanceOf(receiver))
        );
    }

    function withdraw(uint256 amount) public noReentrant {
        address sender = _msgSender();
        require(balanceOf(sender) >= amount, "Insufficient balance");
        if (sender == founder) {
            require(block.timestamp >= matureAt, "Not mature yet");
        }

        _burn(sender, amount);
        _balanceCheckpoints[sender].push(
            clock(),
            SafeCast.toUint208(balanceOf(sender))
        );

        IERC20(assetToken).safeTransfer(sender, amount);
    }

    function getPastBalanceOf(
        address account,
        uint256 timepoint
    ) public view returns (uint256) {
        uint48 currentTimepoint = clock();
        if (timepoint >= currentTimepoint) {
            revert ERC5805FutureLookup(timepoint, currentTimepoint);
        }
        return
            _balanceCheckpoints[account].upperLookupRecent(
                SafeCast.toUint48(timepoint)
            );
    }

    // This is non-transferable token
    function transfer(
        address /*to*/,
        uint256 /*value*/
    ) public override returns (bool) {
        revert("Transfer not supported");
    }

    function transferFrom(
        address /*from*/,
        address /*to*/,
        uint256 /*value*/
    ) public override returns (bool) {
        revert("Transfer not supported");
    }

    function approve(
        address /*spender*/,
        uint256 /*value*/
    ) public override returns (bool) {
        revert("Approve not supported");
    }

    // The following functions are overrides required by Solidity.
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._update(from, to, value);
    }

    function getPastDelegates(
        address account,
        uint256 timepoint
    ) public view returns (address) {
        return super._getPastDelegates(account, timepoint);
    }
}