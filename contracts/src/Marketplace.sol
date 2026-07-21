// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title MinerBlast NFT marketplace
/// @notice Buying and selling heroes and houses in BLAST, with NFT escrow.
///         Sale fee (default 4%): half burned, half to the treasury.
///         Only collections allowed by the admin are tradable.
contract Marketplace is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev launchpad tokens may not be burnable; "burns" go to the dead address
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct Listing {
        address seller;
        address collection;
        uint256 tokenId;
        uint256 price; // in BLAST
        bool active;
    }

    IERC20 public immutable blast;
    address public treasury;
    /// @dev total sale fee, in bps (400 = 4%)
    uint16 public feeBps = 400;
    /// @dev fraction of the fee that is burned, in bps (5000 = 50% of the fee)
    uint16 public feeBurnBps = 5000;

    mapping(address collection => bool) public allowedCollections;
    uint256 public nextListingId = 1;
    mapping(uint256 listingId => Listing) public listings;

    event CollectionAllowed(address indexed collection, bool allowed);
    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed collection,
        uint256 tokenId,
        uint256 price
    );
    event Cancelled(uint256 indexed listingId);
    event Sold(uint256 indexed listingId, address indexed buyer, uint256 price, uint256 fee);

    constructor(IERC20 blast_, address treasury_, address admin) {
        blast = blast_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function list(address collection, uint256 tokenId, uint256 price)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        require(allowedCollections[collection], "Market: collection not allowed");
        require(price > 0, "Market: zero price");

        IERC721(collection).transferFrom(msg.sender, address(this), tokenId);

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            collection: collection,
            tokenId: tokenId,
            price: price,
            active: true
        });
        emit Listed(listingId, msg.sender, collection, tokenId, price);
    }

    function cancel(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active, "Market: listing inactive");
        require(l.seller == msg.sender, "Market: not the seller");

        l.active = false;
        IERC721(l.collection).transferFrom(address(this), msg.sender, l.tokenId);
        emit Cancelled(listingId);
    }

    function buy(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active, "Market: listing inactive");
        require(l.seller != msg.sender, "Market: cannot buy own listing");

        l.active = false;

        uint256 fee = (l.price * feeBps) / 10000;
        uint256 burnAmount = (fee * feeBurnBps) / 10000;

        blast.safeTransferFrom(msg.sender, BURN_ADDRESS, burnAmount);
        blast.safeTransferFrom(msg.sender, treasury, fee - burnAmount);
        blast.safeTransferFrom(msg.sender, l.seller, l.price - fee);
        IERC721(l.collection).transferFrom(address(this), msg.sender, l.tokenId);

        emit Sold(listingId, msg.sender, l.price, fee);
    }

    // ---- administration (multisig + timelock in production) ----

    function setCollectionAllowed(address collection, bool allowed)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        allowedCollections[collection] = allowed;
        emit CollectionAllowed(collection, allowed);
    }

    function setFees(uint16 feeBps_, uint16 feeBurnBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(feeBps_ <= 1000, "Market: max fee 10%");
        require(feeBurnBps_ <= 10000, "Market: invalid burn bps");
        feeBps = feeBps_;
        feeBurnBps = feeBurnBps_;
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "Market: zero treasury");
        treasury = treasury_;
    }
}
