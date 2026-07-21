// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Heróis NFT do MinerBlast
/// @notice Atributos ficam on-chain, empacotados num único slot. O mint é
///         exclusivo do Gacha (MINTER_ROLE) e upgrades do HeroUpgrade
///         (UPGRADER_ROLE), a ser adicionado na Fase 3.
contract Heroes is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @dev Raridades: 0=Comum 1=Raro 2=SuperRaro 3=Épico 4=Lendário 5=Mítico
    struct HeroAttributes {
        uint8 rarity;
        uint8 level; // 1..max por raridade
        uint16 power; // dano de mineração por bomba
        uint16 speed; // reduz intervalo entre bombas
        uint16 stamina; // energia máxima
        uint8 blastRange; // alcance da explosão
        uint8 bombCount; // bombas simultâneas
        uint16 abilities; // bitmap de habilidades especiais
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
        require(attrs.rarity <= 5, "Heroes: raridade invalida");
        require(attrs.level >= 1, "Heroes: level invalido");
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
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
