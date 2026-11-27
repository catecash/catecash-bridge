// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local wCAT wrapper for native SmartCatecash CATE; 1 token atom = 1 PoW CATE atom.
contract WrappedSmartCATE is ERC20 {
    uint256 public constant WEI_PER_CATE_ATOM = 10 ** 10;

    constructor() ERC20("Wrapped SmartCatecash", "wCAT") {}

    function decimals() public pure override returns (uint8) { return 8; }

    function deposit() external payable {
        require(msg.value > 0 && msg.value % WEI_PER_CATE_ATOM == 0, "non-atomic amount");
        _mint(msg.sender, msg.value / WEI_PER_CATE_ATOM);
    }

    function withdraw(uint256 amountAtoms) external {
        require(amountAtoms > 0, "zero amount");
        _burn(msg.sender, amountAtoms);
        (bool sent, ) = payable(msg.sender).call{value: amountAtoms * WEI_PER_CATE_ATOM}("");
        require(sent, "unwrap transfer failed");
    }
}
