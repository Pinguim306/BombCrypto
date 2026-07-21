// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title BLAST — dev/testnet stand-in token
/// @notice In production the BLAST token is issued by the launchpad
///         (ponsfamily.com): fixed supply of 1 billion, no mint roles, and
///         no assumptions about burnability. This contract mirrors that
///         profile for local/testnet use: the entire supply is minted to
///         the deployer at construction and can never grow.
///         All game "burns" send tokens to the dead address instead of
///         calling burn(), so any standard ERC-20 works.
contract BlastToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    constructor(address holder) ERC20("MinerBlast", "BLAST") {
        _mint(holder, TOTAL_SUPPLY);
    }
}
