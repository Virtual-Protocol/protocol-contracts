// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./IValidatorRegistry.sol";

abstract contract ValidatorRegistry is IValidatorRegistry, Initializable {
    mapping(uint256 virtualId => mapping(address account => bool isValidator))
        private _validatorsMap;
    mapping(address account => mapping(uint256 virtualId => uint256 score))
        private _baseValidatorScore;
    mapping(uint256 virtualId => address[] validators) private _validators;

    function(uint256, address) view returns (uint256) private _getScoreOf;
    function(uint256) view returns (uint256) private _getMaxScore;
    function(uint256, address, uint256) view returns (uint256)
        private _getPastScore;

    function __ValidatorRegistry_init(
        function(uint256, address) view returns (uint256) getScoreOf_,
        function(uint256) view returns (uint256) getMaxScore_,
        function(uint256, address, uint256) view returns (uint256) getPastScore_
    ) internal onlyInitializing {
        _getScoreOf = getScoreOf_;
        _getMaxScore = getMaxScore_;
        _getPastScore = getPastScore_;
    }

    function isValidator(
        uint256 virtualId,
        address account
    ) public view returns (bool) {
        return _validatorsMap[virtualId][account];
    }

    function _addValidator(uint256 virtualId, address validator) internal {
        _validatorsMap[virtualId][validator] = true;
        _validators[virtualId].push(validator);
        emit NewValidator(virtualId, validator);
    }

    function _initValidatorScore(
        uint256 virtualId,
        address validator
    ) internal {
        _baseValidatorScore[validator][virtualId] = _getMaxScore(virtualId);
    }

    function validatorScore(
        uint256 virtualId,
        address validator
    ) public view virtual returns (uint256) {
        return
            _baseValidatorScore[validator][virtualId] +
            _getScoreOf(virtualId, validator);
    }

    function getPastValidatorScore(
        uint256 virtualId,
        address validator,
        uint256 timepoint
    ) public view virtual returns (uint256) {
        return
            _baseValidatorScore[validator][virtualId] +
            _getPastScore(virtualId, validator, timepoint);
    }

    function validatorCount(uint256 virtualId) public view returns (uint256) {
        return _validators[virtualId].length;
    }

    function validatorAt(
        uint256 virtualId,
        uint256 index
    ) public view returns (address) {
        return _validators[virtualId][index];
    }

    function totalUptimeScore(uint256 virtualId) public view returns (uint256) {
        uint256 totalScore = 0;
        for (uint256 i = 0; i < validatorCount(virtualId); i++) {
            totalScore += validatorScore(virtualId, validatorAt(virtualId, i));
        }
        return totalScore;
    }
}
