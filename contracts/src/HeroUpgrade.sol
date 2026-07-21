// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Heroes} from "./Heroes.sol";

/// @title Fusão/upgrade de heróis do MinerBlast
/// @notice Sobe o nível de um herói queimando um herói-sacrifício da MESMA
///         raridade e uma taxa em BLAST (100% queimada — sink de token).
///         Nível máximo cresce com a raridade. Requer UPGRADER_ROLE no
///         contrato Heroes.
contract HeroUpgrade is ReentrancyGuard {
    Heroes public immutable heroes;
    ERC20Burnable public immutable blast;

    /// @dev taxa base; custo = baseFee * nível atual do herói-alvo
    uint256 public immutable baseFee;

    event HeroFused(
        address indexed owner, uint256 indexed targetId, uint256 burnedId, uint8 newLevel, uint256 fee
    );

    constructor(Heroes heroes_, ERC20Burnable blast_, uint256 baseFee_) {
        heroes = heroes_;
        blast = blast_;
        baseFee = baseFee_;
    }

    /// @notice Nível máximo por raridade: Comum 4 ... Mítico 9.
    function maxLevel(uint8 rarity) public pure returns (uint8) {
        return 4 + rarity;
    }

    function fuse(uint256 targetId, uint256 sacrificeId) external nonReentrant {
        require(targetId != sacrificeId, "Upgrade: ids iguais");
        require(heroes.ownerOf(targetId) == msg.sender, "Upgrade: nao e dono do alvo");
        require(heroes.ownerOf(sacrificeId) == msg.sender, "Upgrade: nao e dono do sacrificio");

        Heroes.HeroAttributes memory target = heroes.attributesOf(targetId);
        Heroes.HeroAttributes memory sacrifice = heroes.attributesOf(sacrificeId);
        require(target.rarity == sacrifice.rarity, "Upgrade: raridades diferentes");
        require(target.level < maxLevel(target.rarity), "Upgrade: nivel maximo");

        uint256 fee = baseFee * target.level;
        blast.burnFrom(msg.sender, fee);
        heroes.burn(sacrificeId);
        heroes.levelUp(targetId);

        emit HeroFused(msg.sender, targetId, sacrificeId, target.level + 1, fee);
    }
}
