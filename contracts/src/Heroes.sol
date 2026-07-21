// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MinerBlast hero NFTs
/// @notice Attributes live on-chain, packed into a single slot. Minting is
///         exclusive to the Gacha (MINTER_ROLE) and upgrades/burns to the
///         HeroUpgrade (UPGRADER_ROLE). Enumerable lets the game server list
///         a player's heroes without relying on an indexer.
contract Heroes is ERC721Enumerable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @dev Rarities: 0=Common 1=Rare 2=SuperRare 3=Epic 4=Legendary 5=Mythic
    struct HeroAttributes {
        uint8 rarity;
        uint8 level; // 1..max per rarity
        uint16 power; // mining damage per bomb
        uint16 speed; // reduces interval between bombs
        uint16 stamina; // maximum energy
        uint8 blastRange; // explosion range
        uint8 bombCount; // simultaneous bombs
        uint16 abilities; // bitmap of special abilities
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 tokenId => HeroAttributes) private _attributes;
    string private _baseTokenURI;

    event HeroMinted(uint256 indexed tokenId, address indexed owner, uint8 rarity);
    event HeroLeveledUp(uint256 indexed tokenId, uint8 newLevel);

    constructor(address admin, string memory baseURI) ERC721("MinerBlast Heroes", "MBHERO") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _baseTokenURI = baseURI;
    }

    function mint(address to, HeroAttributes calldata attrs)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        require(attrs.rarity <= 5, "Heroes: invalid rarity");
        require(attrs.level >= 1, "Heroes: invalid level");
        tokenId = nextTokenId++;
        _attributes[tokenId] = attrs;
        _safeMint(to, tokenId);
        emit HeroMinted(tokenId, to, attrs.rarity);
    }

    function levelUp(uint256 tokenId) external onlyRole(UPGRADER_ROLE) {
        _requireOwned(tokenId);
        HeroAttributes storage a = _attributes[tokenId];
        a.level += 1;
        emit HeroLeveledUp(tokenId, a.level);
    }

    function burn(uint256 tokenId) external onlyRole(UPGRADER_ROLE) {
        _burn(tokenId);
        delete _attributes[tokenId];
    }

    function attributesOf(uint256 tokenId) external view returns (HeroAttributes memory) {
        _requireOwned(tokenId);
        return _attributes[tokenId];
    }

    function setBaseURI(string calldata baseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = baseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
