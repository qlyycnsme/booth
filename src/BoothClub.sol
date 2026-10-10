// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title BoothClub
/// @notice One contract, many clubs. Owner picks a 1 / 3 / 6 month dues period at create.
///         Creating a club locks stakeToCreate USDC for STAKE_LOCK.
///         5% of used dues accrues to ops; 95% sits in the club pool.
///         Club owner pays PRICE_CHANGE_FEE USDC to ops on each setPrice.
///         Each period: club owner claims 50% of the pool; remaining 50% is split
///         by time-weighted BOOTH stake among the top 5 stakers (club owner may be included).
///         Payments are pull-based so one blocked address cannot brick others.
contract BoothClub is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant STAKE_LOCK = 90 days;
    uint256 public constant MIN_STAY = 1 hours;
    uint256 public constant OPS_BPS = 500;
    uint256 public constant OWNER_POOL_BPS = 5_000;
    uint256 public constant BPS_DENOM = 10_000;
    /// @notice Flat USDC fee (6 dp) charged to club owner on every setPrice.
    uint256 public constant PRICE_CHANGE_FEE = 5_000_000;
    uint256 public constant MAX_STAKERS = 200;
    uint256 public constant TOP_N = 5;

    IERC20 public immutable usdc;
    IERC20 public immutable booth;

    address public ops;
    /// @notice Signs free-create vouchers after off-chain Twitter follower check.
    address public createSigner;
    uint256 public stakeToCreate;
    uint256 public minVaultStake;
    uint256 public nextClubId;
    /// @dev One free create per wallet (5k+ followers verified off-chain).
    mapping(address => bool) public freeCreateUsed;

    struct Club {
        address owner;
        uint96 monthlyPrice; // dues for one membership period
        uint8 periodMonths; // 1, 3, or 6
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

    event ClubCreated(
        uint256 indexed clubId, address indexed owner, uint96 monthlyPrice, uint8 periodMonths, uint256 stake
    );
    event PriceSet(uint256 indexed clubId, uint96 monthlyPrice);
    event PeriodSet(uint256 indexed clubId, uint8 periodMonths);
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
    event CreateSignerSet(address createSigner);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidPeriod();
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
    error FreeCreateUsed();
    error BadSignature();
    error DeadlineExpired();

    constructor(
        address usdc_,
        address booth_,
        address ops_,
        address protocolOwner_,
        address createSigner_,
        uint256 stakeToCreate_,
        uint256 minVaultStake_
    ) Ownable(protocolOwner_) {
        if (
            usdc_ == address(0) || booth_ == address(0) || ops_ == address(0) || protocolOwner_ == address(0)
                || createSigner_ == address(0)
        ) {
            revert InvalidAddress();
        }
        if (stakeToCreate_ == 0 || minVaultStake_ == 0) revert InvalidAmount();
        usdc = IERC20(usdc_);
        booth = IERC20(booth_);
        ops = ops_;
        createSigner = createSigner_;
        stakeToCreate = stakeToCreate_;
        minVaultStake = minVaultStake_;
    }

    function setCreateSigner(address createSigner_) external onlyOwner {
        if (createSigner_ == address(0)) revert InvalidAddress();
        createSigner = createSigner_;
        emit CreateSignerSet(createSigner_);
    }

    /// @notice Membership / accounting length for a periodMonths choice.
    function periodLength(uint8 months) public pure returns (uint256) {
        if (months == 1) return 30 days;
        if (months == 3) return 90 days;
        if (months == 6) return 180 days;
        revert InvalidPeriod();
    }

    function periodOf(uint256 clubId) external view returns (uint256) {
        return periodLength(clubs[clubId].periodMonths);
    }

    function setParams(address ops_, uint256 stakeToCreate_, uint256 minVaultStake_) external onlyOwner {
        if (ops_ == address(0)) revert InvalidAddress();
        if (stakeToCreate_ == 0 || minVaultStake_ == 0) revert InvalidAmount();
        ops = ops_;
        stakeToCreate = stakeToCreate_;
        minVaultStake = minVaultStake_;
        emit ParamsSet(ops_, stakeToCreate_, minVaultStake_);
    }

    function createClub(uint96 monthlyPrice, uint8 periodMonths) external nonReentrant returns (uint256 clubId) {
        if (monthlyPrice == 0) revert InvalidAmount();
        periodLength(periodMonths); // reverts unless 1 / 3 / 6
        uint256 createAmount = stakeToCreate;
        usdc.safeTransferFrom(msg.sender, address(this), createAmount);
        clubId = _openClub(msg.sender, monthlyPrice, periodMonths, createAmount, block.timestamp + STAKE_LOCK);
    }

    /// @notice Message signed by `createSigner` for a free create voucher.
    function freeCreateMessage(address account, uint256 deadline) public pure returns (string memory) {
        return string.concat(
            "Booth free create\naddr: ",
            Strings.toHexString(account),
            "\ndeadline: ",
            Strings.toString(deadline)
        );
    }

    /// @notice Free create once per wallet when `createSigner` attests Twitter followers off-chain.
    function createClubFree(
        uint96 monthlyPrice,
        uint8 periodMonths,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (uint256 clubId) {
        if (monthlyPrice == 0) revert InvalidAmount();
        periodLength(periodMonths);
        if (freeCreateUsed[msg.sender]) revert FreeCreateUsed();
        if (block.timestamp > deadline) revert DeadlineExpired();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(freeCreateMessage(msg.sender, deadline)));
        if (ECDSA.recover(digest, signature) != createSigner) revert BadSignature();
        freeCreateUsed[msg.sender] = true;
        // No USDC lock; unlock immediately so an empty free club can be closed anytime.
        clubId = _openClub(msg.sender, monthlyPrice, periodMonths, 0, block.timestamp);
    }

    function _openClub(
        address owner_,
        uint96 monthlyPrice,
        uint8 periodMonths,
        uint256 createAmount,
        uint256 unlockAt
    ) internal returns (uint256 clubId) {
        clubId = ++nextClubId;
        clubs[clubId] = Club({
            owner: owner_,
            monthlyPrice: monthlyPrice,
            periodMonths: periodMonths,
            periodStart: uint40(block.timestamp),
            createUnlockAt: uint40(unlockAt),
            epoch: 1,
            memberCount: 0,
            stakerCount: 0,
            feePool: 0,
            createStake: uint128(createAmount),
            active: true
        });
        emit ClubCreated(clubId, owner_, monthlyPrice, periodMonths, createAmount);
    }

    function setPrice(uint256 clubId, uint96 monthlyPrice) external nonReentrant {
        Club storage c = clubs[clubId];
        if (msg.sender != c.owner) revert NotClubOwner();
        if (!c.active) revert ClubInactive();
        if (monthlyPrice == 0) revert InvalidAmount();
        usdc.safeTransferFrom(msg.sender, address(this), PRICE_CHANGE_FEE);
        usdcClaimable[ops] += PRICE_CHANGE_FEE;
        c.monthlyPrice = monthlyPrice;
        emit PriceSet(clubId, monthlyPrice);
    }

    /// @notice Change 1/3/6 month length. Only when no active paid members (avoids breaking prorate).
    function setPeriod(uint256 clubId, uint8 periodMonths) external {
        Club storage c = clubs[clubId];
        if (msg.sender != c.owner) revert NotClubOwner();
        if (!c.active) revert ClubInactive();
        if (c.memberCount != 0) revert MembersRemain();
        periodLength(periodMonths); // reverts unless 1 / 3 / 6
        c.periodMonths = periodMonths;
        emit PeriodSet(clubId, periodMonths);
    }

    function join(uint256 clubId) external nonReentrant {
        Club storage c = clubs[clubId];
        if (!c.active) revert ClubInactive();
        Membership storage m = memberships[clubId][msg.sender];
        if (m.paid != 0) revert AlreadyMember();
        uint256 price = c.monthlyPrice;
        uint256 length = periodLength(c.periodMonths);
        usdc.safeTransferFrom(msg.sender, address(this), price);
        m.paid = uint128(price);
        m.joinedAt = uint40(block.timestamp);
        m.expiresAt = uint40(block.timestamp + length);
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

    /// @notice Close a period and assign pool shares. Anyone may call after the club's period length.
    function distribute(uint256 clubId) external nonReentrant {
        Club storage c = clubs[clubId];
        if (!c.active) revert ClubInactive();
        uint256 length = periodLength(c.periodMonths);
        if (block.timestamp < uint256(c.periodStart) + length) revert TooEarly();

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

        uint256 length = periodLength(c.periodMonths);
        uint256 elapsed;
        if (block.timestamp >= m.expiresAt) {
            elapsed = length;
        } else {
            elapsed = block.timestamp - m.joinedAt;
            if (elapsed < MIN_STAY) elapsed = MIN_STAY;
            if (elapsed > length) elapsed = length;
        }

        uint256 used = (paid * elapsed) / length;
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
