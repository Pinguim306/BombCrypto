// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MinerBlast BLAST staking
/// @notice 30-day lock with linear reward paid from a pool pre-funded by the
///         treasury (`fundRewards`) — staking NEVER mints new tokens.
///         If the pool runs out, the reward is limited to what the pool
///         covers; the principal is always guaranteed.
contract Staking is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Position {
        uint128 amount;
        uint64 unlockAt;
        uint64 stakedAt;
        bool withdrawn;
    }

    IERC20 public immutable blast;
    uint64 public constant LOCK_DURATION = 30 days;
    /// @dev annual reward in bps on the principal (e.g. 1200 = 12% p.a.)
    uint16 public aprBps;

    uint256 public rewardPool;
    uint256 public totalStaked;
    mapping(address staker => Position[]) public positions;

    event Staked(address indexed staker, uint256 indexed index, uint256 amount, uint64 unlockAt);
    event Withdrawn(address indexed staker, uint256 indexed index, uint256 amount, uint256 reward);
    event RewardsFunded(uint256 amount);

    constructor(IERC20 blast_, uint16 aprBps_, address admin) {
        blast = blast_;
        aprBps = aprBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function stake(uint256 amount) external nonReentrant returns (uint256 index) {
        require(amount > 0, "Staking: zero amount");
        blast.safeTransferFrom(msg.sender, address(this), amount);
        index = positions[msg.sender].length;
        positions[msg.sender].push(
            Position({
                amount: uint128(amount),
                unlockAt: uint64(block.timestamp) + LOCK_DURATION,
                stakedAt: uint64(block.timestamp),
                withdrawn: false
            })
        );
        totalStaked += amount;
        emit Staked(msg.sender, index, amount, uint64(block.timestamp) + LOCK_DURATION);
    }

    function withdraw(uint256 index) external nonReentrant {
        Position storage p = positions[msg.sender][index];
        require(!p.withdrawn, "Staking: already withdrawn");
        require(block.timestamp >= p.unlockAt, "Staking: still locked");

        p.withdrawn = true;
        uint256 reward = _rewardOf(p);
        if (reward > rewardPool) reward = rewardPool; // depleted pool limits the reward
        rewardPool -= reward;
        totalStaked -= p.amount;

        blast.safeTransfer(msg.sender, uint256(p.amount) + reward);
        emit Withdrawn(msg.sender, index, p.amount, reward);
    }

    function pendingReward(address staker, uint256 index) external view returns (uint256) {
        Position storage p = positions[staker][index];
        if (p.withdrawn) return 0;
        uint256 reward = _rewardOf(p);
        return reward > rewardPool ? rewardPool : reward;
    }

    function positionCount(address staker) external view returns (uint256) {
        return positions[staker].length;
    }

    /// @dev linear stake reward up to the unlock (does not accrue after the lock)
    function _rewardOf(Position storage p) private view returns (uint256) {
        uint256 elapsed = block.timestamp < p.unlockAt
            ? block.timestamp - p.stakedAt
            : p.unlockAt - p.stakedAt;
        return (uint256(p.amount) * aprBps * elapsed) / (10000 * 365 days);
    }

    function fundRewards(uint256 amount) external nonReentrant {
        blast.safeTransferFrom(msg.sender, address(this), amount);
        rewardPool += amount;
        emit RewardsFunded(amount);
    }

    function setAprBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= 10000, "Staking: invalid apr");
        aprBps = bps;
    }
}
