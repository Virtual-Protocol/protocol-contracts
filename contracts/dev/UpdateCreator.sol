// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../virtualPersona/IAgentNft.sol";
import "../fun/Bonding.sol";

interface IAgentTax {
    function updateCreator(uint256 agentId, address creator) external;
}

contract UpdateCreator is AccessControl {
    IAgentTax public agentTax;
    Bonding public bonding;
    IAgentNft public nft;

    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    constructor(address taxAddr, address bondingAddr, address nftAddr) {
        agentTax = IAgentTax(taxAddr);
        bonding = Bonding(bondingAddr);
        nft = IAgentNft(nftAddr);
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    function changeFor(
        uint256 agentId,
        address tokenAddress
    ) external onlyRole(EXECUTOR_ROLE) {
        (address creator, , , address agentToken, , , , , , , , , ) = bonding
            .tokenInfo(tokenAddress);
        require(creator != address(0), "Invalid token address");
        IAgentNft.VirtualInfo memory info = nft.virtualInfo(agentId);
        require(info.token == agentToken, "Agent ID mismatch");
        agentTax.updateCreator(agentId, creator);
    }
}
