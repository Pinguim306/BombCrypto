// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MinerBlast reward vault (pre-funded)
/// @notice Game rewards accrue off-chain on the authoritative server and are
///         claimed with a server-signed EIP-712 voucher. The vault NEVER
///         mints: it pays from a pre-funded balance — the project buys a
///         share of the launchpad supply and deposits it here, and launchpad
///         creator fees keep topping it up via `fund` (or plain transfers).
///
///         Player-facing limits (all admin-tunable):
///         - `minClaim`: minimum accumulated amount per withdrawal
///         - `claimCooldown`: minimum interval between withdrawals per player
///         - `dailyCap`: global daily payout ceiling (limits damage if the
///           signer key is ever compromised)
contract RewardVault is AccessControl, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address player,uint256 amount,uint256 nonce,uint256 deadline)");

    IERC20 public immutable blast;

    mapping(address player => uint256) public nonces;
    mapping(address player => uint256) public lastClaimAt;

    uint256 public dailyCap;
    uint256 public paidToday;
    uint256 public currentDay;

    uint256 public minClaim;
    uint256 public claimCooldown;

    event RewardClaimed(address indexed player, uint256 amount, uint256 nonce);
    event VaultFunded(address indexed from, uint256 amount);
    event VaultWithdrawn(address indexed to, uint256 amount);

    constructor(
        IERC20 blast_,
        uint256 dailyCap_,
        uint256 minClaim_,
        uint256 claimCooldown_,
        address admin
    ) EIP712("MinerBlastVault", "1") {
        blast = blast_;
        dailyCap = dailyCap_;
        minClaim = minClaim_;
        claimCooldown = claimCooldown_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Deposits BLAST into the vault (creator fees, treasury top-ups).
    ///         Plain ERC-20 transfers to this address work too; `fund` just
    ///         adds an event for accounting.
    function fund(uint256 amount) external {
        blast.safeTransferFrom(msg.sender, address(this), amount);
        emit VaultFunded(msg.sender, amount);
    }

    function claim(uint256 amount, uint256 deadline, bytes calldata signature) external {
        require(block.timestamp <= deadline, "Vault: voucher expired");
        require(amount >= minClaim, "Vault: below minimum claim");
        require(
            block.timestamp >= lastClaimAt[msg.sender] + claimCooldown,
            "Vault: claim cooldown active"
        );

        uint256 nonce = nonces[msg.sender];
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, msg.sender, amount, nonce, deadline))
        );
        address signer = ECDSA.recover(digest, signature);
        require(hasRole(SIGNER_ROLE, signer), "Vault: invalid signature");

        uint256 day = block.timestamp / 1 days;
        if (day != currentDay) {
            currentDay = day;
            paidToday = 0;
        }
        require(paidToday + amount <= dailyCap, "Vault: daily cap reached");
        paidToday += amount;

        nonces[msg.sender] = nonce + 1;
        lastClaimAt[msg.sender] = block.timestamp;
        blast.safeTransfer(msg.sender, amount); // reverts if the vault is underfunded
        emit RewardClaimed(msg.sender, amount, nonce);
    }

    function vaultBalance() external view returns (uint256) {
        return blast.balanceOf(address(this));
    }

    // ---- administration (multisig + timelock in production) ----

    function setDailyCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailyCap = cap;
    }

    function setMinClaim(uint256 minClaim_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minClaim = minClaim_;
    }

    function setClaimCooldown(uint256 cooldown) external onlyRole(DEFAULT_ADMIN_ROLE) {
        claimCooldown = cooldown;
    }

    /// @notice Emergency/rebalancing withdrawal of vault funds.
    function withdraw(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        blast.safeTransfer(to, amount);
        emit VaultWithdrawn(to, amount);
    }
}
