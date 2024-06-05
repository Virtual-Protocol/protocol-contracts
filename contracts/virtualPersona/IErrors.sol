// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IErrors {
  enum BondingCurveErrorType {
    OK, //                                                  No error
    INVALID_NUMITEMS, //                                    The numItem value is 0
    SPOT_PRICE_OVERFLOW //                                  The updated spot price doesn't fit into 128 bits
  }

  error AdapterParamsMustBeEmpty(); //                      The adapter parameters on this LZ call must be empty.

  error AdditionToPoolIsBelowPerTransactionMinimum(); //    The contribution amount is less than the minimum.

  error AdditionToPoolWouldExceedPoolCap(); //              This addition to the pool would exceed the pool cap.

  error AdditionToPoolWouldExceedPerAddressCap(); //        This addition to the pool would exceed the per address cap.

  error AddressAlreadySet(); //                             The address being set can only be set once, and is already non-0.

  error AllowanceDecreasedBelowZero(); //                   You cannot decrease the allowance below zero.

  error AlreadyInitialised(); //                            The contract is already initialised: it cannot be initialised twice!

  error ApprovalCallerNotOwnerNorApproved(); //             The caller must own the token or be an approved operator.

  error ApproveFromTheZeroAddress(); //                     Approval cannot be called from the zero address (indeed, how have you??).

  error ApproveToTheZeroAddress(); //                       Approval cannot be given to the zero address.

  error ApprovalQueryForNonexistentToken(); //              The token does not exist.

  error AuctionStatusIsNotEnded(); //                       Throw if the action required the auction to be closed, and it isn't.

  error AuctionStatusIsNotOpen(); //                        Throw if the action requires the auction to be open, and it isn't.

  error AuxCallFailed(
    address[] modules,
    uint256 value,
    bytes data,
    uint256 txGas
  ); //                                                     An auxilliary call from the drop factory failed.

  error BalanceMismatch(); //                               An error when comparing balance amounts.

  error BalanceQueryForZeroAddress(); //                    Cannot query the balance for the zero address.

  error BidMustBeBelowTheFloorWhenReducingQuantity(); //    Only bids that are below the floor can reduce the quantity of the bid.

  error BidMustBeBelowTheFloorForRefundDuringAuction(); //  Only bids that are below the floor can be refunded during the auction.

  error BondingCurveError(BondingCurveErrorType error); //  An error of the type specified has occured in bonding curve processing.

  error BurnExceedsBalance(); //                            The amount you have selected to burn exceeds the addresses balance.

  error BurnFromTheZeroAddress(); //                        Tokens cannot be burned from the zero address. (Also, how have you called this!?!)

  error CallerIsNotDepositBoxOwner(); //                    The caller is not the owner of the deposit box.

  error CallerIsNotFactory(); //                            The caller of this function must match the factory address in storage.

  error CallerIsNotFactoryOrProjectOwner(); //              The caller of this function must match the factory address OR project owner address.

  error CallerIsNotFactoryProjectOwnerOrPool(); //          The caller of this function must match the factory address, project owner or pool address.

  error CallerIsNotTheOwner(); //                           The caller is not the owner of this contract.

  error CallerIsNotTheManager(); //                         The caller is not the manager of this contract.

  error CallerMustBeLzApp(); //                             The caller must be an LZ application.

  error CallerIsNotPlatformAdmin(address caller); //        The caller of this function must be part of the platformAdmin group.

  error CallerIsNotSuperAdmin(address caller); //           The caller of this function must match the superAdmin address in storage.

  error CannotAddLiquidityOnCreateAndUseDRIPool(); //       Cannot use both liquidity added on create and a DRIPool in the same token.

  error CannotSetNewOwnerToTheZeroAddress(); //             You can't set the owner of this contract to the zero address (address(0)).

  error CannotSetToZeroAddress(); //                        The corresponding address cannot be set to the zero address (address(0)).

  error CannotSetNewManagerToTheZeroAddress(); //           Cannot transfer the manager to the zero address (address(0)).

  error CannotWithdrawThisToken(); //                       Cannot withdraw the specified token.

  error CanOnlyReduce(); //                                 The given operation can only reduce the value specified.

  error CollectionAlreadyRevealed(); //                     The collection is already revealed; you cannot call reveal again.

  error ContractIsDecommissioned(); //                      This contract is decommissioned!

  error ContractIsPaused(); //                              The call requires the contract to be unpaused, and it is paused.

  error ContractIsNotPaused(); //                           The call required the contract to be paused, and it is NOT paused.

  error DecreasedAllowanceBelowZero(); //                   The request would decrease the allowance below zero, and that is not allowed.

  error DestinationIsNotTrustedSource(); //                 The destination that is being called through LZ has not been set as trusted.

  error DeployerOnly(); //                                  This method can only be called by the deployer address.

  error DeploymentError(); //                               Error on deployment.

  error DepositBoxIsNotOpen(); //                           This action cannot complete as the deposit box is not open.

  error DriPoolAddressCannotBeAddressZero(); //             The Dri Pool address cannot be the zero address.

  error GasLimitIsTooLow(); //                              The gas limit for the LayerZero call is too low.

  error IncorrectConfirmationValue(); //                    You need to enter the right confirmation value to call this funtion (usually 69420).

  error IncorrectPayment(); //                              The function call did not include passing the correct payment.

  error InitialLiquidityAlreadyAdded(); //                  Initial liquidity has already been added. You can't do it again.

  error InitialLiquidityNotYetAdded(); //                   Initial liquidity needs to have been added for this to succedd.

  error InsufficientAllowance(); //                         There is not a high enough allowance for this operation.

  error InvalidAdapterParams(); //                          The current adapter params for LayerZero on this contract won't work :(.

  error InvalidAddress(); //                                An address being processed in the function is not valid.

  error InvalidEndpointCaller(); //                         The calling address is not a valid LZ endpoint. The LZ endpoint was set at contract creation
  //                                                        and cannot be altered after. Check the address LZ endpoint address on the contract.

  error InvalidMinGas(); //                                 The minimum gas setting for LZ in invalid.

  error InvalidOracleSignature(); //                        The signature provided with the contract call is not valid, either in format or signer.

  error InvalidPayload(); //                                The LZ payload is invalid

  error InvalidReceiver(); //                               The address used as a target for funds is not valid.

  error InvalidSourceSendingContract(); //                  The LZ message is being related from a source contract on another chain that is NOT trusted.

  error InvalidTotalShares(); //                            Total shares must equal 100 percent in basis points.

  error LimitsCanOnlyBeRaised(); //                          Limits are UP ONLY.

  error ListLengthMismatch(); //                            Two or more lists were compared and they did not match length.

  error LiquidityPoolMustBeAContractAddress(); //           Cannot add a non-contract as a liquidity pool.

  error LiquidityPoolCannotBeAddressZero(); //              Cannot add a liquidity pool from the zero address.

  error LPLockUpMustFitUint88(); //                         LP lockup is held in a uint88, so must fit.

  error NoTrustedPathRecord(); //                           LZ needs a trusted path record for this to work. What's that, you ask?

  error MachineAddressCannotBeAddressZero(); //             Cannot set the machine address to the zero address.

  error ManagerUnauthorizedAccount(); //                    The caller is not the pending manager.

  error MaxBidQuantityIs255(); //                           Validation: as we use a uint8 array to track bid positions the max bid quantity is 255.

  error MaxPublicMintAllowanceExceeded(
    uint256 requested,
    uint256 alreadyMinted,
    uint256 maxAllowance
  ); //                                                     The calling address has requested a quantity that would exceed the max allowance.

  error MaxSupplyTooHigh(); //                              Max supply must fit in a uint128.

  error MaxTokensPerWalletExceeded(); //                    The transfer would exceed the max tokens per wallet limit.

  error MaxTokensPerTxnExceeded(); //                       The transfer would exceed the max tokens per transaction limit.

  error MetadataIsLocked(); //                              The metadata on this contract is locked; it cannot be altered!

  error MinGasLimitNotSet(); //                             The minimum gas limit for LayerZero has not been set.

  error MintERC2309QuantityExceedsLimit(); //               The `quantity` minted with ERC2309 exceeds the safety limit.

  error MintingIsClosedForever(); //                        Minting is, as the error suggests, so over (and locked forever).

  error MintToZeroAddress(); //                             Cannot mint to the zero address.

  error MintZeroQuantity(); //                              The quantity of tokens minted must be more than zero.

  error NewBuyTaxBasisPointsExceedsMaximum(); //            Project owner trying to set the tax rate too high.

  error NewSellTaxBasisPointsExceedsMaximum(); //           Project owner trying to set the tax rate too high.

  error NoETHForLiquidityPair(); //                         No ETH has been provided for the liquidity pair.

  error TaxPeriodStillInForce(); //                         The minimum tax period has not yet expired.

  error NoPaymentDue(); //                                  No payment is due for this address.

  error NoRefundForCaller(); //                             Error thrown when the calling address has no refund owed.

  error NoStoredMessage(); //                               There is no stored message matching the passed parameters.

  error NothingToClaim(); //                                The calling address has nothing to claim.

  error NoTokenForLiquidityPair(); //                       There is no token to add to the LP.

  error OperationDidNotSucceed(); //                        The operation failed (vague much?).

  error OracleSignatureHasExpired(); //                     A signature has been provided but it is too old.

  error OwnershipNotInitializedForExtraData(); //           The `extraData` cannot be set on an uninitialized ownership slot.

  error OwnerQueryForNonexistentToken(); //                 The token does not exist.

  error CallerIsNotAdminNorFactory();   //                  The caller of this function must match the factory address or be an admin.

  error ParametersDoNotMatchSignedMessage(); //             The parameters passed with the signed message do not match the message itself.

  error ParamTooLargeStartDate(); //                        The passed parameter exceeds the var type max.

  error ParamTooLargeEndDate(); //                          The passed parameter exceeds the var type max.

  error ParamTooLargeMinETH(); //                           The passed parameter exceeds the var type max.

  error ParamTooLargePerAddressMax(); //                    The passed parameter exceeds the var type max.

  error ParamTooLargeVestingDays(); //                      The passed parameter exceeds the var type max.

  error ParamTooLargePoolSupply(); //                       The passed parameter exceeds the var type max.

  error ParamTooLargePoolPerTxnMinETH(); //                 The passed parameter exceeds the var type max.

  error PassedConfigDoesNotMatchApproved(); //              The config provided on the call does not match the approved config.

  error PauseCutOffHasPassed(); //                          The time period in which we can pause has passed; this contract can no longer be paused.

  error PaymentMustCoverPerMintFee(); //                    The payment passed must at least cover the per mint fee for the quantity requested.

  error PermitDidNotSucceed(); //                           The safeERC20 permit failed.

  error PlatformAdminCannotBeAddressZero(); //              We cannot use the zero address (address(0)) as a platformAdmin.

  error PlatformTreasuryCannotBeAddressZero(); //           The treasury address cannot be set to the zero address.

  error PoolIsAboveMinimum(); //                            You required the pool to be below the minimum, and it is not

  error PoolIsBelowMinimum(); //                            You required the pool to be above the minimum, and it is not

  error PoolPhaseIsClosed(); //                             The block.timestamp is either before the pool is open or after it is closed.

  error PoolPhaseIsNotAfter(); //                           The block.timestamp is either before or during the pool open phase.

  error PoolVestingNotYetComplete(); //                     Tokens in the pool are not yet vested.

  error ProjectOwnerCannotBeAddressZero(); //               The project owner has to be a non zero address.

  error ProofInvalid(); //                                  The provided proof is not valid with the provided arguments.

  error QuantityExceedsRemainingCollectionSupply(); //      The requested quantity would breach the collection supply.

  error QuantityExceedsRemainingPhaseSupply(); //           The requested quantity would breach the phase supply.

  error QuantityExceedsMaxPossibleCollectionSupply(); //    The requested quantity would breach the maximum trackable supply

  error ReferralIdAlreadyUsed(); //                         This referral ID has already been used; they are one use only.

  error RequestingMoreThanAvailableBalance(); //             The request exceeds the available balance.

  error RequestingMoreThanRemainingAllocation(
    uint256 previouslyMinted,
    uint256 requested,
    uint256 remainingAllocation
  ); //                                                     Number of tokens requested for this mint exceeds the remaining allocation (taking the
  //                                                        original allocation from the list and deducting minted tokens).

  error RoyaltyFeeWillExceedSalePrice(); //                 The ERC2981 royalty specified will exceed the sale price.

  error ShareTotalCannotBeZero(); //                        The total of all the shares cannot be nothing.

  error SliceOutOfBounds(); //                              The bytes slice operation was out of bounds.

  error SliceOverflow(); //                                 The bytes slice operation overlowed.

  error SuperAdminCannotBeAddressZero(); //                 The superAdmin cannot be the sero address (address(0)).

  error SupplyTotalMismatch(); //                           The sum of the team supply and lp supply does not match.

  error SupportWindowIsNotOpen(); //                        The project owner has not requested support within the support request expiry window.

  error TaxFreeAddressCannotBeAddressZero(); //             A tax free address cannot be address(0)

  error TemplateCannotBeAddressZero(); //                   The address for a template cannot be address zero (address(0)).

  error TemplateNotFound(); //                              There is no template that matches the passed template Id.

  error ThisMintIsClosed(); //                              It's over (well, this mint is, anyway).

  error TotalSharesMustMatchDenominator(); //               The total of all shares must equal the denominator value.

  error TransferAmountExceedsBalance(); //                  The transfer amount exceeds the accounts available balance.

  error TransferCallerNotOwnerNorApproved(); //             The caller must own the token or be an approved operator.

  error TransferFailed(); //                                The transfer has failed.

  error TransferFromIncorrectOwner(); //                    The token must be owned by `from`.

  error TransferToNonERC721ReceiverImplementer(); //        Cannot safely transfer to a contract that does not implement the ERC721Receiver interface.

  error TransferFromZeroAddress(); //                       Cannot transfer from the zero address. Indeed, this surely is impossible, and likely a waste to check??

  error TransferToZeroAddress(); //                         Cannot transfer to the zero address.

  error UnrecognisedVRFMode(); //                           Currently supported VRF modes are 0: chainlink and 1: arrng

  error URIQueryForNonexistentToken(); //                   The token does not exist.

  error ValueExceedsMaximum(); //                           The value sent exceeds the maximum allowed (super useful explanation huh?).

  error VRFCoordinatorCannotBeAddressZero(); //             The VRF coordinator cannot be the zero address (address(0)).
}