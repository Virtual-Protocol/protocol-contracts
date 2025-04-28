pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Airdrop {

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
        // Ensure arrays have same length
        require(_recipients.length == _amounts.length, "Length mismatch");
        
        // Calculate sum of amounts
        uint256 sum;
        for(uint256 i = 0; i < _amounts.length; i++) {
            sum += _amounts[i];
        }
        
        // Verify sum equals total
        require(sum == _total, "Sum != total");

        // bytes selector for transferFrom(address,address,uint256)
        bytes4 transferFrom = 0x23b872dd;
        // bytes selector for transfer(address,uint256)
        bytes4 transfer = 0xa9059cbb;

        assembly {
            // store transferFrom selector
            let transferFromData := add(0x20, mload(0x40))
            mstore(transferFromData, transferFrom)
            // store caller address
            mstore(add(transferFromData, 0x04), caller())
            // store address
            mstore(add(transferFromData, 0x24), address())
            // store _total
            mstore(add(transferFromData, 0x44), _total)
            // call transferFrom for _total

            if iszero(
                and( // The arguments of `and` are evaluated from right to left.
                    or(eq(mload(0x00), 1), iszero(returndatasize())), // Returned 1 or nothing.
                    call(gas(), _token, 0, transferFromData, 0x64, 0x00, 0x20)
                )
            ) {
                revert(0, 0)
            }

            // store transfer selector
            let transferData := add(0x20, mload(0x40))
            mstore(transferData, transfer)

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
                // Perform the transfer, reverting upon failure.
                if iszero(
                    and( // The arguments of `and` are evaluated from right to left.
                        or(eq(mload(0x00), 1), iszero(returndatasize())), // Returned 1 or nothing.
                        call(gas(), _token, 0, transferData, 0x44, 0x00, 0x20)
                    )
                ) {
                    revert(0, 0)
                }  
            }
        }

    }
}