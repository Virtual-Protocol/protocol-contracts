// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract veVirtualToken is ERC20, ERC20Permit, ERC20Votes, Ownable {
    constructor(
        address initialOwner
    )
        ERC20("Virtual Protocol Voting", "veVIRTUAL")
        ERC20Permit("Virtual Protocol Voting")
        Ownable(initialOwner)
    {}

    // Protocol oracle will call this function to sync token activities across multiple chains
    function oracleTransfer(
        address[] memory froms,
        address[] memory tos,
        uint256[] memory values
    ) external onlyOwner returns (bool) {
        require(
            froms.length == tos.length && tos.length == values.length,
            "Invalid input"
        );
        for (uint256 i = 0; i < froms.length; i++) {
            _update(froms[i], tos[i], values[i]);
        }
        return true;
    }

    // Disable manual transfers

    function approve(
        address /*spender*/,
        uint256 /*value*/
    ) public override returns (bool) {
        revert("Approve not supported");
    }

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
