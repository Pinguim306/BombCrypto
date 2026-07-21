// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title Casas NFT do MinerBlast
/// @notice Casas aceleram a recuperação de stamina dos heróis abrigados.
///         Compra direta em BLAST com preço por raridade; metade do valor é
///         queimada e metade vai para a tesouraria. Atributos são
///         determinísticos por raridade (capacidade e bônus de regeneração).
contract Houses is ERC721, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct HouseAttributes {
        uint8 rarity; // 0..5
        uint8 capacity; // heróis abrigados simultaneamente
        uint16 regenBoostBps; // bônus na velocidade de regeneração (10000 = +100%)
    }

    IERC20 public immutable blast;
    address public treasury;
    uint16 public burnBps = 5000;

    /// @dev preço em BLAST por raridade; 0 = raridade indisponível para venda direta
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
        require(rarity <= 5, "Houses: raridade invalida");
        uint256 price = prices[rarity];
        require(price > 0, "Houses: raridade indisponivel");

        uint256 burnAmount = (price * burnBps) / 10000;
        ERC20Burnable(address(blast)).burnFrom(msg.sender, burnAmount);
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
        require(rarity <= 5, "Houses: raridade invalida");
        prices[rarity] = price;
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "Houses: tesouraria zero");
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
