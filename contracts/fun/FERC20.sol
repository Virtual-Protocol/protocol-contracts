// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../libs/SafeMath.sol";

contract FERC20 is Context, IERC20, Ownable {
    using SafeMath for uint256;

    uint8 private constant _decimals = 18;

    uint256 private _totalSupply;

    string private _name;

    string private _symbol;

    uint public maxTx;

    mapping(address => uint256) private _balances;

    mapping(address => mapping(address => uint256)) private _allowances;

    mapping(address => bool) private isExcludedFromMaxTx;

    event MaxTxUpdated(uint _maxTx);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply,
        uint _maxTx
    ) Ownable(msg.sender) {
        _name = name_;

        _symbol = symbol_;

        _totalSupply = supply * 10 ** _decimals;

        require(_maxTx <= 5, "Max Transaction cannot exceed 5%.");

        maxTx = _maxTx;

        _balances[_msgSender()] = _totalSupply;

        isExcludedFromMaxTx[_msgSender()] = true;

        isExcludedFromMaxTx[address(this)] = true;

        emit Transfer(address(0), _msgSender(), _totalSupply);
    }

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public pure returns (uint8) {
        return _decimals;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    function transfer(
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        _transfer(_msgSender(), recipient, amount);

        return true;
    }

    function allowance(
        address owner,
        address spender
    ) public view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(
        address spender,
        uint256 amount
    ) public override returns (bool) {
        _approve(_msgSender(), spender, amount);

        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        _transfer(sender, recipient, amount);

        _approve(
            sender,
            _msgSender(),
            _allowances[sender][_msgSender()].sub(
                amount,
                "ERC20: transfer amount exceeds allowance"
            )
        );

        return true;
    }

    function _approve(address owner, address spender, uint256 amount) private {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;

        emit Approval(owner, spender, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(amount > 0, "Transfer amount must be greater than zero");

        uint256 maxTxAmount = (maxTx * _totalSupply) / 100;

        if (!isExcludedFromMaxTx[from]) {
            require(amount <= maxTxAmount, "Exceeds the MaxTxAmount.");
        }

        _balances[from] = _balances[from].sub(amount);
        _balances[to] = _balances[to].add(amount);

        emit Transfer(from, to, amount);
    }

    function updateMaxTx(uint256 _maxTx) public onlyOwner {
        require(_maxTx <= 5, "Max Transaction cannot exceed 5%.");

        maxTx = _maxTx;

        emit MaxTxUpdated(_maxTx);
    }

    function excludeFromMaxTx(address user) public onlyOwner {
        require(
            user != address(0),
            "ERC20: Exclude Max Tx from the zero address"
        );

        isExcludedFromMaxTx[user] = true;
    }

    function _burn(address user, uint256 amount) internal {
        require(user != address(0), "Invalid address");
        _balances[user] = _balances[user].sub(amount);
    }

    function burnFrom(address user, uint256 amount) public onlyOwner {
        require(user != address(0), "Invalid address");
        _balances[user] = _balances[user].sub(amount);
        emit Transfer(user, address(0), amount);
    }
}
