// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BoothClub} from "../src/BoothClub.sol";
import {BoothToken} from "../src/BoothToken.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract BoothClubTest is Test {
    BoothClub internal club;
    BoothToken internal booth;
    MockUSDC internal usdc;

    address internal protocol = makeAddr("protocol");
    address internal ops = makeAddr("ops");
    address internal owner_ = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal cara = makeAddr("cara");

    uint256 internal constant STAKE_CREATE = 10_000_000; // 10 USDC (6 dp)
    uint256 internal constant MIN_VAULT = 100 ether;
    uint96 internal constant PERIOD_PRICE = 30_000_000; // 30 USDC / 90 days

    function setUp() public {
        usdc = new MockUSDC();
        booth = new BoothToken(protocol);
        club = new BoothClub(address(usdc), address(booth), ops, protocol, STAKE_CREATE, MIN_VAULT);

        vm.startPrank(protocol);
        booth.mint(alice, 10_000 ether);
        booth.mint(bob, 10_000 ether);
        booth.mint(cara, 10_000 ether);
        booth.mint(owner_, 10_000 ether);
        vm.stopPrank();

        usdc.mint(owner_, 1_000_000_000);
        usdc.mint(alice, 1_000_000_000);
        usdc.mint(bob, 1_000_000_000);
        usdc.mint(cara, 1_000_000_000);
    }

    function _openClub() internal returns (uint256 id) {
        vm.startPrank(owner_);
        usdc.approve(address(club), STAKE_CREATE);
        id = club.createClub(PERIOD_PRICE);
        vm.stopPrank();
    }

    function _join(address user, uint256 id) internal {
        vm.startPrank(user);
        usdc.approve(address(club), PERIOD_PRICE);
        club.join(id);
        vm.stopPrank();
    }

    function testCreateRequiresUsdcStake() public {
        vm.prank(owner_);
        vm.expectRevert();
        club.createClub(PERIOD_PRICE);
    }

    function testLeaveProratesAndSplitsOps() public {
        uint256 id = _openClub();
        _join(alice, id);

        vm.warp(block.timestamp + 10 days);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        club.leave(id);

        uint256 elapsed = 10 days;
        uint256 used = (uint256(PERIOD_PRICE) * elapsed) / club.PERIOD();
        uint256 refund = uint256(PERIOD_PRICE) - used;
        uint256 opsFee = (used * 500) / 10_000;
        uint256 toPool = used - opsFee;

        assertEq(usdc.balanceOf(alice) - before, refund);
        assertEq(club.usdcClaimable(ops), opsFee);
        (,,,,,,, uint128 feePool,,) = club.clubs(id);
        assertEq(feePool, toPool);
    }

    function testMinStayChargesOneHour() public {
        uint256 id = _openClub();
        _join(alice, id);
        vm.prank(alice);
        club.leave(id);
        uint256 used = (uint256(PERIOD_PRICE) * 1 hours) / club.PERIOD();
        uint256 opsFee = (used * 500) / 10_000;
        assertEq(club.usdcClaimable(ops), opsFee);
    }

    function testExpiredSettleFillsPoolWithoutMemberCallingLeave() public {
        uint256 id = _openClub();
        _join(alice, id);
        vm.warp(block.timestamp + 90 days);
        vm.prank(bob);
        club.settleExpired(id, alice);
        uint256 used = PERIOD_PRICE;
        uint256 opsFee = (used * 500) / 10_000;
        assertEq(club.usdcClaimable(ops), opsFee);
        (,,,,,,, uint128 feePool,,) = club.clubs(id);
        assertEq(feePool, used - opsFee);
    }

    function testStakeLockAndWeightBeatsLastSecondWhale() public {
        uint256 id = _openClub();
        _join(alice, id);
        _join(bob, id);

        vm.startPrank(alice);
        booth.approve(address(club), 1_000 ether);
        club.stake(id, 1_000 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 89 days);
        vm.startPrank(bob);
        booth.approve(address(club), 10_000 ether);
        club.stake(id, 10_000 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        club.leave(id);
        vm.prank(bob);
        club.leave(id);

        club.distribute(id);

        assertGt(club.usdcClaimable(alice), club.usdcClaimable(bob));
        uint256 ownerShare = club.usdcClaimable(owner_);
        uint256 stakerTotal = club.usdcClaimable(alice) + club.usdcClaimable(bob);
        assertApproxEqRel(ownerShare, stakerTotal, 0.02e18);
    }

    function testOwnerExcludedFromTop5() public {
        uint256 id = _openClub();
        usdc.mint(owner_, PERIOD_PRICE);

        _join(owner_, id);
        _join(alice, id);

        vm.startPrank(owner_);
        booth.approve(address(club), 5_000 ether);
        club.stake(id, 5_000 ether);
        vm.stopPrank();

        vm.startPrank(alice);
        booth.approve(address(club), MIN_VAULT);
        club.stake(id, MIN_VAULT);
        vm.stopPrank();

        vm.warp(block.timestamp + 90 days);
        club.settleExpired(id, owner_);
        club.settleExpired(id, alice);
        club.distribute(id);

        assertGt(club.usdcClaimable(alice), 0);
        assertApproxEqAbs(club.usdcClaimable(owner_), club.usdcClaimable(alice), 1);
    }

    function testCannotUnstakeEarly() public {
        uint256 id = _openClub();
        _join(alice, id);
        vm.startPrank(alice);
        booth.approve(address(club), MIN_VAULT);
        club.stake(id, MIN_VAULT);
        vm.expectRevert(BoothClub.StillLocked.selector);
        club.unstake(id);
        vm.stopPrank();
    }

    function testCannotCloseBeforeCreateUnlock() public {
        uint256 id = _openClub();
        vm.prank(owner_);
        vm.expectRevert(BoothClub.StillLocked.selector);
        club.closeClub(id);

        vm.warp(block.timestamp + 90 days);
        uint256 before = usdc.balanceOf(owner_);
        vm.prank(owner_);
        club.closeClub(id);
        assertEq(usdc.balanceOf(owner_) - before, STAKE_CREATE);
    }

    function testPullClaim() public {
        uint256 id = _openClub();
        _join(alice, id);
        vm.warp(block.timestamp + 90 days);
        club.settleExpired(id, alice);
        vm.warp(block.timestamp + 1);
        club.distribute(id);

        uint256 owed = club.usdcClaimable(owner_);
        uint256 before = usdc.balanceOf(owner_);
        vm.prank(owner_);
        club.claimUsdc();
        assertEq(usdc.balanceOf(owner_) - before, owed);
        assertEq(club.usdcClaimable(owner_), 0);

        uint256 opsOwed = club.usdcClaimable(ops);
        club.claimOps();
        assertEq(usdc.balanceOf(ops), opsOwed);
    }

    function testCloseReturnsCreateStake() public {
        uint256 id = _openClub();
        vm.warp(block.timestamp + 90 days);
        uint256 before = usdc.balanceOf(owner_);
        vm.prank(owner_);
        club.closeClub(id);
        assertEq(usdc.balanceOf(owner_) - before, STAKE_CREATE);
    }
}
