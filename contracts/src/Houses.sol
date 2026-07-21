// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MinerBlast house NFTs
/// @notice Houses speed up stamina recovery for sheltered heroes.
///         Direct purchase in BLAST with a price per rarity; half the value
///         is burned and half goes to the treasury. Attributes are
///         deterministic per rarity (capacity and regeneration bonus).
contract Houses is ERC721, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev launchpad tokens may not be burnable; "burns" go to the dead address
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct HouseAttributes {
        uint8 rarity; // 0..5
        uint8 capacity; // heroes sheltered simultaneously
        uint16 regenBoostBps; // regeneration speed bonus (10000 = +100%)
    }

    IERC20 public immutable blast;
    address public treasury;
    uint16 public burnBps = 5000;

    /// @dev price in BLAST per rarity; 0 = rarity unavailable for direct sale
    uint256[6] public prices;

    uint256 public nextTokenId = 1;
    mapping(uint256 tokenId => HouseAttributes) private _attributes;

    event HouseBought(uint256 indexed tokenId, address indexed owner, uint8 rarity);

    constructor(IERC20 blast_, address treasury_, uint256[6] memory prices_, address admin)
        ERC721("MinerBlast Houses", "MBHOUSE")
    {
        blast = blast_;
        treasury = treasury_;
        prices = prices_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function buyHouse(uint8 rarity) external nonReentrant returns (uint256 tokenId) {
        require(rarity <= 5, "Houses: invalid rarity");
        uint256 price = prices[rarity];
        require(price > 0, "Houses: rarity unavailable");

        uint256 burnAmount = (price * burnBps) / 10000;
        blast.safeTransferFrom(msg.sender, BURN_ADDRESS, burnAmount);
        blast.safeTransferFrom(msg.sender, treasury, price - burnAmount);

        tokenId = nextTokenId++;
        _attributes[tokenId] = HouseAttributes({
            rarity: rarity,
            capacity: uint8(2 + uint8(rarity) * 2),
            regenBoostBps: uint16(2000 + uint16(rarity) * 1500)
        });
        _safeMint(msg.sender, tokenId);
        emit HouseBought(tokenId, msg.sender, rarity);
    }

    function attributesOf(uint256 tokenId) external view returns (HouseAttributes memory) {
        _requireOwned(tokenId);
        return _attributes[tokenId];
    }

    function setPrice(uint8 rarity, uint256 price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(rarity <= 5, "Houses: invalid rarity");
        prices[rarity] = price;
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "Houses: zero treasury");
        treasury = treasury_;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
