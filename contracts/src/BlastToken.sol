// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title BLAST — MinerBlast utility token
/// @notice Fixed max supply of 1 billion. Game reward emission is done
///         exclusively by the RewardVault (MINTER_ROLE); treasury/team/
///         liquidity allocations are minted at deploy to the admin vault.
contract BlastToken is ERC20, ERC20Burnable, ERC20Capped, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public constant MAX_SUPPLY = 1_000_000_000e18;
    /// @dev 55% of supply: treasury (20%), team (15%), liquidity (10%), marketing (10%).
    ///      The remaining 45% can only be created via MINTER_ROLE (game rewards).
    uint256 public constant INITIAL_ALLOCATION = 550_000_000e18;

    constructor(address admin) ERC20("MinerBlast", "BLAST") ERC20Capped(MAX_SUPPLY) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _mint(admin, INITIAL_ALLOCATION);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Capped)
    {
        super._update(from, to, value);
    }
}
