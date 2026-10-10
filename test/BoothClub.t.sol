// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {BoothClub} from "../src/BoothClub.sol";
import {BoothToken} from "../src/BoothToken.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract BoothClubTest is Test {
    BoothClub internal club;
    BoothToken internal booth;
    MockUSDC internal usdc;

    address internal protocol = makeAddr("protocol");
    address internal ops = makeAddr("ops");
    uint256 internal createSignerPk = 0xA11CE;
    address internal createSigner;
    address internal owner_ = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal cara = makeAddr("cara");

    uint256 internal constant STAKE_CREATE = 10_000_000; // 10 USDC (6 dp)
    uint256 internal constant PRICE_CHANGE_FEE = 5_000_000; // 5 USDC
    uint256 internal constant MIN_VAULT = 100 ether;
    uint96 internal constant PERIOD_PRICE = 30_000_000; // 30 USDC / period
    uint8 internal constant MONTHS = 3;

    function setUp() public {
        createSigner = vm.addr(createSignerPk);
        usdc = new MockUSDC();
        booth = new BoothToken(protocol);
        club = new BoothClub(address(usdc), address(booth), ops, protocol, createSigner, STAKE_CREATE, MIN_VAULT);

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
        return _openClubMonths(MONTHS);
    }

    function _openClubMonths(uint8 months) internal returns (uint256 id) {
        vm.startPrank(owner_);
        usdc.approve(address(club), STAKE_CREATE);
        id = club.createClub(PERIOD_PRICE, months);
        vm.stopPrank();
    }

    function _join(address user, uint256 id) internal {
        vm.startPrank(user);
        usdc.approve(address(club), PERIOD_PRICE);
        club.join(id);
        vm.stopPrank();
    }

    function _feePool(uint256 id) internal view returns (uint128 feePool) {
        (,,,,,,,, feePool,,) = club.clubs(id);
    }

    function testCreateRequiresUsdcStake() public {
        vm.prank(owner_);
        vm.expectRevert();
        club.createClub(PERIOD_PRICE, MONTHS);
    }

    function testCreateRejectsBadPeriod() public {
        vm.startPrank(owner_);
        usdc.approve(address(club), STAKE_CREATE);
        vm.expectRevert(BoothClub.InvalidPeriod.selector);
        club.createClub(PERIOD_PRICE, 2);
        vm.stopPrank();
    }

    function testCreateOneAndSixMonth() public {
        uint256 id1 = _openClubMonths(1);
        uint256 id6 = _openClubMonths(6);
        assertEq(club.periodOf(id1), 30 days);
        assertEq(club.periodOf(id6), 180 days);
        (,, uint8 m1,,,,,,,,) = club.clubs(id1);
        (,, uint8 m6,,,,,,,,) = club.clubs(id6);
        assertEq(m1, 1);
        assertEq(m6, 6);
    }

    function testLeaveProratesAndSplitsOps() public {
        uint256 id = _openClub();
        _join(alice, id);

        vm.warp(block.timestamp + 10 days);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        club.leave(id);

        uint256 length = club.periodOf(id);
        uint256 elapsed = 10 days;
        uint256 used = (uint256(PERIOD_PRICE) * elapsed) / length;
        uint256 refund = uint256(PERIOD_PRICE) - used;
        uint256 opsFee = (used * 500) / 10_000;
        uint256 toPool = used - opsFee;

        assertEq(usdc.balanceOf(alice) - before, refund);
        assertEq(club.usdcClaimable(ops), opsFee);
        assertEq(_feePool(id), toPool);
    }

    function testOneMonthExpiry() public {
        uint256 id = _openClubMonths(1);
        _join(alice, id);
        vm.warp(block.timestamp + 30 days);
        vm.prank(bob);
        club.settleExpired(id, alice);
        uint256 used = PERIOD_PRICE;
        uint256 opsFee = (used * 500) / 10_000;
        assertEq(club.usdcClaimable(ops), opsFee);
        assertEq(_feePool(id), used - opsFee);
    }

    function testMinStayChargesOneHour() public {
        uint256 id = _openClub();
        _join(alice, id);
        vm.prank(alice);
        club.leave(id);
        uint256 used = (uint256(PERIOD_PRICE) * 1 hours) / club.periodOf(id);
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
        assertEq(_feePool(id), used - opsFee);
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

    function testOwnerIncludedInTop5() public {
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

        uint256 ownerClaim = club.usdcClaimable(owner_);
        uint256 aliceClaim = club.usdcClaimable(alice);
        // pool split: 50% owner role + 50% top-5 by weight (owner stake counts)
        assertGt(aliceClaim, 0);
        assertGt(ownerClaim, aliceClaim);
        // owner role half alone already exceeds alice's small weight share of the other half
        assertGt(ownerClaim, aliceClaim * 10);
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

    function testOwnerCanSetPriceAnytime() public {
        uint256 id = _openClub();
        uint256 opsBefore = club.usdcClaimable(ops);
        vm.startPrank(owner_);
        usdc.approve(address(club), PRICE_CHANGE_FEE);
        club.setPrice(id, 50_000_000);
        vm.stopPrank();
        (, uint96 price,,,,,,,,,) = club.clubs(id);
        assertEq(price, 50_000_000);
        assertEq(club.usdcClaimable(ops) - opsBefore, PRICE_CHANGE_FEE);
    }

    function testSetPriceRequiresFee() public {
        uint256 id = _openClub();
        vm.prank(owner_);
        vm.expectRevert();
        club.setPrice(id, 50_000_000);
    }

    function testSetPeriodRequiresNoMembers() public {
        uint256 id = _openClub();
        _join(alice, id);
        vm.prank(owner_);
        vm.expectRevert(BoothClub.MembersRemain.selector);
        club.setPeriod(id, 6);

        vm.warp(block.timestamp + 90 days);
        club.settleExpired(id, alice);
        vm.prank(owner_);
        club.setPeriod(id, 6);
        (,, uint8 months,,,,,,,,) = club.clubs(id);
        assertEq(months, 6);
        assertEq(club.periodOf(id), 180 days);
    }

    function testFreeCreateWithSigner() public {
        uint256 deadline = block.timestamp + 1 hours;
        string memory message = club.freeCreateMessage(alice, deadline);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(message));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(createSignerPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(alice);
        uint256 id = club.createClubFree(PERIOD_PRICE, MONTHS, deadline, sig);
        (address o,,,,,,,,, uint128 stake, bool active) = club.clubs(id);
        assertEq(o, alice);
        assertEq(stake, 0);
        assertTrue(active);
        assertTrue(club.freeCreateUsed(alice));

        vm.prank(alice);
        vm.expectRevert(BoothClub.FreeCreateUsed.selector);
        club.createClubFree(PERIOD_PRICE, MONTHS, deadline, sig);
    }
}
