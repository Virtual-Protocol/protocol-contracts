// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "./IAgentVeTokenV2.sol";
import "./IAgentNft.sol";
import "./ERC20Votes.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";
import "../pool/IUniswapV2Router03.sol";
import "../pool/IUniswapV2Pair.sol";
import "./IAgentFactory.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "./IErrors.sol";

contract AgentVeTokenV2 is
    IAgentVeTokenV2,
    ERC20Upgradeable,
    ERC20Votes,
    Ownable2StepUpgradeable,
    IErrors
{
    using SafeERC20 for IERC20;
    using Checkpoints for Checkpoints.Trace208;

    address public founder;
    address public assetToken; // This is the token that is staked
    address public agentNft;
    uint256 public matureAt; // The timestamp when the founder can withdraw the tokens
    bool public canStake; // To control private/public agent mode
    uint256 public initialLock; // Initial locked amount

    constructor() {
        _disableInitializers();
    }

    mapping(address => Checkpoints.Trace208) private _balanceCheckpoints;

    bool internal locked;

    IAgentFactory private _factory; // Single source of truth

    event LiquidityRemoved(
        address indexed veTokenHolder,
        uint256 veTokenAmount,
        uint256 amountA,
        uint256 amountB,
        address indexed recipient
    );

    modifier noReentrant() {
        require(!locked, "cannot reenter");
        locked = true;
        _;
        locked = false;
    }

    /**
     * @dev {onlyOwnerOrFactory}
     *
     * Throws if called by any account other than the owner, factory or pool.
     * owner has not been set yet, _factory = agentFactoryV6
     */
    modifier onlyOwnerOrFactory() {
        if (owner() != _msgSender() && address(_factory) != _msgSender()) {
            revert CallerIsNotAdminNorFactory();
        }
        _;
    }

    function initialize(
        string memory _name,
        string memory _symbol,
        address _founder,
        address _assetToken,
        uint256 _matureAt,
        address _agentNft,
        bool _canStake
    ) external initializer {
        __ERC20_init(_name, _symbol);
        __ERC20Votes_init();

        founder = _founder;
        matureAt = _matureAt;
        assetToken = _assetToken;
        agentNft = _agentNft;
        canStake = _canStake;
        _factory = IAgentFactory(_msgSender());
    }

    // Stakers have to stake their tokens and delegate to a validator
    function stake(uint256 amount, address receiver, address delegatee) public {
        require(
            canStake || totalSupply() == 0,
            "Staking is disabled for private agent"
        ); // Either public or first staker

        address sender = _msgSender();
        require(amount > 0, "Cannot stake 0");
        require(
            IERC20(assetToken).balanceOf(sender) >= amount,
            "Insufficient asset token balance"
        );
        require(
            IERC20(assetToken).allowance(sender, address(this)) >= amount,
            "Insufficient asset token allowance"
        );

        IAgentNft registry = IAgentNft(agentNft);
        uint256 virtualId = registry.stakingTokenToVirtualId(address(this));

        require(!registry.isBlacklisted(virtualId), "Agent Blacklisted");

        if (totalSupply() == 0) {
            initialLock = amount;
        }
        registry.addValidator(virtualId, delegatee);

        IERC20(assetToken).safeTransferFrom(sender, address(this), amount);
        _mint(receiver, amount);
        _delegate(receiver, delegatee);
        _balanceCheckpoints[receiver].push(
            clock(),
            SafeCast.toUint208(balanceOf(receiver))
        );
    }

    function setCanStake(bool _canStake) public {
        require(_msgSender() == founder, "Not founder");
        canStake = _canStake;
    }

    function setMatureAt(uint256 _matureAt) public {
        bytes32 ADMIN_ROLE = keccak256("ADMIN_ROLE");
        require(
            IAccessControl(agentNft).hasRole(ADMIN_ROLE, _msgSender()),
            "Not admin"
        );
        matureAt = _matureAt;
    }

    function withdraw(uint256 amount) public noReentrant {
        address sender = _msgSender();
        require(balanceOf(sender) >= amount, "Insufficient balance");

        if (
            (sender == founder) && ((balanceOf(sender) - amount) < initialLock)
        ) {
            require(block.timestamp >= matureAt, "Not mature yet");
        }

        _burn(sender, amount);
        _balanceCheckpoints[sender].push(
            clock(),
            SafeCast.toUint208(balanceOf(sender))
        );

        IERC20(assetToken).safeTransfer(sender, amount);
    }

    /**
     * @dev Removes liquidity from Uniswap V2 pair and burns corresponding staked LP tokens
     * Only callable by admin, draining rugged Project60days (intentionally BYPASSES matureAt)
     *
     * @param uniswapRouter The address of the Uniswap V2 router
     * @param veTokenAmount The amount of veToken (underlying lpToken) to remove liquidity for
     * @param recipient The address that will receive the underlying tokens
     * @param amountAMin Minimum amount of tokenA to receive
     * @param amountBMin Minimum amount of tokenB to receive
     * @param deadline Transaction deadline
     */
    function removeLpLiquidity(
        address uniswapRouter,
        uint256 veTokenAmount,
        address recipient,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external onlyOwnerOrFactory {
        require(
            uniswapRouter != address(0),
            "uniswapRouter cannot be zero address"
        );
        require(veTokenAmount > 0, "veTokenAmount must be greater than 0");
        // veToken is not transferable, so we only need to check the balance of the founder
        require(
            balanceOf(founder) >= veTokenAmount,
            "Insufficient veToken balance"
        );
        require(recipient != address(0), "recipient cannot be zero address");
        require(deadline > block.timestamp, "deadline must be in the future");

        // Get the router with removeLiquidity function
        IUniswapV2Router03 router = IUniswapV2Router03(uniswapRouter);

        // Get token addresses from the LP pair
        IUniswapV2Pair pair = IUniswapV2Pair(assetToken);
        address token0 = pair.token0();
        address token1 = pair.token1();

        // 1. Approve the uniswapRouter to spend veToken
        IERC20(assetToken).approve(address(uniswapRouter), veTokenAmount);
        // 2. Call uniswapV2 removeLiquidity
        try
            router.removeLiquidity(
                token0, // tokenA
                token1, // tokenB
                veTokenAmount, // liquidity amount
                amountAMin, // minimum tokenA amount
                amountBMin, // minimum tokenB amount
                recipient, // recipient of the tokens
                deadline // transaction deadline
            )
        returns (uint256 amountA, uint256 amountB) {
            // 3. Burn same veTokenAmount of the veToken from the veTokenHolder
            _burn(founder, veTokenAmount);
            _balanceCheckpoints[founder].push(
                clock(),
                SafeCast.toUint208(balanceOf(founder))
            );

            // Emit event for successful liquidity removal
            emit LiquidityRemoved(
                founder,
                veTokenAmount,
                amountA,
                amountB,
                recipient
            );
        } catch {
            revert("Liquidity removal failed");
        }
    }

    function getPastBalanceOf(
        address account,
        uint256 timepoint
    ) public view returns (uint256) {
        uint48 currentTimepoint = clock();
        if (timepoint >= currentTimepoint) {
            revert ERC5805FutureLookup(timepoint, currentTimepoint);
        }
        return
            _balanceCheckpoints[account].upperLookupRecent(
                SafeCast.toUint48(timepoint)
            );
    }

    // This is non-transferable token
    function transfer(
        address /*to*/,
        uint256 /*value*/
    ) public override returns (bool) {
        revert("Transfer not supported");
    }

    function transferFrom(
        address /*from*/,
        address /*to*/,
        uint256 /*value*/
    ) public override returns (bool) {
        revert("Transfer not supported");
    }

    function approve(
        address /*spender*/,
        uint256 /*value*/
    ) public override returns (bool) {
        revert("Approve not supported");
    }

    // The following functions are overrides required by Solidity.
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._update(from, to, value);
    }

    function getPastDelegates(
        address account,
        uint256 timepoint
    ) public view returns (address) {
        return super._getPastDelegates(account, timepoint);
    }
}
