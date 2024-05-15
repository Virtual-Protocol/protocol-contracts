// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../../libs/TokenSaver.sol";

abstract contract BaseToken is ERC20, AccessControl, TokenSaver {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;

    error NonTransferableError();

    constructor(
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert NonTransferableError();
    }

    function transferFrom(
        address,
        address,
        uint256
    ) public pure override returns (bool) {
        revert NonTransferableError();
    }

    // The following functions are overrides required by Solidity.
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20) {
        super._update(from, to, value);
    }
}
