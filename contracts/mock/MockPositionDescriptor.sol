// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev Minimal descriptor compatible with UniswapV3 NonfungiblePositionManager constructor.
/// It is only used for tokenURI(), which is irrelevant for liquidity/swap smoke tests.
contract MockPositionDescriptor {
    function tokenURI(
        uint256
    ) external pure returns (string memory) {
        return "";
    }
}
