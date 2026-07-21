// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Heroes} from "./Heroes.sol";

/// @title MinerBlast hero fusion/upgrade
/// @notice Raises a hero's level by burning a sacrifice hero of the SAME
///         rarity plus a fee in BLAST (100% burned — token sink).
///         Max level grows with rarity. Requires UPGRADER_ROLE on the
///         Heroes contract.
contract HeroUpgrade is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev launchpad tokens may not be burnable; "burns" go to the dead address
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    Heroes public immutable heroes;
    IERC20 public immutable blast;

    /// @dev base fee; cost = baseFee * target hero's current level
    uint256 public immutable baseFee;

    event HeroFused(
        address indexed owner, uint256 indexed targetId, uint256 burnedId, uint8 newLevel, uint256 fee
    );

    constructor(Heroes heroes_, IERC20 blast_, uint256 baseFee_) {
        heroes = heroes_;
        blast = blast_;
        baseFee = baseFee_;
    }

    /// @notice Max level per rarity: Common 4 ... Mythic 9.
    function maxLevel(uint8 rarity) public pure returns (uint8) {
        return 4 + rarity;
    }

    function fuse(uint256 targetId, uint256 sacrificeId) external nonReentrant {
        require(targetId != sacrificeId, "Upgrade: same ids");
        require(heroes.ownerOf(targetId) == msg.sender, "Upgrade: not target owner");
        require(heroes.ownerOf(sacrificeId) == msg.sender, "Upgrade: not sacrifice owner");

        Heroes.HeroAttributes memory target = heroes.attributesOf(targetId);
        Heroes.HeroAttributes memory sacrifice = heroes.attributesOf(sacrificeId);
        require(target.rarity == sacrifice.rarity, "Upgrade: rarity mismatch");
        require(target.level < maxLevel(target.rarity), "Upgrade: max level");

        uint256 fee = baseFee * target.level;
        blast.safeTransferFrom(msg.sender, BURN_ADDRESS, fee);
        heroes.burn(sacrificeId);
        heroes.levelUp(targetId);

        emit HeroFused(msg.sender, targetId, sacrificeId, target.level + 1, fee);
    }
}
