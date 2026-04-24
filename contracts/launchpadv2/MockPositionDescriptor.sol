// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/// @dev Minimal stand-in (matches Uniswap `INonfungiblePositionManager` in ABI as `address`).
interface INonfungiblePositionManager {}

/// @dev Same `tokenURI` selector as `@uniswap/v3-periphery` `INonfungibleTokenPositionDescriptor`.
interface INonfungibleTokenPositionDescriptor {
    function tokenURI(INonfungiblePositionManager positionManager, uint256 tokenId)
        external
        view
        returns (string memory);
}

/// @notice Minimal NFT position descriptor for testnet (e.g. deployUniswapV3TestnetLiquidity).
contract MockPositionDescriptor is INonfungibleTokenPositionDescriptor {
    function tokenURI(INonfungiblePositionManager, uint256)
        external
        pure
        override
        returns (string memory)
    {
        return "";
    }
}
