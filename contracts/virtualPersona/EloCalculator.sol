// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Elo} from "../libs/Elo.sol";
import "./IEloCalculator.sol";

contract EloCalculator is IEloCalculator, Initializable, OwnableUpgradeable {
    uint256 public k;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        k = 30;
    }

    function mapBattleResultToGameResult(
        uint8 result
    ) internal pure returns (uint256) {
        if (result == 1) {
            return 100;
        } else if (result == 2) {
            return 50;
        } else if (result == 3) {
            return 50;
        }
        return 0;
    }

    function _roundUp(
        uint256 numerator,
        uint256 denominator
    ) internal pure returns (uint256) {
        return (numerator + denominator - 1) / denominator;
    }

    // Get winner elo rating
    function battleElo(
        uint256 currentRating,
        uint8[] memory battles
    ) public view returns (uint256) {
        uint256 eloA = 1000;
        uint256 eloB = 1000;
        for (uint256 i = 0; i < battles.length; i++) {
            uint256 result = mapBattleResultToGameResult(battles[i]);
            (uint256 change, bool negative) = Elo.ratingChange(
                eloB,
                eloA,
                result,
                k
            );
            change = _roundUp(change, 100);
            if (negative) {
                eloA -= change;
                eloB += change;
            } else {
                eloA += change;
                eloB -= change;
            }
        }
        return currentRating + eloA - 1000;
    }

    function setK(uint256 k_) public onlyOwner {
        k = k_;
    }
}
