// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ============================================================================
// FlowProtocol — main orchestrator for the closed-system $FLOW economy.
//
//   * activate(referrer)         — one-time $10 USDT activation, places
//                                   user in PhenomenalTree, $5 marketing
//                                   payout + $4 treasury + $1 pool.
//   * buy(usdtAmount)            — buy $FLOW at current pool/supply
//                                   price, mints to user, splits 20% fee
//                                   (10% tree + 10% pool) — full daily
//                                   limit accounting included.
//   * sell(flowAmount)           — burn $FLOW for USDT at current price,
//                                   subject to incomeLimit. 10% fee
//                                   (5% pool + 5% treasury). Refills
//                                   buyer's daily limit window.
//   * extendTree(months)         — $10 / 30 days, capped at 90 days
//                                   stacked. Triggers a 5-USDT
//                                   marketing distribution per month.
//   * buyIncomeLimitWithGWT(amt) — burn GWT to extend income limit at
//                                   1 GWT = 1.25 USDT, capped at 10% of
//                                   lifetime limit.
//   * claimGWT()                 — pull pending GWT minted 1:1 against
//                                   USDT fees paid on buys/sells.
//
// PRICE: pool_USDT * 1e18 / total_supply. Bootstrap price (when supply
// == 0) is `INITIAL_PRICE = 0.1 USDT` (configurable at deploy).
//
// DAILY LIMIT (USDT, 18-dec):
//   limit_max = max(MIN_DAILY, pool_USDT / 1000)  [i.e. 0.1% of pool]
//   plus refill credit = sum(sell.value within last 48h, capped to
//   what hasn't been credited yet).
//
// INCOME LIMIT BURN ON SELL:
//   value <= limit  ->  burn `flowAmount` tokens, limit -= value
//   value >  limit  ->  burn  flowAmount * limit / value tokens,
//                       limit = 0  (rest of FLOW remains with user).
//
// SECURITY:
//   * SafeERC20 for all USDT moves.
//   * ReentrancyGuard on every state-mutating external function.
//   * Pausable kill-switch (admin-only) on user-facing entry points.
//   * Custom errors only (gas + clarity).
//   * Strict checks-effects-interactions ordering.
//   * `poolUSDT` is a tracked state var, NOT `usdt.balanceOf(this)` —
//     prevents donation-attack accounting drift.
//
// AUDITOR-FACING TODOs flagged inline with `@audit-todo`.
// ============================================================================

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./interfaces/IFlowToken.sol";
import "./interfaces/IFlowGrowToken.sol";
import "./interfaces/IPhenomenalTree.sol";
import "./interfaces/IFlowProtocol.sol";

contract FlowProtocol is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    IFlowProtocol
{
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    // Roles
    // ----------------------------------------------------------------
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ----------------------------------------------------------------
    // Tunables (constants — change requires redeploy)
    // ----------------------------------------------------------------
    uint256 public constant ONE_USDT = 1e18;        // BSC USDT is 18-dec.
    uint256 public constant ACTIVATION_PRICE = 10 * ONE_USDT;
    uint256 public constant EXTEND_PRICE_PER_MONTH = 10 * ONE_USDT;
    uint256 public constant EXTEND_PERIOD = 30 days;
    uint256 public constant MAX_EXTEND_STACK = 90 days;

    uint256 public constant MIN_BUY = 20 * ONE_USDT;
    uint256 public constant MIN_DAILY_LIMIT = 50 * ONE_USDT;
    uint256 public constant DAILY_LIMIT_BPS = 10;        // 0.1% = 10 / 10_000
    uint256 public constant DAILY_WINDOW = 24 hours;
    uint256 public constant SELL_REFILL_WINDOW = 48 hours;

    uint256 public constant BUY_FEE_BPS = 2_000;         // 20% total
    uint256 public constant BUY_FEE_TREE_BPS = 1_000;    // 10% to tree
    uint256 public constant BUY_FEE_POOL_BPS = 1_000;    // 10% to pool

    uint256 public constant SELL_FEE_BPS = 1_000;        // 10% total
    uint256 public constant SELL_FEE_POOL_BPS = 500;     // 5% to pool
    uint256 public constant SELL_FEE_TREASURY_BPS = 500; // 5% to treasury

    uint256 public constant BPS_DENOM = 10_000;

    // Income limit on each buy: 1:2 (paid USDT * 2).
    uint256 public constant INCOME_LIMIT_MULT = 2;

    // GWT redemption: 1 GWT = 1.25 USDT income limit.
    // Price expressed as numerator/denominator to keep on-chain math
    // exact: 5 USDT per 4 GWT.
    uint256 public constant GWT_TO_USDT_NUM = 5;
    uint256 public constant GWT_TO_USDT_DEN = 4;
    uint256 public constant GWT_REDEEM_FEE = 2 * ONE_USDT;
    uint256 public constant GWT_REDEEM_FEE_POOL = ONE_USDT;
    uint256 public constant GWT_REDEEM_FEE_TREASURY = ONE_USDT;
    uint256 public constant GWT_REDEEM_CAP_BPS = 1_000; // 10%

    // ----------------------------------------------------------------
    // Refs (set once via initialize — clonable via EIP-1167)
    // ----------------------------------------------------------------
    IERC20 public usdt;
    IFlowToken public flow;
    IFlowGrowToken public gwt;
    IPhenomenalTree public tree;

    address public treasury;
    uint256 public initialPrice; // USDT/FLOW (18-dec). Used while supply==0.

    // ----------------------------------------------------------------
    // Storage
    // ----------------------------------------------------------------
    uint256 public poolUSDT;     // backing pool — authoritative balance
    uint256 public treasuryUSDT; // accumulated treasury balance held here

    struct UserState {
        bool activated;
        uint256 incomeLimit;          // current available income limit (USDT, 18-dec)
        uint256 lifetimeIncomeLimit;  // sum of all income limit ever granted
        uint256 lifetimeGwtRedeem;    // sum of income-limit gained via GWT redeem
        // Daily window tracking
        uint64  dayStart;             // timestamp of the current 24h window
        uint256 boughtToday;           // USDT bought (post-fee or gross? -> gross USDT input) within current window
        // Sell refill credit — sells in last 48h add to today's allowance
        uint64  refillResetAt;        // timestamp after which we recompute refill
        uint256 refillCredit;         // remaining USDT credit (sliding 48h)
        uint256 refillUsed;           // how much of refillCredit applied today
        // Tree active-until mirror (also stored in PhenomenalTree)
        uint256 activeUntil;
        // GWT compensation
        uint256 gwtPending;           // GWT to mint on next claimGWT()
    }
    mapping(address => UserState) private _user;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------
    event Activated(address indexed user, address indexed referrer, uint256 depth);
    event Bought(
        address indexed user,
        uint256 usdtIn,
        uint256 flowOut,
        uint256 priceAfter,
        uint256 incomeLimitAfter
    );
    event Sold(
        address indexed user,
        uint256 flowIn,
        uint256 usdtOut,
        uint256 priceAfter,
        uint256 incomeLimitAfter,
        uint256 flowBurned
    );
    event TreeExtended(address indexed user, uint256 months, uint256 activeUntil);
    event IncomeLimitBoughtWithGWT(address indexed user, uint256 gwtBurned, uint256 limitGained);
    event GWTClaimed(address indexed user, uint256 amount);
    event RewardPaid(
        address indexed payer,
        address indexed ancestor,
        uint256 levelIndex,
        uint256 amount
    );
    event TreasuryDust(address indexed payer, uint256 amount, string source);
    event TreasuryWithdrawn(address indexed to, uint256 amount);

    // ----------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------
    error ZeroAddress();
    error AlreadyActivated();
    error NotActivated();
    error SelfReferral();
    error ReferrerNotActivated();
    error BelowMinimum();
    error DailyLimitExceeded();
    error InsufficientPool();
    error InsufficientLimit();
    error TreeInactive();
    error InvalidExtendMonths();
    error ExtendCapExceeded();
    error LimitOverflow();
    error InvalidGwtAmount();
    error GwtRedeemCapExceeded();
    error NothingToClaim();
    error InvariantBroken();

    // ----------------------------------------------------------------
    // Initializer (clonable via EIP-1167)
    // ----------------------------------------------------------------
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        IERC20 _usdt,
        IFlowToken _flow,
        IFlowGrowToken _gwt,
        IPhenomenalTree _tree,
        address _treasury,
        uint256 _initialPrice
    ) external initializer {
        if (
            admin == address(0) ||
            address(_usdt) == address(0) ||
            address(_flow) == address(0) ||
            address(_gwt) == address(0) ||
            address(_tree) == address(0) ||
            _treasury == address(0)
        ) revert ZeroAddress();
        if (_initialPrice == 0) revert BelowMinimum();

        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        usdt = _usdt;
        flow = _flow;
        gwt = _gwt;
        tree = _tree;
        treasury = _treasury;
        initialPrice = _initialPrice;
    }

    // ----------------------------------------------------------------
    // Admin
    // ----------------------------------------------------------------
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
    }

    /// @notice Withdraw accumulated treasury balance (separate from pool).
    function withdrawTreasury(uint256 amount, address to)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount > treasuryUSDT) revert InsufficientPool();
        treasuryUSDT -= amount;
        usdt.safeTransfer(to, amount);
        emit TreasuryWithdrawn(to, amount);
    }

    // ----------------------------------------------------------------
    // activate
    // ----------------------------------------------------------------

    /// @notice One-time activation. Pulls $10 USDT from the user, places
    ///         the user in the PhenomenalTree under `referrer`, and
    ///         distributes the activation pot:
    ///         $5 marketing  -> 10-level reward walk
    ///         $1 pool       -> bumps backing pool
    ///         $4 treasury   -> stays in protocol under treasuryUSDT
    function activate(address referrer)
        external
        override
        nonReentrant
        whenNotPaused
    {
        UserState storage u = _user[msg.sender];
        if (u.activated) revert AlreadyActivated();
        if (referrer == msg.sender) revert SelfReferral();
        // Referrer must be activated (or be the tree root via address(0)).
        if (referrer != address(0) && !_user[referrer].activated) {
            revert ReferrerNotActivated();
        }

        // Pull $10.
        usdt.safeTransferFrom(msg.sender, address(this), ACTIVATION_PRICE);

        // Effects: mark activated, place in tree.
        u.activated = true;
        uint256 depth = tree.placeUser(msg.sender, referrer);

        // Allocate pot.
        uint256 marketing = 5 * ONE_USDT;
        uint256 toPool = 1 * ONE_USDT;
        uint256 toTreasury = 4 * ONE_USDT;
        // Sanity: must equal ACTIVATION_PRICE.
        if (marketing + toPool + toTreasury != ACTIVATION_PRICE) revert InvariantBroken();

        poolUSDT += toPool;
        treasuryUSDT += toTreasury;

        // Marketing distribution. The placer just joined so their parent
        // walk yields 9 ancestors max — leftover share rolls to dust.
        _settleMarketingReward(msg.sender, marketing);

        emit Activated(msg.sender, referrer, depth);
    }

    // ----------------------------------------------------------------
    // buy
    // ----------------------------------------------------------------

    /// @notice Buy $FLOW. Splits 20% fee: 10% -> tree, 10% -> pool. Mint
    ///         is computed against pool/supply BEFORE fee accumulation.
    ///         Income limit grows by 2x the gross USDT input.
    function buy(uint256 usdtAmount)
        external
        override
        nonReentrant
        whenNotPaused
    {
        UserState storage u = _user[msg.sender];
        if (!u.activated) revert NotActivated();
        if (usdtAmount < MIN_BUY) revert BelowMinimum();

        // Daily limit check (uses pool snapshot BEFORE this buy).
        _enforceDailyLimit(u, usdtAmount);

        // Pull USDT in full BEFORE we mutate state below the fee split.
        usdt.safeTransferFrom(msg.sender, address(this), usdtAmount);

        // Compute split.
        uint256 feeTotal = (usdtAmount * BUY_FEE_BPS) / BPS_DENOM;
        uint256 feeTree  = (usdtAmount * BUY_FEE_TREE_BPS) / BPS_DENOM;
        uint256 feePool  = feeTotal - feeTree;          // residual goes to pool
        uint256 netUSDT  = usdtAmount - feeTotal;       // goes to backing pool too

        // Compute mint amount BEFORE mutating poolUSDT / supply, so the
        // price reflects pre-buy state. The user's $FLOW corresponds
        // to `netUSDT` worth at current price.
        uint256 currentPrice = _priceFLOW();
        // mint = netUSDT * 1e18 / price
        uint256 mintAmount = (netUSDT * 1e18) / currentPrice;
        if (mintAmount == 0) revert BelowMinimum();

        // Effects.
        // Net + pool fee both go to pool (net is value, fee is bonus to backing).
        poolUSDT += netUSDT + feePool;

        // Tree fee: distributed via tree-walk; any dust to treasury.
        _settleBuyTreeReward(msg.sender, feeTree);

        // Income limit: 2x the GROSS spend.
        uint256 limitDelta = usdtAmount * INCOME_LIMIT_MULT;
        u.incomeLimit += limitDelta;
        u.lifetimeIncomeLimit += limitDelta;
        // Overflow sanity: incomeLimit must not exceed reasonable bound.
        if (u.incomeLimit < limitDelta) revert LimitOverflow();

        // GWT compensation = 1 GWT per USDT fee paid.
        u.gwtPending += feeTotal;

        // Interactions: mint $FLOW.
        flow.mint(msg.sender, mintAmount);

        emit Bought(msg.sender, usdtAmount, mintAmount, _priceFLOW(), u.incomeLimit);
    }

    // ----------------------------------------------------------------
    // sell
    // ----------------------------------------------------------------

    /// @notice Sell $FLOW for USDT. value = flowAmount * price / 1e18.
    ///         Income limit must be > 0; if value > limit, only the
    ///         limit-share of tokens are burned (rest stay with user).
    ///         10% fee: 5% pool + 5% treasury. Refills daily-limit
    ///         credit window for buys.
    function sell(uint256 flowAmount)
        external
        override
        nonReentrant
        whenNotPaused
    {
        UserState storage u = _user[msg.sender];
        if (!u.activated) revert NotActivated();
        if (flowAmount == 0) revert BelowMinimum();
        if (u.incomeLimit == 0) revert InsufficientLimit();

        uint256 priceNow = _priceFLOW();
        // gross value of all tokens at current price
        uint256 valueGross = (flowAmount * priceNow) / 1e18;
        if (valueGross == 0) revert BelowMinimum();

        // Determine actual sell value & tokens to burn given income limit.
        // CRITICAL: this is the ledger-defining math. Reviewed twice.
        uint256 burnTokens;
        uint256 valueSettled;
        if (valueGross <= u.incomeLimit) {
            burnTokens = flowAmount;
            valueSettled = valueGross;
            u.incomeLimit -= valueGross;
        } else {
            // Proportional — only `limit` worth of tokens are sold.
            // burnTokens = flowAmount * limit / valueGross
            burnTokens = (flowAmount * u.incomeLimit) / valueGross;
            valueSettled = u.incomeLimit;
            u.incomeLimit = 0;
        }
        if (burnTokens == 0) revert InsufficientLimit();

        // Fee split.
        uint256 feeTotal = (valueSettled * SELL_FEE_BPS) / BPS_DENOM;
        uint256 feePool = (valueSettled * SELL_FEE_POOL_BPS) / BPS_DENOM;
        uint256 feeTreasury = feeTotal - feePool;
        uint256 netOut = valueSettled - feeTotal;

        // Pool sanity: pool must cover full valueSettled (we then send
        // back netOut and re-credit feePool to pool).
        if (poolUSDT < valueSettled) revert InsufficientPool();

        // Effects FIRST.
        poolUSDT -= valueSettled;        // remove the full settled value
        poolUSDT += feePool;              // pool fee returns to pool
        treasuryUSDT += feeTreasury;

        // GWT compensation against fee.
        u.gwtPending += feeTotal;

        // Refill credit accounting (sliding 48h window).
        _accrueRefillCredit(u, valueSettled);

        // Interactions LAST.
        flow.burn(msg.sender, burnTokens);
        usdt.safeTransfer(msg.sender, netOut);

        emit Sold(msg.sender, burnTokens, netOut, _priceFLOW(), u.incomeLimit, burnTokens);
    }

    // ----------------------------------------------------------------
    // extendTree
    // ----------------------------------------------------------------

    /// @notice Pay $10 per 30-day extension. Stack is capped at 90 days
    ///         from `block.timestamp`. Each month triggers a 5-USDT
    ///         marketing distribution.
    function extendTree(uint256 months)
        external
        override
        nonReentrant
        whenNotPaused
    {
        UserState storage u = _user[msg.sender];
        if (!u.activated) revert NotActivated();
        if (months == 0 || months > 3) revert InvalidExtendMonths();

        uint256 cost = months * EXTEND_PRICE_PER_MONTH;
        usdt.safeTransferFrom(msg.sender, address(this), cost);

        // Compute new active-until. Cap stacked period to 90 days.
        uint256 base = u.activeUntil > block.timestamp
            ? u.activeUntil
            : block.timestamp;
        uint256 newUntil = base + months * EXTEND_PERIOD;
        uint256 cap = block.timestamp + MAX_EXTEND_STACK;
        if (newUntil > cap) revert ExtendCapExceeded();

        u.activeUntil = newUntil;
        tree.setActiveUntil(msg.sender, newUntil);

        // Per-month split: $5 marketing, $1 pool, $4 treasury.
        for (uint256 i = 0; i < months; ++i) {
            uint256 marketing = 5 * ONE_USDT;
            uint256 toPool = 1 * ONE_USDT;
            uint256 toTreasury = 4 * ONE_USDT;
            poolUSDT += toPool;
            treasuryUSDT += toTreasury;
            _settleMarketingReward(msg.sender, marketing);
        }

        emit TreeExtended(msg.sender, months, newUntil);
    }

    // ----------------------------------------------------------------
    // buyIncomeLimitWithGWT
    // ----------------------------------------------------------------

    /// @notice Burn `gwtAmount` GWT to extend incomeLimit by
    ///         `gwtAmount * 5 / 4` USDT, capped at 10% of lifetime
    ///         limit. Fee = $2 USDT (1 pool / 1 treasury), pulled in
    ///         USDT (NOT from GWT).
    function buyIncomeLimitWithGWT(uint256 gwtAmount)
        external
        override
        nonReentrant
        whenNotPaused
    {
        UserState storage u = _user[msg.sender];
        if (!u.activated) revert NotActivated();
        if (gwtAmount == 0) revert InvalidGwtAmount();

        uint256 limitGain = (gwtAmount * GWT_TO_USDT_NUM) / GWT_TO_USDT_DEN;
        if (limitGain == 0) revert InvalidGwtAmount();

        // 10% lifetime cap on GWT-redeem income limit.
        uint256 cap = (u.lifetimeIncomeLimit * GWT_REDEEM_CAP_BPS) / BPS_DENOM;
        if (u.lifetimeGwtRedeem + limitGain > cap) revert GwtRedeemCapExceeded();

        // Pull $2 USDT fee.
        usdt.safeTransferFrom(msg.sender, address(this), GWT_REDEEM_FEE);
        poolUSDT += GWT_REDEEM_FEE_POOL;
        treasuryUSDT += GWT_REDEEM_FEE_TREASURY;

        // Burn the GWT (this contract holds MINTER_ROLE on GWT for both
        // mint and burn).
        gwt.burn(msg.sender, gwtAmount);

        u.incomeLimit += limitGain;
        u.lifetimeIncomeLimit += limitGain;
        u.lifetimeGwtRedeem += limitGain;

        emit IncomeLimitBoughtWithGWT(msg.sender, gwtAmount, limitGain);
    }

    // ----------------------------------------------------------------
    // claimGWT
    // ----------------------------------------------------------------

    /// @notice Mint accumulated GWT (1:1 versus USDT fees paid on
    ///         buy/sell). Resets pending counter.
    function claimGWT() external override nonReentrant whenNotPaused {
        UserState storage u = _user[msg.sender];
        uint256 amt = u.gwtPending;
        if (amt == 0) revert NothingToClaim();
        u.gwtPending = 0;
        gwt.mint(msg.sender, amt);
        emit GWTClaimed(msg.sender, amt);
    }

    // ----------------------------------------------------------------
    // Internal helpers
    // ----------------------------------------------------------------

    function _priceFLOW() internal view returns (uint256) {
        uint256 supply = flow.totalSupply();
        if (supply == 0) return initialPrice;
        // pool * 1e18 / supply  (USDT per FLOW, 18-dec)
        return (poolUSDT * 1e18) / supply;
    }

    function _enforceDailyLimit(UserState storage u, uint256 spend) internal {
        // Roll the window if 24h passed.
        if (block.timestamp >= u.dayStart + DAILY_WINDOW) {
            u.dayStart = uint64(block.timestamp);
            u.boughtToday = 0;
            u.refillUsed = 0;
        }
        // Compute base limit with current pool snapshot.
        uint256 base = MIN_DAILY_LIMIT;
        uint256 calc = (poolUSDT * DAILY_LIMIT_BPS) / BPS_DENOM;
        if (calc > base) base = calc;

        // Available = base + (refillCredit not yet applied).
        // Refills are capped by `refillCredit - refillUsed` and only
        // valid within the 48h sell-refill window.
        uint256 available = base;
        if (block.timestamp < u.refillResetAt) {
            uint256 refillRemaining = u.refillCredit > u.refillUsed
                ? u.refillCredit - u.refillUsed
                : 0;
            available += refillRemaining;
        } else {
            // 48h passed since the last refill window — clear stale credit.
            u.refillCredit = 0;
            u.refillUsed = 0;
        }

        if (u.boughtToday + spend > available) revert DailyLimitExceeded();

        // Account spending: prefer base allowance first, then refill.
        uint256 nextBought = u.boughtToday + spend;
        if (nextBought > base) {
            uint256 refillSpent = nextBought - (u.boughtToday > base ? u.boughtToday : base);
            u.refillUsed += refillSpent;
        }
        u.boughtToday = nextBought;
    }

    function _accrueRefillCredit(UserState storage u, uint256 sellValue) internal {
        // Sliding 48h: every sell extends the window.
        u.refillCredit += sellValue;
        u.refillResetAt = uint64(block.timestamp + SELL_REFILL_WINDOW);
    }

    function _settleMarketingReward(address payer, uint256 totalReward) internal {
        // Marketing payout uses the canonical 5-USDT level table.
        // We delegate to the tree's view-and-emit pattern: get the
        // split, transfer USDT to ancestors, route dust to treasury.
        (
            address[] memory recipients,
            uint256[] memory amounts,
            ,
            uint256 totalDust
        ) = tree.previewRewardWalk(payer, totalReward, /*scaled=*/ false);

        for (uint256 i = 0; i < recipients.length; ++i) {
            address rcp = recipients[i];
            uint256 amt = amounts[i];
            if (rcp != address(0) && amt > 0) {
                usdt.safeTransfer(rcp, amt);
                emit RewardPaid(payer, rcp, i, amt);
            }
        }
        if (totalDust > 0) {
            treasuryUSDT += totalDust;
            emit TreasuryDust(payer, totalDust, "marketing");
        }

        // Also emit on tree for indexer parity (and to enforce the
        // RewardMismatch / UnknownPayer guards on-chain).
        tree.payTreeReward(payer, totalReward);
    }

    function _settleBuyTreeReward(address payer, uint256 totalReward) internal {
        // Scaled distribution: per-level share = total * levelTable / 5e18.
        (
            address[] memory recipients,
            uint256[] memory amounts,
            ,
            uint256 totalDust
        ) = tree.previewRewardWalk(payer, totalReward, /*scaled=*/ true);

        for (uint256 i = 0; i < recipients.length; ++i) {
            address rcp = recipients[i];
            uint256 amt = amounts[i];
            if (rcp != address(0) && amt > 0) {
                usdt.safeTransfer(rcp, amt);
                emit RewardPaid(payer, rcp, i, amt);
            }
        }
        if (totalDust > 0) {
            treasuryUSDT += totalDust;
            emit TreasuryDust(payer, totalDust, "buy");
        }

        tree.payBuyTreeReward(payer, totalReward);
    }

    // ----------------------------------------------------------------
    // External views
    // ----------------------------------------------------------------

    function priceFLOW() external view override returns (uint256) {
        return _priceFLOW();
    }

    function incomeLimit(address user) external view override returns (uint256) {
        return _user[user].incomeLimit;
    }

    function lifetimeIncomeLimit(address user)
        external
        view
        override
        returns (uint256)
    {
        return _user[user].lifetimeIncomeLimit;
    }

    function isActivated(address user) external view override returns (bool) {
        return _user[user].activated;
    }

    function pendingGWT(address user) external view override returns (uint256) {
        return _user[user].gwtPending;
    }

    function dailyLimitMax() external view returns (uint256) {
        uint256 calc = (poolUSDT * DAILY_LIMIT_BPS) / BPS_DENOM;
        return calc > MIN_DAILY_LIMIT ? calc : MIN_DAILY_LIMIT;
    }

    function userState(address user)
        external
        view
        returns (
            bool activated,
            uint256 _incomeLimit,
            uint256 _lifetimeLimit,
            uint64 _dayStart,
            uint256 _boughtToday,
            uint256 _refillCredit,
            uint64 _refillResetAt,
            uint256 _activeUntil,
            uint256 _gwtPending
        )
    {
        UserState storage u = _user[user];
        return (
            u.activated,
            u.incomeLimit,
            u.lifetimeIncomeLimit,
            u.dayStart,
            u.boughtToday,
            u.refillCredit,
            u.refillResetAt,
            u.activeUntil,
            u.gwtPending
        );
    }
}
