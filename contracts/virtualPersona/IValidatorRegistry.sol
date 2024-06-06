// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IValidatorRegistry {
    event NewValidator(uint256 virtualId, address account);

    function isValidator(
        uint256 virtualId,
        address account
    ) external view returns (bool);

    function validatorScore(
        uint256 virtualId,
        address validator
    ) external view returns (uint256);

    function getPastValidatorScore(
        uint256 virtualId,
        address validator,
        uint256 timepoint
    ) external view returns (uint256);

    function validatorCount(uint256 virtualId) external view returns (uint256);

    function validatorAt(
        uint256 virtualId,
        uint256 index
    ) external view returns (address);

    function totalUptimeScore(
        uint256 virtualId
    ) external view returns (uint256);

    function addValidator(uint256 virtualId, address validator) external;
}
