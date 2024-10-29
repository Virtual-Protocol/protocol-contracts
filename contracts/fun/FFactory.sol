// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "./FPair.sol";

contract FFactory is ReentrancyGuard, Initializable, AccessControlUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

    mapping(address => mapping(address => address)) private _pair;

    address[] public pairs;

    address public router;

    address public taxVault;
    uint256 public buyTax;
    uint256 public sellTax;

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
        uint256 sellTax_
    ) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        taxVault = taxVault_;
        buyTax = buyTax_;
        sellTax = sellTax_;
    }

    function _createPair(
        address tokenA,
        address tokenB,
        uint256 k
    ) internal returns (address) {
        require(tokenA != address(0), "Zero addresses are not allowed.");
        require(tokenB != address(0), "Zero addresses are not allowed.");
        require(router != address(0), "No router");

        Pair pair = new Pair(router, tokenA, tokenB);

        pair[tokenA][tokenB] = address(pair);
        pair[tokenB][tokenA] = address(pair);

        pairs.push(address(pair));

        uint n = pairs.length;

        emit PairCreated(tokenA, tokenB, address(_pair), n);

        return address(_pair);
    }

    function createPair(
        address tokenA,
        address tokenB
    ) external onlyRole(CREATOR_ROLE) nonReentrant returns (address) {
        address _pair = _createPair(tokenA, tokenB);

        return _pair;
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
        uint256 sellTax_
    ) public onlyRole(ADMIN_ROLE) {
        require(newVault != address(0), "Zero addresses are not allowed.");

        taxVault = newVault_;
        buyTax = buyTax_;
        sellTax = sellTax_;
    }

    function setRouter(address router_) public onlyRole(ADMIN_ROLE) {
        router = router_;
    }
}
