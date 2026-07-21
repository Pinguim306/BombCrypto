// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Heroes} from "./Heroes.sol";

/// @title MinerBlast hero gacha
/// @notice Sells chests paid in BLAST with commit-reveal randomness:
///         the purchase records a future block and the opening uses that
///         block's blockhash + a salt from the buyer. On mainnet, the plan is
///         to migrate to Chainlink VRF; commit-reveal is the testnet fallback.
///         Per-rarity probabilities are public and fixed at deploy time.
contract Gacha is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Chest {
        address buyer;
        uint64 revealBlock; // first block whose hash can reveal
        bytes32 salt;
        bool opened;
    }

    IERC20 public immutable blast;
    Heroes public immutable heroes;
    address public treasury;

    uint256 public chestPrice;
    /// @dev fraction of the price burned, in basis points (10000 = 100%)
    uint16 public burnBps = 5000;

    /// @dev Cumulative probability per rarity, in bps.
    ///      Common 52%, Rare 26%, SuperRare 12%, Epic 6.5%, Legendary 3%, Mythic 0.5%
    uint16[6] public rarityCumBps = [5200, 7800, 9000, 9650, 9950, 10000];

    uint256 public nextChestId = 1;
    mapping(uint256 chestId => Chest) public chests;

    event ChestBought(uint256 indexed chestId, address indexed buyer, uint64 revealBlock);
    event ChestOpened(uint256 indexed chestId, address indexed buyer, uint256 heroId, uint8 rarity);
    event ChestRerolled(uint256 indexed chestId, uint64 newRevealBlock);

    constructor(IERC20 blast_, Heroes heroes_, address treasury_, uint256 chestPrice_, address admin) {
        blast = blast_;
        heroes = heroes_;
        treasury = treasury_;
        chestPrice = chestPrice_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Buys a chest. The payment is split between burn and treasury.
    function buyChest(bytes32 salt) external nonReentrant returns (uint256 chestId) {
        uint256 burnAmount = (chestPrice * burnBps) / 10000;
        ERC20Burnable(address(blast)).burnFrom(msg.sender, burnAmount);
        blast.safeTransferFrom(msg.sender, treasury, chestPrice - burnAmount);

        chestId = nextChestId++;
        chests[chestId] = Chest({
            buyer: msg.sender,
            revealBlock: uint64(block.number + 2),
            salt: salt,
            opened: false
        });
        emit ChestBought(chestId, msg.sender, uint64(block.number + 2));
    }

    /// @notice Opens the chest and mints the hero. Must be called within 256
    ///         blocks after the revealBlock; after that use `reroll` to renew.
    function openChest(uint256 chestId) external nonReentrant returns (uint256 heroId) {
        Chest storage c = chests[chestId];
        require(c.buyer == msg.sender, "Gacha: not the buyer");
        require(!c.opened, "Gacha: already opened");
        require(block.number > c.revealBlock, "Gacha: wait for reveal block");
        bytes32 bh = blockhash(c.revealBlock);
        require(bh != bytes32(0), "Gacha: reveal expired, use reroll");

        c.opened = true;
        uint256 rand = uint256(keccak256(abi.encodePacked(bh, c.salt, chestId, msg.sender)));

        uint8 rarity = _pickRarity(uint16(rand % 10000));
        Heroes.HeroAttributes memory attrs = _rollAttributes(rarity, rand);
        heroId = heroes.mint(msg.sender, attrs);
        emit ChestOpened(chestId, msg.sender, heroId, rarity);
    }

    /// @notice Renews the reveal block of a chest whose blockhash expired (>256 blocks).
    function reroll(uint256 chestId) external {
        Chest storage c = chests[chestId];
        require(c.buyer == msg.sender, "Gacha: not the buyer");
        require(!c.opened, "Gacha: already opened");
        require(block.number > c.revealBlock + 256, "Gacha: reveal still valid");
        c.revealBlock = uint64(block.number + 2);
        emit ChestRerolled(chestId, c.revealBlock);
    }

    function _pickRarity(uint16 roll) internal view returns (uint8) {
        for (uint8 i = 0; i < 6; i++) {
            if (roll < rarityCumBps[i]) return i;
        }
        return 0; // unreachable: rarityCumBps[5] == 10000
    }

    /// @dev Base attributes grow with rarity; pseudo-random variation within
    ///      the rarity's range. Fine balancing will come from the GDD.
    function _rollAttributes(uint8 rarity, uint256 rand)
        internal
        pure
        returns (Heroes.HeroAttributes memory)
    {
        uint16 base = uint16(10 + uint16(rarity) * 15);
        return Heroes.HeroAttributes({
            rarity: rarity,
            level: 1,
            power: base + uint16((rand >> 16) % 10),
            speed: base + uint16((rand >> 32) % 10),
            stamina: (base + uint16((rand >> 48) % 10)) * 2,
            blastRange: uint8(1 + rarity / 2 + ((rand >> 64) % 2)),
            bombCount: uint8(1 + rarity / 3 + ((rand >> 72) % 2)),
            abilities: uint16((rand >> 80) & (uint16(1) << (rarity + 1)) - 1)
        });
    }

    // ---- administration (multisig + timelock in production) ----

    function setChestPrice(uint256 price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        chestPrice = price;
    }

    function setBurnBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= 10000, "Gacha: invalid bps");
        burnBps = bps;
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "Gacha: zero treasury");
        treasury = treasury_;
    }
}
