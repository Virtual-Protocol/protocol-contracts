// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../pool/IUniswapV2Router02.sol";
import "../pool/IUniswapV2Factory.sol";
import "./IAgentToken.sol";
import "./IAgentFactory.sol";

contract AgentToken is
    ContextUpgradeable,
    IAgentToken,
    Ownable2StepUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using SafeERC20 for IERC20;

    uint256 internal constant BP_DENOM = 10000;
    uint256 internal constant ROUND_DEC = 100000000000;
    uint256 internal constant CALL_GAS_LIMIT = 50000;
    uint256 internal constant MAX_SWAP_THRESHOLD_MULTIPLE = 20;

    address public uniswapV2Pair;
    uint256 public botProtectionDurationInSeconds;
    bool internal _tokenHasTax;
    IUniswapV2Router02 internal _uniswapRouter;

    uint32 public fundedDate;
    uint16 public projectBuyTaxBasisPoints;
    uint16 public projectSellTaxBasisPoints;
    uint16 public swapThresholdBasisPoints;
    address public pairToken; // The token used to trade for this token

    /** @dev {_autoSwapInProgress} We start with {_autoSwapInProgress} ON, as we don't want to
     * call autoswap when processing initial liquidity from this address. We turn this OFF when
     * liquidity has been loaded, and use this bool to control processing during auto-swaps
     * from that point onwards. */
    bool private _autoSwapInProgress;

    address public projectTaxRecipient;
    uint128 public projectTaxPendingSwap;
    address public vault; // Project supply vault

    string private _name;
    string private _symbol;
    uint256 private _totalSupply;

    /** @dev {_balances} Addresses balances */
    mapping(address => uint256) private _balances;

    /** @dev {_allowances} Addresses allocance details */
    mapping(address => mapping(address => uint256)) private _allowances;

    /** @dev {_validCallerCodeHashes} Code hashes of callers we consider valid */
    EnumerableSet.Bytes32Set private _validCallerCodeHashes;

    /** @dev {_liquidityPools} Enumerable set for liquidity pool addresses */
    EnumerableSet.AddressSet private _liquidityPools;

    IAgentFactory private _factory; // Single source of truth

    /**
     * @dev {onlyOwnerOrFactory}
     *
     * Throws if called by any account other than the owner, factory or pool.
     */
    modifier onlyOwnerOrFactory() {
        if (owner() != _msgSender() && address(_factory) != _msgSender()) {
            revert CallerIsNotAdminNorFactory();
        }
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address[3] memory integrationAddresses_,
        bytes memory baseParams_,
        bytes memory supplyParams_,
        bytes memory taxParams_
    ) external initializer {
        _decodeBaseParams(integrationAddresses_[0], baseParams_);
        _uniswapRouter = IUniswapV2Router02(integrationAddresses_[1]);
        pairToken = integrationAddresses_[2];

        ERC20SupplyParameters memory supplyParams = abi.decode(
            supplyParams_,
            (ERC20SupplyParameters)
        );

        ERC20TaxParameters memory taxParams = abi.decode(
            taxParams_,
            (ERC20TaxParameters)
        );

        _processSupplyParams(supplyParams);

        uint256 lpSupply = supplyParams.lpSupply * (10 ** decimals());
        uint256 vaultSupply = supplyParams.vaultSupply * (10 ** decimals());

        botProtectionDurationInSeconds = supplyParams
            .botProtectionDurationInSeconds;

        _tokenHasTax = _processTaxParams(taxParams);
        swapThresholdBasisPoints = uint16(
            taxParams.taxSwapThresholdBasisPoints
        );
        projectTaxRecipient = taxParams.projectTaxRecipient;

        _mintBalances(lpSupply, vaultSupply);

        uniswapV2Pair = _createPair();

        _factory = IAgentFactory(_msgSender());
        _autoSwapInProgress = true; // We don't want to tax initial liquidity
    }

    /**
     * @dev function {_decodeBaseParams}
     *
     * Decode NFT Parameters
     *
     * @param projectOwner_ The owner of this contract
     * @param encodedBaseParams_ The base params encoded into a bytes array
     */
    function _decodeBaseParams(
        address projectOwner_,
        bytes memory encodedBaseParams_
    ) internal {
        _transferOwnership(projectOwner_);

        (_name, _symbol) = abi.decode(encodedBaseParams_, (string, string));
    }

    /**
     * @dev function {_processSupplyParams}
     *
     * Process provided supply params
     *
     * @param erc20SupplyParameters_ The supply params
     */
    function _processSupplyParams(
        ERC20SupplyParameters memory erc20SupplyParameters_
    ) internal {
        if (
            erc20SupplyParameters_.maxSupply !=
            (erc20SupplyParameters_.vaultSupply +
                erc20SupplyParameters_.lpSupply)
        ) {
            revert SupplyTotalMismatch();
        }

        if (erc20SupplyParameters_.maxSupply > type(uint128).max) {
            revert MaxSupplyTooHigh();
        }

        vault = erc20SupplyParameters_.vault;
    }

    /**
     * @dev function {_processTaxParams}
     *
     * Process provided tax params
     *
     * @param erc20TaxParameters_ The tax params
     */
    function _processTaxParams(
        ERC20TaxParameters memory erc20TaxParameters_
    ) internal returns (bool tokenHasTax_) {
        /**
         * @dev If this
         * token does NOT have tax applied then there is no need to store or read these parameters, and we can
         * avoid this simply by checking the immutable var. Pass back the value for this var from this method.
         */
        if (
            erc20TaxParameters_.projectBuyTaxBasisPoints == 0 &&
            erc20TaxParameters_.projectSellTaxBasisPoints == 0
        ) {
            return false;
        } else {
            projectBuyTaxBasisPoints = uint16(
                erc20TaxParameters_.projectBuyTaxBasisPoints
            );
            projectSellTaxBasisPoints = uint16(
                erc20TaxParameters_.projectSellTaxBasisPoints
            );
            return true;
        }
    }

    /**
     * @dev function {_mintBalances}
     *
     * Mint initial balances
     *
     * @param lpMint_ The number of tokens for liquidity
     */
    function _mintBalances(uint256 lpMint_, uint256 vaultMint_) internal {
        if (lpMint_ > 0) {
            _mint(address(this), lpMint_);
        }

        if (vaultMint_ > 0) {
            _mint(vault, vaultMint_);
        }
    }

    /**
     * @dev function {_createPair}
     *
     * Create the uniswap pair
     *
     * @return uniswapV2Pair_ The pair address
     */
    function _createPair() internal returns (address uniswapV2Pair_) {
        uniswapV2Pair_ = IUniswapV2Factory(_uniswapRouter.factory()).getPair(
            address(this),
            pairToken
        );

        if (uniswapV2Pair_ == address(0)) {
            uniswapV2Pair_ = IUniswapV2Factory(_uniswapRouter.factory())
                .createPair(address(this), pairToken);

            emit LiquidityPoolCreated(uniswapV2Pair_);
        }

        _liquidityPools.add(uniswapV2Pair_);

        return (uniswapV2Pair_);
    }

    /**
     * @dev function {addInitialLiquidity}
     *
     * Add initial liquidity to the uniswap pair
     *
     * @param lpOwner The recipient of LP tokens
     */
    function addInitialLiquidity(address lpOwner) external onlyOwnerOrFactory {
        _addInitialLiquidity(lpOwner);
    }

    /**
     * @dev function {_addInitialLiquidity}
     *
     * Add initial liquidity to the uniswap pair (internal function that does processing)
     *
     * * @param lpOwner The recipient of LP tokens
     */
    function _addInitialLiquidity(address lpOwner) internal {
        // Funded date is the date of first funding. We can only add initial liquidity once. If this date is set,
        // we cannot proceed
        if (fundedDate != 0) {
            revert InitialLiquidityAlreadyAdded();
        }

        fundedDate = uint32(block.timestamp);

        // Can only do this if this contract holds tokens:
        if (balanceOf(address(this)) == 0) {
            revert NoTokenForLiquidityPair();
        }

        // Approve the uniswap router for an inifinite amount (max uint256)
        // This means that we don't need to worry about later incrememtal
        // approvals on tax swaps, as the uniswap router allowance will never
        // be decreased (see code in decreaseAllowance for reference)
        _approve(address(this), address(_uniswapRouter), type(uint256).max);
        IERC20(pairToken).approve(address(_uniswapRouter), type(uint256).max);
        // Add the liquidity:
        (uint256 amountA, uint256 amountB, uint256 lpTokens) = _uniswapRouter
            .addLiquidity(
                address(this),
                pairToken,
                balanceOf(address(this)),
                IERC20(pairToken).balanceOf(address(this)),
                0,
                0,
                address(this),
                block.timestamp
            );

        emit InitialLiquidityAdded(amountA, amountB, lpTokens);

        // We now set this to false so that future transactions can be eligibile for autoswaps
        _autoSwapInProgress = false;

        IERC20(uniswapV2Pair).transfer(lpOwner, lpTokens);
    }

    /**
     * @dev function {isLiquidityPool}
     *
     * Return if an address is a liquidity pool
     *
     * @param queryAddress_ The address being queried
     * @return bool The address is / isn't a liquidity pool
     */
    function isLiquidityPool(address queryAddress_) public view returns (bool) {
        /** @dev We check the uniswapV2Pair address first as this is an immutable variable and therefore does not need
         * to be fetched from storage, saving gas if this address IS the uniswapV2Pool. We also add this address
         * to the enumerated set for ease of reference (for example it is returned in the getter), and it does
         * not add gas to any other calls, that still complete in 0(1) time.
         */
        return (queryAddress_ == uniswapV2Pair ||
            _liquidityPools.contains(queryAddress_));
    }

    /**
     * @dev function {liquidityPools}
     *
     * Returns a list of all liquidity pools
     *
     * @return liquidityPools_ a list of all liquidity pools
     */
    function liquidityPools()
        external
        view
        returns (address[] memory liquidityPools_)
    {
        return (_liquidityPools.values());
    }

    /**
     * @dev function {addLiquidityPool} onlyOwnerOrFactory
     *
     * Allows the manager to add a liquidity pool to the pool enumerable set
     *
     * @param newLiquidityPool_ The address of the new liquidity pool
     */
    function addLiquidityPool(
        address newLiquidityPool_
    ) public onlyOwnerOrFactory {
        // Don't allow calls that didn't pass an address:
        if (newLiquidityPool_ == address(0)) {
            revert LiquidityPoolCannotBeAddressZero();
        }
        // Only allow smart contract addresses to be added, as only these can be pools:
        if (newLiquidityPool_.code.length == 0) {
            revert LiquidityPoolMustBeAContractAddress();
        }
        // Add this to the enumerated list:
        _liquidityPools.add(newLiquidityPool_);
        emit LiquidityPoolAdded(newLiquidityPool_);
    }

    /**
     * @dev function {removeLiquidityPool} onlyOwnerOrFactory
     *
     * Allows the manager to remove a liquidity pool
     *
     * @param removedLiquidityPool_ The address of the old removed liquidity pool
     */
    function removeLiquidityPool(
        address removedLiquidityPool_
    ) external onlyOwnerOrFactory {
        // Remove this from the enumerated list:
        _liquidityPools.remove(removedLiquidityPool_);
        emit LiquidityPoolRemoved(removedLiquidityPool_);
    }

    /**
     * @dev function {isValidCaller}
     *
     * Return if an address is a valid caller
     *
     * @param queryHash_ The code hash being queried
     * @return bool The address is / isn't a valid caller
     */
    function isValidCaller(bytes32 queryHash_) public view returns (bool) {
        return (_validCallerCodeHashes.contains(queryHash_));
    }

    /**
     * @dev function {validCallers}
     *
     * Returns a list of all valid caller code hashes
     *
     * @return validCallerHashes_ a list of all valid caller code hashes
     */
    function validCallers()
        external
        view
        returns (bytes32[] memory validCallerHashes_)
    {
        return (_validCallerCodeHashes.values());
    }

    /**
     * @dev function {addValidCaller} onlyOwnerOrFactory
     *
     * Allows the owner to add the hash of a valid caller
     *
     * @param newValidCallerHash_ The hash of the new valid caller
     */
    function addValidCaller(
        bytes32 newValidCallerHash_
    ) external onlyOwnerOrFactory {
        _validCallerCodeHashes.add(newValidCallerHash_);
        emit ValidCallerAdded(newValidCallerHash_);
    }

    /**
     * @dev function {removeValidCaller} onlyOwnerOrFactory
     *
     * Allows the owner to remove a valid caller
     *
     * @param removedValidCallerHash_ The hash of the old removed valid caller
     */
    function removeValidCaller(
        bytes32 removedValidCallerHash_
    ) external onlyOwnerOrFactory {
        // Remove this from the enumerated list:
        _validCallerCodeHashes.remove(removedValidCallerHash_);
        emit ValidCallerRemoved(removedValidCallerHash_);
    }

    /**
     * @dev function {setProjectTaxRecipient} onlyOwnerOrFactory
     *
     * Allows the manager to set the project tax recipient address
     *
     * @param projectTaxRecipient_ New recipient address
     */
    function setProjectTaxRecipient(
        address projectTaxRecipient_
    ) external onlyOwnerOrFactory {
        projectTaxRecipient = projectTaxRecipient_;
        emit ProjectTaxRecipientUpdated(projectTaxRecipient_);
    }

    /**
     * @dev function {setSwapThresholdBasisPoints} onlyOwnerOrFactory
     *
     * Allows the manager to set the autoswap threshold
     *
     * @param swapThresholdBasisPoints_ New swap threshold in basis points
     */
    function setSwapThresholdBasisPoints(
        uint16 swapThresholdBasisPoints_
    ) external onlyOwnerOrFactory {
        uint256 oldswapThresholdBasisPoints = swapThresholdBasisPoints;
        swapThresholdBasisPoints = swapThresholdBasisPoints_;
        emit AutoSwapThresholdUpdated(
            oldswapThresholdBasisPoints,
            swapThresholdBasisPoints_
        );
    }

    /**
     * @dev function {setProjectTaxRates} onlyOwnerOrFactory
     *
     * Change the tax rates, subject to only ever decreasing
     *
     * @param newProjectBuyTaxBasisPoints_ The new buy tax rate
     * @param newProjectSellTaxBasisPoints_ The new sell tax rate
     */
    function setProjectTaxRates(
        uint16 newProjectBuyTaxBasisPoints_,
        uint16 newProjectSellTaxBasisPoints_
    ) external onlyOwnerOrFactory {
        uint16 oldBuyTaxBasisPoints = projectBuyTaxBasisPoints;
        uint16 oldSellTaxBasisPoints = projectSellTaxBasisPoints;

        projectBuyTaxBasisPoints = newProjectBuyTaxBasisPoints_;
        projectSellTaxBasisPoints = newProjectSellTaxBasisPoints_;

        emit ProjectTaxBasisPointsChanged(
            oldBuyTaxBasisPoints,
            newProjectBuyTaxBasisPoints_,
            oldSellTaxBasisPoints,
            newProjectSellTaxBasisPoints_
        );
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual override returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual override returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5.05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the default value returned by this function, unless
     * it's overridden.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev totalBuyTaxBasisPoints
     *
     * Provide easy to view tax total:
     */
    function totalBuyTaxBasisPoints() public view returns (uint256) {
        return projectBuyTaxBasisPoints;
    }

    /**
     * @dev totalSellTaxBasisPoints
     *
     * Provide easy to view tax total:
     */
    function totalSellTaxBasisPoints() public view returns (uint256) {
        return projectSellTaxBasisPoints;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(
        address account
    ) public view virtual override returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(
        address to,
        uint256 amount
    ) public virtual override(IERC20) returns (bool) {
        address owner = _msgSender();
        _transfer(
            owner,
            to,
            amount,
            (isLiquidityPool(owner) || isLiquidityPool(to))
        );
        return true;
    }

    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(
        address owner,
        address spender
    ) public view virtual override returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * NOTE: If `amount` is the maximum `uint256`, the allowance is not updated on
     * `transferFrom`. This is semantically equivalent to an infinite approval.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(
        address spender,
        uint256 amount
    ) public virtual override returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, amount);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     *
     * Requirements:
     *
     * - `from` and `to` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     * - the caller must have allowance for ``from``'s tokens of at least
     * `amount`.
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        _transfer(
            from,
            to,
            amount,
            (isLiquidityPool(from) || isLiquidityPool(to))
        );
        return true;
    }

    /**
     * @dev Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function increaseAllowance(
        address spender,
        uint256 addedValue
    ) public virtual returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, allowance(owner, spender) + addedValue);
        return true;
    }

    /**
     * @dev Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least
     * `subtractedValue`.
     */
    function decreaseAllowance(
        address spender,
        uint256 subtractedValue
    ) public virtual returns (bool) {
        address owner = _msgSender();
        uint256 currentAllowance = allowance(owner, spender);
        if (currentAllowance < subtractedValue) {
            revert AllowanceDecreasedBelowZero();
        }
        unchecked {
            _approve(owner, spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    /**
     * @dev Moves `amount` of tokens from `from` to `to`.
     *
     * This internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     */
    function _transfer(
        address from,
        address to,
        uint256 amount,
        bool applyTax
    ) internal virtual {
        _beforeTokenTransfer(from, to, amount);

        // Perform pre-tax validation (e.g. amount doesn't exceed balance, max txn amount)
        uint256 fromBalance = _pretaxValidationAndLimits(from, to, amount);

        // Perform autoswap if eligible
        _autoSwap(from, to);

        // Process taxes
        uint256 amountMinusTax = _taxProcessing(applyTax, to, from, amount);

        _balances[from] = fromBalance - amount;
        _balances[to] += amountMinusTax;

        emit Transfer(from, to, amountMinusTax);

        _afterTokenTransfer(from, to, amount);
    }

    /**
     * @dev function {_pretaxValidationAndLimits}
     *
     * Perform validation on pre-tax amounts
     *
     * @param from_ From address for the transaction
     * @param to_ To address for the transaction
     * @param amount_ Amount of the transaction
     */
    function _pretaxValidationAndLimits(
        address from_,
        address to_,
        uint256 amount_
    ) internal view returns (uint256 fromBalance_) {
        // This can't be a transfer to the liquidity pool before the funding date
        // UNLESS the from address is this contract. This ensures that the initial
        // LP funding transaction is from this contract using the supply of tokens
        // designated for the LP pool, and therefore the initial price in the pool
        // is being set as expected.
        //
        // This protects from, for example, tokens from a team minted supply being
        // paired with ETH and added to the pool, setting the initial price, BEFORE
        // the initial liquidity is added through this contract.
        if (to_ == uniswapV2Pair && from_ != address(this) && fundedDate == 0) {
            revert InitialLiquidityNotYetAdded();
        }

        if (from_ == address(0)) {
            revert TransferFromZeroAddress();
        }

        if (to_ == address(0)) {
            revert TransferToZeroAddress();
        }

        fromBalance_ = _balances[from_];

        if (fromBalance_ < amount_) {
            revert TransferAmountExceedsBalance();
        }

        return (fromBalance_);
    }

    /**
     * @dev function {_taxProcessing}
     *
     * Perform tax processing
     *
     * @param applyTax_ Do we apply tax to this transaction?
     * @param to_ The reciever of the token
     * @param from_ The sender of the token
     * @param sentAmount_ The amount being send
     * @return amountLessTax_ The amount that will be recieved, i.e. the send amount minus tax
     */
    function _taxProcessing(
        bool applyTax_,
        address to_,
        address from_,
        uint256 sentAmount_
    ) internal returns (uint256 amountLessTax_) {
        amountLessTax_ = sentAmount_;
        unchecked {
            if (_tokenHasTax && applyTax_ && !_autoSwapInProgress) {
                uint256 tax;

                // on sell
                if (isLiquidityPool(to_) && totalSellTaxBasisPoints() > 0) {
                    if (projectSellTaxBasisPoints > 0) {
                        uint256 projectTax = ((sentAmount_ *
                            projectSellTaxBasisPoints) / BP_DENOM);
                        projectTaxPendingSwap += uint128(projectTax);
                        tax += projectTax;
                    }
                }
                // on buy
                else if (
                    isLiquidityPool(from_) && totalBuyTaxBasisPoints() > 0
                ) {
                    if (projectBuyTaxBasisPoints > 0) {
                        uint256 projectTax = ((sentAmount_ *
                            projectBuyTaxBasisPoints) / BP_DENOM);
                        projectTaxPendingSwap += uint128(projectTax);
                        tax += projectTax;
                    }
                }

                if (tax > 0) {
                    _balances[address(this)] += tax;
                    emit Transfer(from_, address(this), tax);
                    amountLessTax_ -= tax;
                }
            }
        }
        return (amountLessTax_);
    }

    /**
     * @dev function {_autoSwap}
     *
     * Automate the swap of accumulated tax fees to native token
     *
     * @param from_ The sender of the token
     * @param to_ The recipient of the token
     */

    function _autoSwap(address from_, address to_) internal {
        if (_tokenHasTax) {
            uint256 contractBalance = balanceOf(address(this));
            uint256 swapBalance = contractBalance;

            uint256 swapThresholdInTokens = (_totalSupply *
                swapThresholdBasisPoints) / BP_DENOM;

            if (
                _eligibleForSwap(from_, to_, swapBalance, swapThresholdInTokens)
            ) {
                // Store that a swap back is in progress:
                _autoSwapInProgress = true;
                // Check if we need to reduce the amount of tokens for this swap:
                if (
                    swapBalance >
                    swapThresholdInTokens * MAX_SWAP_THRESHOLD_MULTIPLE
                ) {
                    swapBalance =
                        swapThresholdInTokens *
                        MAX_SWAP_THRESHOLD_MULTIPLE;
                }
                // Perform the auto swap to pair token
                _swapTax(swapBalance, contractBalance);
                // Flag that the autoswap is complete:
                _autoSwapInProgress = false;
            }
        }
    }

    /**
     * @dev function {_eligibleForSwap}
     *
     * Is the current transfer eligible for autoswap
     *
     * @param from_ The sender of the token
     * @param to_ The recipient of the token
     * @param taxBalance_ The current accumulated tax balance
     * @param swapThresholdInTokens_ The swap threshold as a token amount
     */
    function _eligibleForSwap(
        address from_,
        address to_,
        uint256 taxBalance_,
        uint256 swapThresholdInTokens_
    ) internal view returns (bool) {
        return (taxBalance_ >= swapThresholdInTokens_ &&
            !_autoSwapInProgress &&
            !isLiquidityPool(from_) &&
            from_ != address(_uniswapRouter) &&
            to_ != address(_uniswapRouter));
    }

    /**
     * @dev function {_swapTax}
     *
     * Swap tokens taken as tax for pair token
     *
     * @param swapBalance_ The current accumulated tax balance to swap
     * @param contractBalance_ The current accumulated total tax balance
     */
    function _swapTax(uint256 swapBalance_, uint256 contractBalance_) internal {
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = pairToken;

        // Wrap external calls in try / catch to handle errors
        try
            _uniswapRouter
                .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    swapBalance_,
                    0,
                    path,
                    projectTaxRecipient,
                    block.timestamp + 600
                )
        {
            // We will not have swapped all tax tokens IF the amount was greater than the max auto swap.
            // We therefore cannot just set the pending swap counters to 0. Instead, in this scenario,
            // we must reduce them in proportion to the swap amount vs the remaining balance + swap
            // amount.
            //
            // For example:
            //  * swap Balance is 250
            //  * contract balance is 385.
            //  * projectTaxPendingSwap is 300
            //
            // The new total for the projectTaxPendingSwap is:
            //   = 300 - ((300 * 250) / 385)
            //   = 300 - 194
            //   = 106

            if (swapBalance_ < contractBalance_) {
                projectTaxPendingSwap -= uint128(
                    (projectTaxPendingSwap * swapBalance_) / contractBalance_
                );
            } else {
                projectTaxPendingSwap = 0;
            }
        } catch {
            // Dont allow a failed external call (in this case to uniswap) to stop a transfer.
            // Emit that this has occured and continue.
            emit ExternalCallError(5);
        }
    }

    /**
     * @dev distributeTaxTokens
     *
     * Allows the distribution of tax tokens to the designated recipient(s)
     *
     * As part of standard processing the tax token balance being above the threshold
     * will trigger an autoswap to ETH and distribution of this ETH to the designated
     * recipients. This is automatic and there is no need for user involvement.
     *
     * As part of this swap there are a number of calculations performed, particularly
     * if the tax balance is above MAX_SWAP_THRESHOLD_MULTIPLE.
     *
     * Testing indicates that these calculations are safe. But given the data / code
     * interactions it remains possible that some edge case set of scenarios may cause
     * an issue with these calculations.
     *
     * This method is therefore provided as a 'fallback' option to safely distribute
     * accumulated taxes from the contract, with a direct transfer of the ERC20 tokens
     * themselves.
     */
    function distributeTaxTokens() external {
        if (projectTaxPendingSwap > 0) {
            uint256 projectDistribution = projectTaxPendingSwap;
            projectTaxPendingSwap = 0;
            _transfer(
                address(this),
                projectTaxRecipient,
                projectDistribution,
                false
            );
        }
    }

    /**
     * @dev function {withdrawETH} onlyOwnerOrFactory
     *
     * A withdraw function to allow ETH to be withdrawn by the manager
     *
     * This contract should never hold ETH. The only envisaged scenario where
     * it might hold ETH is a failed autoswap where the uniswap swap has completed,
     * the recipient of ETH reverts, the contract then wraps to WETH and the
     * wrap to WETH fails.
     *
     * This feels unlikely. But, for safety, we include this method.
     *
     * @param amount_ The amount to withdraw
     */
    function withdrawETH(uint256 amount_) external onlyOwnerOrFactory {
        (bool success, ) = _msgSender().call{value: amount_}("");
        if (!success) {
            revert TransferFailed();
        }
    }

    /**
     * @dev function {withdrawERC20} onlyOwnerOrFactory
     *
     * A withdraw function to allow ERC20s (except address(this)) to be withdrawn.
     *
     * This contract should never hold ERC20s other than tax tokens. The only envisaged
     * scenario where it might hold an ERC20 is a failed autoswap where the uniswap swap
     * has completed, the recipient of ETH reverts, the contract then wraps to WETH, the
     * wrap to WETH succeeds, BUT then the transfer of WETH fails.
     *
     * This feels even less likely than the scenario where ETH is held on the contract.
     * But, for safety, we include this method.
     *
     * @param token_ The ERC20 contract
     * @param amount_ The amount to withdraw
     */
    function withdrawERC20(
        address token_,
        uint256 amount_
    ) external onlyOwnerOrFactory {
        if (token_ == address(this)) {
            revert CannotWithdrawThisToken();
        }
        IERC20(token_).safeTransfer(_msgSender(), amount_);
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     */
    function _mint(address account, uint256 amount) internal virtual {
        if (account == address(0)) {
            revert MintToZeroAddress();
        }

        _beforeTokenTransfer(address(0), account, amount);

        _totalSupply += uint128(amount);
        unchecked {
            // Overflow not possible: balance + amount is at most totalSupply + amount, which is checked above.
            _balances[account] += amount;
        }
        emit Transfer(address(0), account, amount);

        _afterTokenTransfer(address(0), account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, reducing the
     * total supply.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     * - `account` must have at least `amount` tokens.
     */
    function _burn(address account, uint256 amount) internal virtual {
        if (account == address(0)) {
            revert BurnFromTheZeroAddress();
        }

        _beforeTokenTransfer(account, address(0), amount);

        uint256 accountBalance = _balances[account];
        if (accountBalance < amount) {
            revert BurnExceedsBalance();
        }

        unchecked {
            _balances[account] = accountBalance - amount;
            // Overflow not possible: amount <= accountBalance <= totalSupply.
            _totalSupply -= uint128(amount);
        }

        emit Transfer(account, address(0), amount);

        _afterTokenTransfer(account, address(0), amount);
    }

    /**
     * @dev Sets `amount` as the allowance of `spender` over the `owner` s tokens.
     *
     * This internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     */
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        if (owner == address(0)) {
            revert ApproveFromTheZeroAddress();
        }

        if (spender == address(0)) {
            revert ApproveToTheZeroAddress();
        }

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /**
     * @dev Updates `owner` s allowance for `spender` based on spent `amount`.
     *
     * Does not update the allowance amount in case of infinite allowance.
     * Revert if not enough allowance is available.
     *
     * Might emit an {Approval} event.
     */
    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        uint256 currentAllowance = allowance(owner, spender);
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) {
                revert InsufficientAllowance();
            }

            unchecked {
                _approve(owner, spender, currentAllowance - amount);
            }
        }
    }

    /**
     * @dev Destroys a `value` amount of tokens from the caller.
     *
     * See {ERC20-_burn}.
     */
    function burn(uint256 value) public virtual {
        _burn(_msgSender(), value);
    }

    /**
     * @dev Destroys a `value` amount of tokens from `account`, deducting from
     * the caller's allowance.
     *
     * See {ERC20-_burn} and {ERC20-allowance}.
     *
     * Requirements:
     *
     * - the caller must have allowance for ``accounts``'s tokens of at least
     * `value`.
     */
    function burnFrom(address account, uint256 value) public virtual {
        _spendAllowance(account, _msgSender(), value);
        _burn(account, value);
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * will be transferred to `to`.
     * - when `from` is zero, `amount` tokens will be minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
     * - `from` and `to` are never both zero.
     *
     * To learn more about hooks, head to xref:ROOT:extending-contracts.adoc#using-hooks[Using Hooks].
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}

    /**
     * @dev Hook that is called after any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * has been transferred to `to`.
     * - when `from` is zero, `amount` tokens have been minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens have been burned.
     * - `from` and `to` are never both zero.
     *
     * To learn more about hooks, head to xref:ROOT:extending-contracts.adoc#using-hooks[Using Hooks].
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}

    receive() external payable {}
}
