// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BlastToken} from "./BlastToken.sol";

/// @title MinerBlast reward vault
/// @notice Game rewards accrue off-chain on the authoritative server.
///         The player withdraws with an EIP-712 voucher signed by the server
///         (SIGNER_ROLE). A sequential per-player nonce prevents replay and a
///         global daily mint cap limits the damage of a signer key
///         compromise.
contract RewardVault is AccessControl, EIP712 {
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address player,uint256 amount,uint256 nonce,uint256 deadline)");

    BlastToken public immutable blast;

    mapping(address player => uint256) public nonces;

    uint256 public dailyMintCap;
    uint256 public mintedToday;
    uint256 public currentDay;

    event RewardClaimed(address indexed player, uint256 amount, uint256 nonce);

    constructor(BlastToken blast_, uint256 dailyMintCap_, address admin)
        EIP712("MinerBlastVault", "1")
    {
        blast = blast_;
        dailyMintCap = dailyMintCap_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function claim(uint256 amount, uint256 deadline, bytes calldata signature) external {
        require(block.timestamp <= deadline, "Vault: voucher expired");

        uint256 nonce = nonces[msg.sender];
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, msg.sender, amount, nonce, deadline))
        );
        address signer = ECDSA.recover(digest, signature);
        require(hasRole(SIGNER_ROLE, signer), "Vault: invalid signature");

        uint256 day = block.timestamp / 1 days;
        if (day != currentDay) {
            currentDay = day;
            mintedToday = 0;
        }
        require(mintedToday + amount <= dailyMintCap, "Vault: daily cap reached");
        mintedToday += amount;

        nonces[msg.sender] = nonce + 1;
        blast.mint(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount, nonce);
    }

    function setDailyMintCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailyMintCap = cap;
    }
}
