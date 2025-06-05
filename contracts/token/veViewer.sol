// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../token/veVirtual.sol";

contract veViewer {
    veVirtual token;

    constructor(address token_) {
        token = veVirtual(token_);
    }

    function balanceOfAt(
        address[] memory accounts,
        uint256 ts
    ) external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < accounts.length; i++) {
            total += token.balanceOfAt(accounts[i], ts);
        }
        return total;
    }
}
