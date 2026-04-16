// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./FFactoryV3.sol";
import "./IFPairV2.sol";
import "../tax/IBondingTax.sol";
import "../virtualPersona/IAgentVeTokenV2.sol";
import "../virtualPersona/IAgentFactoryV7.sol";
import "../pool/IUniswapV2Pair.sol";

// Minimal interface for BondingV5 (router: anti-sniper, drain checks, factory lookup)
interface IBondingV5ForRouter {
    function tokenAntiSniperType(address token) external view returns (uint8);

    function isProject60days(address token) external view returns (bool);

    function agentFactory() external view returns (address);
}

// Minimal interface for BondingConfig to get anti-sniper duration
interface IBondingConfigForRouter {
    function getAntiSniperDuration(uint8 antiSniperType_) external pure returns (uint256);
    function ANTI_SNIPER_NONE() external pure returns (uint8);
}

// Minimal interface for AgentTax to deposit tax with on-chain attribution
interface IAgentTaxForRouter {
    function depositTax(address tokenAddress, uint256 amount) external;
}

contract FRouterV3 is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant BE_OPS_ROLE = keccak256("BE_OPS_ROLE");

    FFactoryV3 public factory;
    address public assetToken;

    // BondingV5 reference for checking anti-sniper tax type
    IBondingV5ForRouter public bondingV5;
    IBondingConfigForRouter public bondingConfig;

    event PrivatePoolDrained(
        address indexed token,
        address indexed recipient,
        uint256 assetAmount,
        uint256 tokenAmount
    );

    event UniV2PoolDrained(
        address indexed token,
        address indexed veToken,
        address indexed recipient,
        uint256 veTokenAmount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address factory_,
        address assetToken_
    ) external initializer {
        __ReentrancyGuard_init();
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        require(factory_ != address(0), "Zero addresses are not allowed.");
        require(assetToken_ != address(0), "Zero addresses are not allowed.");

        factory = FFactoryV3(factory_);
        assetToken = assetToken_;
    }

    function getAmountsOut(
        address token,
        address assetToken_,
        uint256 amountIn
    ) public view returns (uint256 _amountOut) {
        require(token != address(0), "Zero addresses are not allowed.");

        address pairAddress = factory.getPair(token, assetToken);

        IFPairV2 pair = IFPairV2(pairAddress);

        (uint256 reserveA, uint256 reserveB) = pair.getReserves();

        uint256 k = pair.kLast();

        uint256 amountOut;

        if (assetToken_ == assetToken) {
            uint256 newReserveB = reserveB + amountIn;

            uint256 newReserveA = k / newReserveB;

            amountOut = reserveA - newReserveA;
        } else {
            uint256 newReserveA = reserveA + amountIn;

            uint256 newReserveB = k / newReserveA;

            amountOut = reserveB - newReserveB;
        }

        return amountOut;
    }

    function addInitialLiquidity(
        address token_,
        uint256 amountToken_,
        uint256 amountAsset_
    ) public onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
        require(token_ != address(0), "Zero addresses are not allowed.");

        address pairAddress = factory.getPair(token_, assetToken);

        IERC20(token_).safeTransferFrom(msg.sender, pairAddress, amountToken_);

        IFPairV2(pairAddress).mint(amountToken_, amountAsset_);

        return (amountToken_, amountAsset_);
    }

    function sell(
        uint256 amountIn,
        address tokenAddress,
        address to
    ) public nonReentrant onlyRole(EXECUTOR_ROLE) returns (uint256, uint256) {
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        require(to != address(0), "Zero addresses are not allowed.");
        require(amountIn > 0, "amountIn must be greater than 0");

        address pairAddress = factory.getPair(tokenAddress, assetToken);

        IFPairV2 pair = IFPairV2(pairAddress);

        IERC20 token = IERC20(tokenAddress);

        uint256 amountOut = getAmountsOut(tokenAddress, address(0), amountIn);

        token.safeTransferFrom(to, pairAddress, amountIn);

        uint fee = factory.sellTax();
        uint256 txFee = (fee * amountOut) / 100;

        uint256 amount = amountOut - txFee;
        address feeTo = factory.taxVault();

        pair.transferAsset(to, amount);
        // Transfer tax from pair to router, then deposit with on-chain attribution
        pair.transferAsset(address(this), txFee);
        IERC20(assetToken).forceApprove(feeTo, txFee);
        IAgentTaxForRouter(feeTo).depositTax(tokenAddress, txFee);

        pair.swap(amountIn, 0, 0, amountOut);

        return (amountIn, amountOut);
    }

    function buy(
        uint256 amountIn,
        address tokenAddress,
        address to,
        bool isInitialPurchase
    ) public onlyRole(EXECUTOR_ROLE) nonReentrant returns (uint256, uint256) {
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        require(to != address(0), "Zero addresses are not allowed.");
        require(amountIn > 0, "amountIn must be greater than 0");

        address pair = factory.getPair(tokenAddress, assetToken);

        // Calculate tax - use normal buyTax for initial purchase, anti-sniper tax for others
        uint256 normalTax = factory.buyTax(); //
        uint256 antiSniperTax = 0;
        if (isInitialPurchase) {
            // No anti-sniper tax for creator's initial purchase
        } else {
            antiSniperTax = _calculateAntiSniperTax(pair); // Anti-sniper tax for regular purchases
        }
        // Ensure total tax does not exceed 99% (user must receive at least 1%)
        if (normalTax + antiSniperTax > 99) {
            antiSniperTax = 99 - normalTax;
        }

        uint256 normalTxFee = (normalTax * amountIn) / 100; // tax is in percentage
        uint256 antiSniperTxFee = (antiSniperTax * amountIn) / 100; // tax is in percentage

        uint256 amount = amountIn - normalTxFee - antiSniperTxFee;

        IERC20(assetToken).safeTransferFrom(to, pair, amount);

        // Transfer normal tax to router, then deposit with on-chain attribution
        address taxVault = factory.taxVault();
        IERC20(assetToken).safeTransferFrom(to, address(this), normalTxFee);
        IERC20(assetToken).forceApprove(taxVault, normalTxFee);
        IAgentTaxForRouter(taxVault).depositTax(tokenAddress, normalTxFee);

        // Anti-sniper tax goes to separate vault (no attribution needed)
        if (antiSniperTxFee > 0) {
            IERC20(assetToken).safeTransferFrom(
                to,
                factory.antiSniperTaxVault(),
                antiSniperTxFee
            );
        }

        uint256 amountOut = getAmountsOut(tokenAddress, assetToken, amount);

        IFPairV2(pair).transferTo(to, amountOut);

        IFPairV2(pair).swap(0, amountOut, amount, 0);

        return (amount, amountOut);
    }

    function graduate(
        address tokenAddress
    ) public onlyRole(EXECUTOR_ROLE) nonReentrant {
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        address pair = factory.getPair(tokenAddress, assetToken);
        uint256 assetBalance = IFPairV2(pair).assetBalance();
        uint256 tokenBalance = IFPairV2(pair).balance();
        IFPairV2(pair).transferAsset(msg.sender, assetBalance); // sending all asset tokens to bondingV5 contract
        IFPairV2(pair).transferTo(msg.sender, tokenBalance); // sending agent tokens to bondingV5 contract
    }

    function approval(
        address pair,
        address asset,
        address spender,
        uint256 amount
    ) public onlyRole(EXECUTOR_ROLE) nonReentrant {
        require(spender != address(0), "Zero addresses are not allowed.");

        IFPairV2(pair).approval(spender, asset, amount);
    }

    /**
     * @dev Set the BondingV5 and BondingConfig contract addresses for anti-sniper tax type checks
     * @param bondingV5_ The address of the BondingV5 contract
     * @param bondingConfig_ The address of the BondingConfig contract
     */
    function setBondingV5(address bondingV5_, address bondingConfig_) public onlyRole(ADMIN_ROLE) {
        require(bondingV5_ != address(0), "Zero address not allowed");
        require(bondingConfig_ != address(0), "Zero address not allowed");
        bondingV5 = IBondingV5ForRouter(bondingV5_);
        bondingConfig = IBondingConfigForRouter(bondingConfig_);
    }

    function resetTime(
        address tokenAddress,
        uint256 newStartTime
    ) external onlyRole(BE_OPS_ROLE) nonReentrant {
        address pairAddress = factory.getPair(tokenAddress, assetToken);

        IFPairV2 pair = IFPairV2(pairAddress);

        pair.resetTime(newStartTime);
    }

    /**
     * @dev Calculate anti-sniper tax based on time elapsed since pair start
     * BondingV5 tokens: Use configurable anti-sniper types (NONE=0s, 60S=60s, 98M=98min)
     * BondingV4 X_LAUNCH tokens: Tax decreases from 99% to 0% over 99 seconds
     * Legacy tokens: Tax decreases from 99% to 0% over 99 minutes
     * @param pairAddress The address of the pair
     * @return taxPercentage Tax in percentage (1 = 1%)
     */
    function _calculateAntiSniperTax(
        address pairAddress
    ) private view returns (uint256) {
        IFPairV2 pair = IFPairV2(pairAddress);

        // Get token address directly from pair (tokenA is the agent token)
        address tokenAddress = pair.tokenA();

        uint256 startTax = factory.antiSniperBuyTaxStartValue(); // 99%

        uint8 antiSniperType = bondingV5.tokenAntiSniperType(tokenAddress);
        // Get the duration for this anti-sniper type
        uint256 duration = bondingConfig.getAntiSniperDuration(antiSniperType);
        
        // ANTI_SNIPER_NONE: no tax at all
        if (duration == 0) {
            return 0;
        }
        
        // Get tax start time
        uint256 taxStartTime = _getTaxStartTime(pair);
        
        // If trading hasn't started yet, use maximum tax
        if (block.timestamp < taxStartTime) {
            return startTax;
        }
        
        uint256 timeElapsed = block.timestamp - taxStartTime;
        
        // If time elapsed exceeds duration, no tax
        if (timeElapsed >= duration) {
            return 0;
        }
        
        // Linear decrease: tax = startTax * (duration - timeElapsed) / duration
        return startTax * (duration - timeElapsed) / duration;
    }

    /**
     * @dev Get the effective tax start time for a pair
     * @param pair The pair contract
     * @return The tax start time (taxStartTime if set, otherwise startTime)
     */
    function _getTaxStartTime(IFPairV2 pair) private view returns (uint256) {
        uint256 finalTaxStartTime = pair.startTime();
        // Try to get taxStartTime safely for backward compatibility
        try pair.taxStartTime() returns (uint256 _taxStartTime) {
            if (_taxStartTime > 0) {
                finalTaxStartTime = _taxStartTime; // use taxStartTime if it's set (for new pairs)
            }
        } catch {
            // Old pair contract doesn't have taxStartTime function
            // Use startTime for backward compatibility
        }
        return finalTaxStartTime;
    }

    function hasAntiSniperTax(address pairAddress) public view returns (bool) {
        return _calculateAntiSniperTax(pairAddress) > 0;
    }

    function setTaxStartTime(
        address pairAddress,
        uint256 _taxStartTime
    ) public onlyRole(EXECUTOR_ROLE) {
        IFPairV2 pair = IFPairV2(pairAddress);

        try pair.setTaxStartTime(_taxStartTime) {} catch {
            // Old pair contract doesn't have setTaxStartTime function
            // setTaxStartTime() will only be called in BondingV5.launch() function
            // so old pair contract won't be called and thus no issue, but we just be safe here
        }
    }

    // ==================== Liquidity Drain Functions ====================

    /**
     * @dev Drain all assets and tokens from a private pool (FPairV2)
     * Only callable by EXECUTOR_ROLE and only for Project60days tokens
     * @param tokenAddress The address of the fun token (must be isProject60days)
     * @param recipient The address that will receive the drained assets and tokens
     * @return assetAmount Amount of asset tokens drained
     * @return tokenAmount Amount of agent tokens drained
     */
    function drainPrivatePool(
        address tokenAddress,
        address recipient
    ) public onlyRole(BE_OPS_ROLE) nonReentrant returns (uint256, uint256) {
        require(address(bondingV5) != address(0), "BondingV5 not set");
        require(tokenAddress != address(0), "Zero addresses are not allowed.");
        require(recipient != address(0), "Zero addresses are not allowed.");

        // Check isProject60days restriction
        require(
            bondingV5.isProject60days(tokenAddress),
            "Token does not allow liquidity drain"
        );

        address pairAddress = factory.getPair(tokenAddress, assetToken);
        require(pairAddress != address(0), "Pair not found");

        IFPairV2 pair = IFPairV2(pairAddress);

        uint256 assetAmount = pair.assetBalance();
        uint256 tokenAmount = pair.balance();

        if (assetAmount > 0) {
            pair.transferAsset(recipient, assetAmount);
        }
        if (tokenAmount > 0) {
            pair.transferTo(recipient, tokenAmount);
        }

        // Sync reserves after drain to maintain state consistency
        // Use try-catch for backward compatibility with old FPairV2 contracts
        try pair.syncAfterDrain(assetAmount, tokenAmount) {} catch {
            // Old FPairV2 contracts don't have syncAfterDrain - drain still works,
            // but reserves won't be synced (only affects getReserves() view function)
        }
        emit PrivatePoolDrained(
            tokenAddress,
            recipient,
            assetAmount,
            tokenAmount
        );

        return (assetAmount, tokenAmount);
    }

    /**
     * @dev Drain ALL liquidity from a UniswapV2 pool (for graduated tokens)
     * Only callable by BE_OPS_ROLE and only for Project60days tokens
     * @param agentToken The token address (same as agentToken in single token model, must be isProject60days)
     * @param veToken The veToken address (staked LP token) to drain from
     * @param recipient The address that will receive the drained liquidity
     * @param deadline Transaction deadline
     * @notice This function drains ALL liquidity (full founder balance)
     * @notice amountAMin and amountBMin are set to 0 since this is a privileged drain operation
     */
    function drainUniV2Pool(
        address agentToken,
        address veToken,
        address recipient,
        uint256 deadline
    ) public onlyRole(BE_OPS_ROLE) nonReentrant {
        require(address(bondingV5) != address(0), "BondingV5 not set");
        require(agentToken != address(0), "Invalid agentToken");
        require(veToken != address(0), "Invalid veToken");
        require(recipient != address(0), "Invalid recipient");

        // Check isProject60days restriction
        require(
            bondingV5.isProject60days(agentToken),
            "agentToken does not allow liquidity drain"
        );

        // Verify veToken corresponds to the provided token
        // veToken.assetToken() returns the LP pair address
        address lpPair = IAgentVeTokenV2(veToken).assetToken();
        IUniswapV2Pair pair = IUniswapV2Pair(lpPair);
        address token0 = pair.token0();
        address token1 = pair.token1();

        require(
            token0 == agentToken || token1 == agentToken,
            "veToken does not match token"
        );
        require(
            token0 == assetToken || token1 == assetToken, // assetToken is $Virtual
            "veToken does not match assetToken"
        );

        // Get the FULL founder balance to drain ALL liquidity
        IAgentVeTokenV2 veTokenContract = IAgentVeTokenV2(veToken);
        address founder = veTokenContract.founder();
        uint256 veTokenAmount = IERC20(veToken).balanceOf(founder);

        require(veTokenAmount > 0, "No liquidity to drain");

        // Call removeLpLiquidity through AgentFactoryV7 (REMOVE_LIQUIDITY_ROLE on factory for this router)
        // amountAMin and amountBMin set to 0 - this is a privileged drain operation
        // No slippage protection needed since BE_OPS_ROLE is trusted
        address agentFactory = bondingV5.agentFactory();
        IAgentFactoryV7(agentFactory).removeLpLiquidity(
            veToken,
            recipient,
            veTokenAmount,
            0, // amountAMin - accept any amount
            0, // amountBMin - accept any amount
            deadline
        );

        emit UniV2PoolDrained(agentToken, veToken, recipient, veTokenAmount);
    }
}
