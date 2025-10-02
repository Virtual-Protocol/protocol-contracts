// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAgentVeToken.sol";

interface IAgentVeTokenV2 is IAgentVeToken {
    function initialize(
        string memory _name,
        string memory _symbol,
        address _founder,
        address _assetToken,
        uint256 _matureAt,
        address _agentNft,
        bool _canStake
    ) external;

    function stake(
        uint256 amount,
        address receiver,
        address delegatee
    ) external;

    function withdraw(uint256 amount) external;

    function getPastDelegates(
        address account,
        uint256 timepoint
    ) external view returns (address);

    function getPastBalanceOf(
        address account,
        uint256 timepoint
    ) external view returns (uint256);

    function removeLpLiquidity(address uniswapRouter, uint256 veTokenAmount, address recipient, uint256 amountAMin, uint256 amountBMin, uint256 deadline) external;

    function assetToken() external view returns (address);
}
