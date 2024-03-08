pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Airdrop {
    using SafeERC20 for IERC20;
    
    /**
     *
     * @param _token ERC20 token to airdrop
     * @param _recipients list of recipients
     * @param _amounts list of amounts to send each recipient
     * @param _total total amount to transfer from caller
     */
    function airdrop(
        IERC20 _token,
        address[] calldata _recipients,
        uint256[] calldata _amounts,
        uint256 _total
    ) external {
        // bytes selector for safeTransferFrom(address,address,uint256)
        bytes4 safeFransferFrom = 0x42842e0e;
        // bytes selector for safeTransfer(address,uint256)
        bytes4 safeTransfer = 0x423f6cef;

        assembly {
            // store transferFrom selector
            let transferFromData := add(0x20, mload(0x40))
            mstore(transferFromData, safeFransferFrom)
            // store caller address
            mstore(add(transferFromData, 0x04), caller())
            // store address
            mstore(add(transferFromData, 0x24), address())
            // store _total
            mstore(add(transferFromData, 0x44), _total)
            // call transferFrom for _total
            let successTransferFrom := call(
                gas(),
                _token,
                0,
                transferFromData,
                0x64,
                0,
                0
            )
            // revert if call fails
            if iszero(successTransferFrom) {
                revert(0, 0)
            }

            // store transfer selector
            let transferData := add(0x20, mload(0x40))
            mstore(transferData, safeTransfer)

            // store length of _recipients
            let sz := _amounts.length

            // loop through _recipients
            for {
                let i := 0
            } lt(i, sz) {
                // increment i
                i := add(i, 1)
            } {
                // store offset for _amounts[i]
                let offset := mul(i, 0x20)
                // store _amounts[i]
                let amt := calldataload(add(_amounts.offset, offset))
                // store _recipients[i]
                let recp := calldataload(add(_recipients.offset, offset))
                // store _recipients[i] in transferData
                mstore(
                    add(transferData, 0x04),
                    recp
                )
                // store _amounts[i] in transferData
                mstore(
                    add(transferData, 0x24),
                    amt
                )
                // call transfer for _amounts[i] to _recipients[i]
                let successTransfer := call(
                    gas(),
                    _token,
                    0,
                    transferData,
                    0x44,
                    0,
                    0
                )
                // revert if call fails

                
                if iszero(successTransfer) {
                    revert(0, 0)
                }  
            }
        }

    }
}