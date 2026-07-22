// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Heroes} from "./Heroes.sol";

/// @title MinerBlast hero gacha v2 (ETH-priced, with referrals)
/// @notice Identical mechanics to Gacha (commit-reveal, ETH pricing, public
///         odds) plus a referral split: on each chest purchase a share of the
///         ETH (`referralBps`, default 15%) goes to the buyer's referrer; the
///         rest goes to the treasury. The referrer is bound on the buyer's
///         first referred purchase and never changes afterward. Payout is a
///         push with a pull fallback so a hostile referrer wallet can never
///         block a purchase.
contract GachaV2 is AccessControl, ReentrancyGuard {
    struct Chest {
        address buyer;
        uint64 revealBlock; // first block whose hash can reveal
        bytes32 salt;
        bool opened;
    }

    Heroes public immutable heroes;
    address public treasury;

    uint256 public chestPriceWei;
    uint256 public packPriceWei;
    uint8 public packSize;

    /// @dev Referral share of a purchase, in basis points. Default 1500 = 15%.
    ///      Admin-tunable up to REFERRAL_BPS_CAP (30%).
    uint16 public referralBps = 1500;
    uint16 public constant REFERRAL_BPS_CAP = 3000; // 30%, hard cap in code

    /// @dev The referrer bound to a player (set once, on first referred buy).
    mapping(address player => address) public referrerOf;
    /// @dev Lifetime referral ETH earned per referrer (for UI/leaderboards).
    mapping(address referrer => uint256) public referralEarned;
    /// @dev Referral ETH owed but not yet pushed (pull fallback).
    mapping(address referrer => uint256) public pendingReferral;

    /// @dev Cumulative probability per rarity, in bps.
    ///      Common 52%, Rare 26%, SuperRare 12%, Epic 6.5%, Legend 3%, Mythic 0.5%
    uint16[6] public rarityCumBps = [5200, 7800, 9000, 9650, 9950, 10000];

    uint256 public nextChestId = 1;
    mapping(uint256 chestId => Chest) public chests;

    event ChestBought(uint256 indexed chestId, address indexed buyer, uint64 revealBlock);
    event PackBought(address indexed buyer, uint256 firstChestId, uint8 count);
    event ChestOpened(uint256 indexed chestId, address indexed buyer, uint256 heroId, uint8 rarity);
    event ChestRerolled(uint256 indexed chestId, uint64 newRevealBlock);
    event ReferrerBound(address indexed player, address indexed referrer);
    event ReferralPaid(address indexed referrer, address indexed buyer, uint256 amountWei);
    event ReferralPending(address indexed referrer, uint256 amountWei);
    event ReferralClaimed(address indexed referrer, uint256 amountWei);

    constructor(
        Heroes heroes_,
        address treasury_,
        uint256 chestPriceWei_,
        uint256 packPriceWei_,
        uint8 packSize_,
        address admin
    ) {
        heroes = heroes_;
        treasury = treasury_;
        chestPriceWei = chestPriceWei_;
        packPriceWei = packPriceWei_;
        packSize = packSize_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---- purchases (referral-aware, with backward-compatible overloads) ----

    /// @notice Buys a single chest, binding/paying `referrer` (0 = none).
    function buyChest(bytes32 salt, address referrer)
        external
        payable
        nonReentrant
        returns (uint256 chestId)
    {
        require(msg.value == chestPriceWei, "Gacha: wrong ETH amount");
        _settlePayment(referrer);
        chestId = _createChest(salt);
    }

    /// @notice Backward-compatible single-chest buy with no referrer.
    function buyChest(bytes32 salt) external payable nonReentrant returns (uint256 chestId) {
        require(msg.value == chestPriceWei, "Gacha: wrong ETH amount");
        _settlePayment(address(0));
        chestId = _createChest(salt);
    }

    /// @notice Buys a discounted pack, binding/paying `referrer` (0 = none).
    function buyPack(bytes32 salt, address referrer)
        external
        payable
        nonReentrant
        returns (uint256 firstChestId)
    {
        require(msg.value == packPriceWei, "Gacha: wrong ETH amount");
        _settlePayment(referrer);
        firstChestId = _createPack(salt);
    }

    /// @notice Backward-compatible pack buy with no referrer.
    function buyPack(bytes32 salt) external payable nonReentrant returns (uint256 firstChestId) {
        require(msg.value == packPriceWei, "Gacha: wrong ETH amount");
        _settlePayment(address(0));
        firstChestId = _createPack(salt);
    }

    /// @notice Withdraws referral ETH that could not be pushed automatically.
    function claimReferral() external nonReentrant {
        uint256 amount = pendingReferral[msg.sender];
        require(amount > 0, "Gacha: nothing to claim");
        pendingReferral[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Gacha: claim transfer failed");
        emit ReferralClaimed(msg.sender, amount);
    }

    // ---- opening / reroll (unchanged from v1) ----

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

    function reroll(uint256 chestId) external {
        Chest storage c = chests[chestId];
        require(c.buyer == msg.sender, "Gacha: not the buyer");
        require(!c.opened, "Gacha: already opened");
        require(block.number > c.revealBlock + 256, "Gacha: reveal still valid");
        c.revealBlock = uint64(block.number + 2);
        emit ChestRerolled(chestId, c.revealBlock);
    }

    // ---- internals ----

    /// @dev Splits msg.value: referral share to the (bound) referrer, the rest
    ///      to the treasury. Binds the referrer on first use. Self-referral and
    ///      a zero referrer both mean "no referral" (100% to treasury).
    function _settlePayment(address referrer) private {
        address ref = referrerOf[msg.sender];
        if (ref == address(0) && referrer != address(0) && referrer != msg.sender) {
            ref = referrer;
            referrerOf[msg.sender] = ref;
            emit ReferrerBound(msg.sender, ref);
        }

        uint256 refCut = ref == address(0) ? 0 : (msg.value * referralBps) / 10000;
        if (refCut > 0) {
            referralEarned[ref] += refCut;
            // push; on failure (contract wallet, gas) credit the pull balance
            (bool sent, ) = ref.call{value: refCut, gas: 30000}("");
            if (sent) {
                emit ReferralPaid(ref, msg.sender, refCut);
            } else {
                pendingReferral[ref] += refCut;
                emit ReferralPending(ref, refCut);
            }
        }

        uint256 toTreasury = msg.value - refCut;
        (bool ok, ) = treasury.call{value: toTreasury}("");
        require(ok, "Gacha: treasury transfer failed");
    }

    function _createPack(bytes32 salt) private returns (uint256 firstChestId) {
        firstChestId = nextChestId;
        for (uint8 i = 0; i < packSize; i++) {
            _createChest(salt);
        }
        emit PackBought(msg.sender, firstChestId, packSize);
    }

    function _createChest(bytes32 salt) private returns (uint256 chestId) {
        chestId = nextChestId++;
        chests[chestId] = Chest({
            buyer: msg.sender,
            revealBlock: uint64(block.number + 2),
            salt: salt,
            opened: false
        });
        emit ChestBought(chestId, msg.sender, uint64(block.number + 2));
    }

    function _pickRarity(uint16 roll) internal view returns (uint8) {
        for (uint8 i = 0; i < 6; i++) {
            if (roll < rarityCumBps[i]) return i;
        }
        return 0; // unreachable: rarityCumBps[5] == 10000
    }

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

    // ---- administration ----

    function setPrices(uint256 chestPriceWei_, uint256 packPriceWei_, uint8 packSize_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(packSize_ > 0, "Gacha: pack size zero");
        chestPriceWei = chestPriceWei_;
        packPriceWei = packPriceWei_;
        packSize = packSize_;
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "Gacha: zero treasury");
        treasury = treasury_;
    }

    /// @notice Sets the referral share (bps). Capped at REFERRAL_BPS_CAP (30%).
    function setReferralBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= REFERRAL_BPS_CAP, "Gacha: referral over cap");
        referralBps = bps;
    }
}
