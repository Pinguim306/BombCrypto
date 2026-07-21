// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Heroes} from "./Heroes.sol";

/// @title Gacha de heróis do MinerBlast
/// @notice Venda de baús pagos em BLAST com aleatoriedade commit-reveal:
///         a compra registra um bloco futuro e a abertura usa o blockhash
///         desse bloco + um sal do comprador. Na mainnet, o plano é migrar
///         para Chainlink VRF; o commit-reveal é o fallback de testnet.
///         Probabilidades por raridade são públicas e fixadas no deploy.
contract Gacha is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Chest {
        address buyer;
        uint64 revealBlock; // primeiro bloco cujo hash pode revelar
        bytes32 salt;
        bool opened;
    }

    IERC20 public immutable blast;
    Heroes public immutable heroes;
    address public treasury;

    uint256 public chestPrice;
    /// @dev fração do preço queimada, em basis points (10000 = 100%)
    uint16 public burnBps = 5000;

    /// @dev Probabilidade acumulada por raridade, em bps.
    ///      Comum 52%, Raro 26%, SuperRaro 12%, Épico 6.5%, Lendário 3%, Mítico 0.5%
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

    /// @notice Compra um baú. O pagamento é dividido entre queima e tesouraria.
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

    /// @notice Abre o baú e minta o herói. Deve ser chamada em até 256 blocos
    ///         após o revealBlock; depois disso use `reroll` para renovar.
    function openChest(uint256 chestId) external nonReentrant returns (uint256 heroId) {
        Chest storage c = chests[chestId];
        require(c.buyer == msg.sender, "Gacha: nao e o comprador");
        require(!c.opened, "Gacha: ja aberto");
        require(block.number > c.revealBlock, "Gacha: aguarde o bloco de reveal");
        bytes32 bh = blockhash(c.revealBlock);
        require(bh != bytes32(0), "Gacha: reveal expirado, use reroll");

        c.opened = true;
        uint256 rand = uint256(keccak256(abi.encodePacked(bh, c.salt, chestId, msg.sender)));

        uint8 rarity = _pickRarity(uint16(rand % 10000));
        Heroes.HeroAttributes memory attrs = _rollAttributes(rarity, rand);
        heroId = heroes.mint(msg.sender, attrs);
        emit ChestOpened(chestId, msg.sender, heroId, rarity);
    }

    /// @notice Renova o bloco de reveal de um baú cujo blockhash expirou (>256 blocos).
    function reroll(uint256 chestId) external {
        Chest storage c = chests[chestId];
        require(c.buyer == msg.sender, "Gacha: nao e o comprador");
        require(!c.opened, "Gacha: ja aberto");
        require(block.number > c.revealBlock + 256, "Gacha: reveal ainda valido");
        c.revealBlock = uint64(block.number + 2);
        emit ChestRerolled(chestId, c.revealBlock);
    }

    function _pickRarity(uint16 roll) internal view returns (uint8) {
        for (uint8 i = 0; i < 6; i++) {
            if (roll < rarityCumBps[i]) return i;
        }
        return 0; // inalcançável: rarityCumBps[5] == 10000
    }

    /// @dev Atributos base crescem com a raridade; variação pseudo-aleatória
    ///      dentro da faixa da raridade. Balanceamento fino virá do GDD.
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

    // ---- administração (multisig + timelock em produção) ----

    function setChestPrice(uint256 price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        chestPrice = price;
    }

    function setBurnBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= 10000, "Gacha: bps invalido");
        burnBps = bps;
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "Gacha: tesouraria zero");
        treasury = treasury_;
    }
}
