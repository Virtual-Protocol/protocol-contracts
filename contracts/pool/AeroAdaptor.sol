// SPDX-License-Identifier: MIT
// This is an adaptor to make aerodrome pool compatible with UniswapRouter v2
pragma solidity ^0.8.20;
import "./IRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAeroRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract AeroAdaptor is IRouter {
    using SafeERC20 for IERC20;

    address public router;
    address public tokenIn;
    address public tokenOut;
    address public factory;

    constructor(
        address router_,
        address tokenIn_,
        address tokenOut_,
        address factory_
    ) {
        router = router_;
        tokenIn = tokenIn_;
        tokenOut = tokenOut_;
        factory = factory_;
        IERC20(tokenIn).forceApprove(router_, type(uint256).max);
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        IAeroRouter.Route[] memory routes = new IAeroRouter.Route[](1);
        routes[0] = IAeroRouter.Route(tokenIn, tokenOut, false, factory);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        amounts = IAeroRouter(router).swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            routes,
            to,
            deadline
        );
    }
}
