// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BoothClub
/// @notice One contract, many clubs. USDC dues cover a 90-day period and are time-prorated.
///         Creating a club locks 10 USDC (configurable) for 90 days.
///         5% of used dues accrues to ops; 95% sits in the club pool.
///         Each period: club owner claims 50% of the pool; remaining 50% is split
///         by time-weighted BOOTH stake among the top 5 members (owner excluded).
///         Payments are pull-based so one blocked address cannot brick others.
contract BoothClub is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PERIOD = 90 days;
    uint256 public constant STAKE_LOCK = 90 days;
    uint256 public constant MIN_STAY = 1 hours;
    uint256 public constant OPS_BPS = 500;
    uint256 public constant OWNER_POOL_BPS = 5_000;
    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant MAX_STAKERS = 200;
    uint256 public constant TOP_N = 5;

    IERC20 public immutable usdc;
    IERC20 public immutable booth;

    address public ops;
    uint256 public stakeToCreate;
    uint256 public minVaultStake;
    uint256 public nextClubId;

    struct Club {
        address owner;
        uint96 monthlyPrice; // price for one PERIOD (90 days)
        uint40 periodStart;
        uint40 createUnlockAt;
        uint32 epoch;
        uint32 memberCount;
        uint32 stakerCount;
        uint128 feePool;
        uint128 createStake;
        bool active;
    }

    struct Membership {
        uint128 paid;
        uint40 joinedAt;
        uint40 expiresAt;
    }

    struct VaultPosition {
        uint128 amount;
        uint40 lockUntil;
        uint40 lastAccrue;
        uint32 epoch;
        uint32 listIndex;
        uint256 weight;
    }

    mapping(uint256 => Club) public clubs;
    mapping(uint256 => mapping(address => Membership)) public memberships;
    mapping(uint256 => mapping(address => VaultPosition)) public vaults;
    mapping(uint256 => address[]) internal stakerList;
    mapping(address => uint256) public usdcClaimable;
    /// @dev Set on join for the current epoch. Cleared only on early leave so
    ///      settleExpired cannot grief a rival out of the monthly split.
    mapping(uint256 => mapping(uint32 => mapping(address => bool))) public servedEpoch;

    event ClubCreated(uint256 indexed clubId, address indexed owner, uint96 monthlyPrice, uint256 stake);
    event PriceSet(uint256 indexed clubId, uint96 monthlyPrice);
    event Joined(uint256 indexed clubId, address indexed user, uint256 paid, uint40 expiresAt);
    event Settled(
        uint256 indexed clubId,
        address indexed user,
        uint256 used,
        uint256 refund,
        uint256 opsFee,
        uint256 toPool
    );
    event Staked(uint256 indexed clubId, address indexed user, uint256 amount, uint40 lockUntil);
    event Unstaked(uint256 indexed clubId, address indexed user, uint256 amount);
    event Distributed(uint256 indexed clubId, uint256 ownerShare, uint256 stakerShare, uint256 epoch);
    event UsdcClaimed(address indexed user, uint256 amount);
    event ClubClosed(uint256 indexed clubId);
    event ParamsSet(address ops, uint256 stakeToCreate, uint256 minVaultStake);

    error InvalidAddress();
    error InvalidAmount();
    error NotClubOwner();
    error ClubInactive();
    error AlreadyMember();
    error NotMember();
    error NotExpired();
    error StillLocked();
    error VaultFull();
    error BelowMinStake();
    error AlreadyStaked();
    error NoStake();
    error TooEarly();
    error MembersRemain();
    error StakersRemain();
    error NotStaked();

    constructor(
        address usdc_,
        address booth_,
        address ops_,
        address protocolOwner_,
        uint256 stakeToCreate_,
        uint256 minVaultStake_
    ) Ownable(protocolOwner_) {
        if (usdc_ == address(0) || booth_ == address(0) || ops_ == address(0) || protocolOwner_ == address(0)) {
            revert InvalidAddress();
        }
        if (stakeToCreate_ == 0 || minVaultStake_ == 0) revert InvalidAmount();
        usdc = IERC20(usdc_);
        booth = IERC20(booth_);
        ops = ops_;
        stakeToCreate = stakeToCreate_;
        minVaultStake = minVaultStake_;
    }

    function setParams(address ops_, uint256 stakeToCreate_, uint256 minVaultStake_) external onlyOwner {
        if (ops_ == address(0)) revert InvalidAddress();
        if (stakeToCreate_ == 0 || minVaultStake_ == 0) revert InvalidAmount();
        ops = ops_;
        stakeToCreate = stakeToCreate_;
        minVaultStake = minVaultStake_;
        emit ParamsSet(ops_, stakeToCreate_, minVaultStake_);
    }

    function createClub(uint96 monthlyPrice) external nonReentrant returns (uint256 clubId) {
        if (monthlyPrice == 0) revert InvalidAmount();
        uint256 createAmount = stakeToCreate;
        usdc.safeTransferFrom(msg.sender, address(this), createAmount);
        clubId = ++nextClubId;
        clubs[clubId] = Club({
            owner: msg.sender,
            monthlyPrice: monthlyPrice,
            periodStart: uint40(block.timestamp),
            createUnlockAt: uint40(block.timestamp + STAKE_LOCK),
            epoch: 1,
            memberCount: 0,
            stakerCount: 0,
            feePool: 0,
            createStake: uint128(createAmount),
            active: true
        });
        emit ClubCreated(clubId, msg.sender, monthlyPrice, createAmount);
    }

    function setPrice(uint256 clubId, uint96 monthlyPrice) external {
        Club storage c = clubs[clubId];
        if (msg.sender != c.owner) revert NotClubOwner();
        if (!c.active) revert ClubInactive();
        if (monthlyPrice == 0) revert InvalidAmount();
        c.monthlyPrice = monthlyPrice;
        emit PriceSet(clubId, monthlyPrice);
    }

    function join(uint256 clubId) external nonReentrant {
        Club storage c = clubs[clubId];
        if (!c.active) revert ClubInactive();
        Membership storage m = memberships[clubId][msg.sender];
        if (m.paid != 0) revert AlreadyMember();
        uint256 price = c.monthlyPrice;
        usdc.safeTransferFrom(msg.sender, address(this), price);
        m.paid = uint128(price);
        m.joinedAt = uint40(block.timestamp);
        m.expiresAt = uint40(block.timestamp + PERIOD);
        servedEpoch[clubId][c.epoch][msg.sender] = true;
        unchecked {
            c.memberCount += 1;
        }
        emit Joined(clubId, msg.sender, price, m.expiresAt);
    }

    function leave(uint256 clubId) external nonReentrant {
        _settle(clubId, msg.sender, false);
    }

    /// @notice Anyone can settle an expired membership so used dues enter the pool.
    function settleExpired(uint256 clubId, address user) external nonReentrant {
        Membership storage m = memberships[clubId][user];
        if (m.paid == 0) revert NotMember();
        if (block.timestamp < m.expiresAt) revert NotExpired();
        _settle(clubId, user, true);
    }

    function stake(uint256 clubId, uint256 amount) external nonReentrant {
        Club storage c = clubs[clubId];
        if (!c.active) revert ClubInactive();
        if (!_isActiveMember(clubId, msg.sender)) revert NotMember();
        if (amount < minVaultStake) revert BelowMinStake();
        VaultPosition storage p = vaults[clubId][msg.sender];
        if (p.amount != 0) revert AlreadyStaked();
        if (c.stakerCount >= MAX_STAKERS) revert VaultFull();

        booth.safeTransferFrom(msg.sender, address(this), amount);
        p.amount = uint128(amount);
        p.lockUntil = uint40(block.timestamp + STAKE_LOCK);
        p.lastAccrue = uint40(block.timestamp);
        p.epoch = c.epoch;
        p.weight = 0;
        p.listIndex = uint32(stakerList[clubId].length);
        stakerList[clubId].push(msg.sender);
        unchecked {
            c.stakerCount += 1;
        }
        emit Staked(clubId, msg.sender, amount, p.lockUntil);
    }

    function addStake(uint256 clubId, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (!_isActiveMember(clubId, msg.sender)) revert NotMember();
        VaultPosition storage p = vaults[clubId][msg.sender];
        if (p.amount == 0) revert NotStaked();
        _accrue(clubId, msg.sender);
        booth.safeTransferFrom(msg.sender, address(this), amount);
        p.amount += uint128(amount);
        p.lockUntil = uint40(block.timestamp + STAKE_LOCK);
        emit Staked(clubId, msg.sender, amount, p.lockUntil);
    }

    function unstake(uint256 clubId) external nonReentrant {
        VaultPosition storage p = vaults[clubId][msg.sender];
        uint256 amount = p.amount;
        if (amount == 0) revert NoStake();
        if (block.timestamp < p.lockUntil) revert StillLocked();
        _accrue(clubId, msg.sender);
        _removeStaker(clubId, msg.sender);
        booth.safeTransfer(msg.sender, amount);
        emit Unstaked(clubId, msg.sender, amount);
    }

    /// @notice Close a period and assign pool shares. Anyone may call after PERIOD.
    function distribute(uint256 clubId) external nonReentrant {
        Club storage c = clubs[clubId];
        if (!c.active) revert ClubInactive();
        if (block.timestamp < uint256(c.periodStart) + PERIOD) revert TooEarly();

        uint256 pool = c.feePool;
        c.feePool = 0;
        uint256 epoch = c.epoch;

        if (pool == 0) {
            _rollPeriod(c);
            emit Distributed(clubId, 0, 0, epoch);
            return;
        }

        (uint256 totalWeight, address[TOP_N] memory winners, uint256[TOP_N] memory weights, uint256 n) =
            _topWeighted(clubId);

        uint256 ownerShare;
        uint256 stakerShare;
        if (n == 0 || totalWeight == 0) {
            ownerShare = pool;
        } else {
            ownerShare = (pool * OWNER_POOL_BPS) / BPS_DENOM;
            stakerShare = pool - ownerShare;
            uint256 distributed;
            for (uint256 i; i < n; i++) {
                uint256 share = (stakerShare * weights[i]) / totalWeight;
                usdcClaimable[winners[i]] += share;
                distributed += share;
            }
            ownerShare += stakerShare - distributed;
        }
        usdcClaimable[c.owner] += ownerShare;
        _rollPeriod(c);
        emit Distributed(clubId, ownerShare, stakerShare, epoch);
    }

    function claimUsdc() external nonReentrant {
        uint256 amount = usdcClaimable[msg.sender];
        if (amount == 0) revert InvalidAmount();
        usdcClaimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit UsdcClaimed(msg.sender, amount);
    }

    function claimOps() external nonReentrant {
        uint256 amount = usdcClaimable[ops];
        if (amount == 0) revert InvalidAmount();
        usdcClaimable[ops] = 0;
        usdc.safeTransfer(ops, amount);
        emit UsdcClaimed(ops, amount);
    }

    function closeClub(uint256 clubId) external nonReentrant {
        Club storage c = clubs[clubId];
        if (msg.sender != c.owner) revert NotClubOwner();
        if (!c.active) revert ClubInactive();
        if (c.memberCount != 0) revert MembersRemain();
        if (c.stakerCount != 0) revert StakersRemain();
        if (block.timestamp < c.createUnlockAt) revert StillLocked();
        uint256 leftover = c.feePool;
        if (leftover != 0) {
            c.feePool = 0;
            usdcClaimable[c.owner] += leftover;
        }
        uint256 locked = c.createStake;
        c.createStake = 0;
        c.active = false;
        usdc.safeTransfer(c.owner, locked);
        emit ClubClosed(clubId);
    }

    function stakersOf(uint256 clubId) external view returns (address[] memory) {
        return stakerList[clubId];
    }

    function pendingWeight(uint256 clubId, address user) external view returns (uint256) {
        Club storage c = clubs[clubId];
        VaultPosition storage p = vaults[clubId][user];
        uint256 w = p.weight;
        uint256 last = p.lastAccrue;
        if (p.epoch != c.epoch) {
            w = 0;
            last = c.periodStart;
        }
        if (last < c.periodStart) last = c.periodStart;
        if (p.amount != 0 && block.timestamp > last) {
            w += uint256(p.amount) * (block.timestamp - last);
        }
        return w;
    }

    function _settle(uint256 clubId, address user, bool requireExpired) internal {
        Club storage c = clubs[clubId];
        Membership storage m = memberships[clubId][user];
        uint256 paid = m.paid;
        uint40 expiresAt = m.expiresAt;
        if (paid == 0) revert NotMember();
        if (requireExpired && block.timestamp < m.expiresAt) revert NotExpired();

        uint256 elapsed;
        if (block.timestamp >= m.expiresAt) {
            elapsed = PERIOD;
        } else {
            elapsed = block.timestamp - m.joinedAt;
            if (elapsed < MIN_STAY) elapsed = MIN_STAY;
            if (elapsed > PERIOD) elapsed = PERIOD;
        }

        uint256 used = (paid * elapsed) / PERIOD;
        if (used > paid) used = paid;
        uint256 refund = paid - used;
        uint256 opsFee = (used * OPS_BPS) / BPS_DENOM;
        uint256 toPool = used - opsFee;

        m.paid = 0;
        m.joinedAt = 0;
        m.expiresAt = 0;
        unchecked {
            c.memberCount -= 1;
        }
        if (opsFee != 0) usdcClaimable[ops] += opsFee;
        if (toPool != 0) c.feePool += uint128(toPool);
        if (block.timestamp < expiresAt) {
            servedEpoch[clubId][c.epoch][user] = false;
        }
        if (refund != 0) usdc.safeTransfer(user, refund);
        emit Settled(clubId, user, used, refund, opsFee, toPool);
    }

    function _isActiveMember(uint256 clubId, address user) internal view returns (bool) {
        Membership storage m = memberships[clubId][user];
        return m.paid != 0 && block.timestamp < m.expiresAt;
    }

    function _accrue(uint256 clubId, address user) internal {
        Club storage c = clubs[clubId];
        VaultPosition storage p = vaults[clubId][user];
        uint256 last = p.lastAccrue;
        if (p.epoch != c.epoch) {
            p.weight = 0;
            p.epoch = c.epoch;
            last = c.periodStart;
        }
        if (last < c.periodStart) last = c.periodStart;
        if (p.amount != 0 && block.timestamp > last) {
            p.weight += uint256(p.amount) * (block.timestamp - last);
        }
        p.lastAccrue = uint40(block.timestamp);
    }

    function _topWeighted(uint256 clubId)
        internal
        returns (uint256 totalWeight, address[TOP_N] memory winners, uint256[TOP_N] memory weights, uint256 n)
    {
        Club storage c = clubs[clubId];
        address[] storage list = stakerList[clubId];
        uint256 len = list.length;
        uint256 minStake = minVaultStake;
        for (uint256 i; i < len; i++) {
            address user = list[i];
            if (user == c.owner) {
                _accrue(clubId, user);
                continue;
            }
            _accrue(clubId, user);
            VaultPosition storage p = vaults[clubId][user];
            if (p.amount < minStake) continue;
            if (!servedEpoch[clubId][c.epoch][user]) continue;
            uint256 w = p.weight;
            if (w == 0) continue;
            (n, totalWeight) = _insertTop(winners, weights, n, user, w, totalWeight);
        }
    }

    function _insertTop(
        address[TOP_N] memory winners,
        uint256[TOP_N] memory weights,
        uint256 n,
        address user,
        uint256 w,
        uint256 totalWeight
    ) internal pure returns (uint256 newN, uint256 newTotal) {
        if (n < TOP_N) {
            winners[n] = user;
            weights[n] = w;
            newTotal = totalWeight + w;
            newN = n + 1;
            _sortDesc(winners, weights, newN);
            return (newN, newTotal);
        }
        if (w <= weights[TOP_N - 1]) {
            return (n, totalWeight);
        }
        newTotal = totalWeight - weights[TOP_N - 1] + w;
        winners[TOP_N - 1] = user;
        weights[TOP_N - 1] = w;
        _sortDesc(winners, weights, TOP_N);
        return (TOP_N, newTotal);
    }

    function _sortDesc(address[TOP_N] memory winners, uint256[TOP_N] memory weights, uint256 n) internal pure {
        for (uint256 i = 1; i < n; i++) {
            uint256 ww = weights[i];
            address aa = winners[i];
            uint256 j = i;
            while (j > 0 && weights[j - 1] < ww) {
                weights[j] = weights[j - 1];
                winners[j] = winners[j - 1];
                unchecked {
                    j--;
                }
            }
            weights[j] = ww;
            winners[j] = aa;
        }
    }

    function _removeStaker(uint256 clubId, address user) internal {
        Club storage c = clubs[clubId];
        VaultPosition storage p = vaults[clubId][user];
        uint256 idx = p.listIndex;
        address[] storage list = stakerList[clubId];
        uint256 last = list.length - 1;
        if (idx != last) {
            address moved = list[last];
            list[idx] = moved;
            vaults[clubId][moved].listIndex = uint32(idx);
        }
        list.pop();
        delete vaults[clubId][user];
        unchecked {
            c.stakerCount -= 1;
        }
    }

    function _rollPeriod(Club storage c) internal {
        unchecked {
            c.epoch += 1;
        }
        c.periodStart = uint40(block.timestamp);
    }
}
