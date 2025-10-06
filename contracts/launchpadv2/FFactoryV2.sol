// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./FPairV2.sol";

contract FFactoryV2 is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

    mapping(address => mapping(address => address)) private _pair;

    address[] public pairs;

    address public router;

    address public taxVault;
    uint256 public buyTax;
    uint256 public sellTax;
    uint256 public antiSniperBuyTaxStartValue; // Starting tax value for anti-sniper (in basis points)
    address public antiSniperTaxVault;

    event PairCreated(
        address indexed tokenA,
        address indexed tokenB,
        address pair,
        uint
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address taxVault_,
        uint256 buyTax_,
        uint256 sellTax_,
        uint256 antiSniperBuyTaxStartValue_,
        address antiSniperTaxVault_
    ) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        taxVault = taxVault_;
        buyTax = buyTax_;
        sellTax = sellTax_;
        antiSniperBuyTaxStartValue = antiSniperBuyTaxStartValue_;
        antiSniperTaxVault = antiSniperTaxVault_;
    }

    function _createPair(
        address tokenA,
        address tokenB,
        uint256 startTime,
        uint256 startTimeDelay
    ) internal returns (address) {
        require(tokenA != address(0), "Zero addresses are not allowed.");
        require(tokenB != address(0), "Zero addresses are not allowed.");
        require(router != address(0), "No router");

        FPairV2 pair_ = new FPairV2(
            router,
            tokenA,
            tokenB,
            startTime,
            startTimeDelay
        );

        _pair[tokenA][tokenB] = address(pair_);
        _pair[tokenB][tokenA] = address(pair_);

        pairs.push(address(pair_));

        emit PairCreated(tokenA, tokenB, address(pair_), pairs.length);

        return address(pair_);
    }

    function createPair(
        address tokenA,
        address tokenB,
        uint256 startTime,
        uint256 startTimeDelay
    ) external onlyRole(CREATOR_ROLE) nonReentrant returns (address) {
        return _createPair(tokenA, tokenB, startTime, startTimeDelay);
    }

    function getPair(
        address tokenA,
        address tokenB
    ) public view returns (address) {
        return _pair[tokenA][tokenB];
    }

    function allPairsLength() public view returns (uint) {
        return pairs.length;
    }

    function setTaxParams(
        address newVault_,
        uint256 buyTax_,
        uint256 sellTax_,
        uint256 antiSniperBuyTaxStartValue_,
        address antiSniperTaxVault_
    ) public onlyRole(ADMIN_ROLE) {
        require(newVault_ != address(0), "Zero addresses are not allowed.");

        taxVault = newVault_;
        buyTax = buyTax_;
        sellTax = sellTax_;
        antiSniperBuyTaxStartValue = antiSniperBuyTaxStartValue_;
        antiSniperTaxVault = antiSniperTaxVault_;
    }

    function setRouter(address router_) public onlyRole(ADMIN_ROLE) {
        router = router_;
    }
}
