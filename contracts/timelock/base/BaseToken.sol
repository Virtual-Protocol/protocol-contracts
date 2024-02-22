// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

import "../../libs/TokenSaver.sol";

abstract contract BaseToken is
    ERC20Permit,
    ERC20Votes,
    AccessControl,
    TokenSaver
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;

    IERC20 public immutable depositToken;

    error NotGovError();

    bytes32 public constant GOV_ROLE = keccak256("GOV_ROLE");

    modifier onlyGov() {
        _onlyGov();
        _;
    }

    function _onlyGov() private view {
        if (!hasRole(GOV_ROLE, _msgSender())) {
            revert NotGovError();
        }
    }

    constructor(
        string memory _name,
        string memory _symbol,
        address _depositToken
    ) ERC20Permit(_name) ERC20(_name, _symbol) {
        require(
            _depositToken != address(0),
            "BasePool.constructor: Deposit token must be set"
        );
        depositToken = IERC20(_depositToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // The following functions are overrides required by Solidity.

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(
        address owner
    ) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
