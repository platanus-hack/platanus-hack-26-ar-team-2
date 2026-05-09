// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AddieEscrow, IERC20} from "../src/AddieEscrow.sol";

contract MockUSDC is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfer;
    bool public failTransferFrom;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setFailTransfer(bool v) external {
        failTransfer = v;
    }

    function setFailTransferFrom(bool v) external {
        failTransferFrom = v;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfer) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (failTransferFrom) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AddieEscrowTest is Test {
    AddieEscrow internal escrow;
    MockUSDC internal usdc;

    address internal constant OWNER = address(0xA11CE);
    address internal constant BRAND = address(0xB1);
    address internal constant CREATOR = address(0xC1);
    bytes32 internal constant PID = keccak256("placement-1");
    uint256 internal constant AMOUNT = 1_800_000; // $1.80 USDC (6 decimals)
    uint256 internal constant BRAND_BALANCE = 5_000_000; // $5 USDC

    event Locked(bytes32 indexed placementId, address indexed payer, address indexed payee, uint256 amount);
    event Released(bytes32 indexed placementId, address indexed payee, uint256 amount);
    event Refunded(bytes32 indexed placementId, address indexed payer, uint256 amount);

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new AddieEscrow(IERC20(address(usdc)), OWNER);
        usdc.mint(BRAND, BRAND_BALANCE);
        vm.prank(BRAND);
        usdc.approve(address(escrow), type(uint256).max);
    }

    /* ------------------------------ happy path ------------------------------ */

    function test_lock_pullsUsdcAndStoresPlacement() public {
        vm.expectEmit(true, true, true, true);
        emit Locked(PID, BRAND, CREATOR, AMOUNT);

        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);

        (address payer, address payee, uint256 amount, AddieEscrow.State state) = escrow.placements(PID);
        assertEq(payer, BRAND);
        assertEq(payee, CREATOR);
        assertEq(amount, AMOUNT);
        assertEq(uint8(state), uint8(AddieEscrow.State.Locked));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        assertEq(usdc.balanceOf(BRAND), BRAND_BALANCE - AMOUNT);
    }

    function test_release_paysCreator() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);

        vm.expectEmit(true, true, true, true);
        emit Released(PID, CREATOR, AMOUNT);

        vm.prank(OWNER);
        escrow.release(PID);

        (,,, AddieEscrow.State state) = escrow.placements(PID);
        assertEq(uint8(state), uint8(AddieEscrow.State.Released));
        assertEq(usdc.balanceOf(CREATOR), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_refund_returnsToBrand() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);

        vm.expectEmit(true, true, true, true);
        emit Refunded(PID, BRAND, AMOUNT);

        vm.prank(OWNER);
        escrow.refund(PID);

        (,,, AddieEscrow.State state) = escrow.placements(PID);
        assertEq(uint8(state), uint8(AddieEscrow.State.Refunded));
        assertEq(usdc.balanceOf(BRAND), BRAND_BALANCE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    /* -------------------------------- reverts -------------------------------- */

    function test_lock_revertsZeroAmount() public {
        vm.expectRevert(AddieEscrow.ZeroAmount.selector);
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, 0);
    }

    function test_lock_revertsZeroPayee() public {
        vm.expectRevert(AddieEscrow.ZeroAddress.selector);
        vm.prank(BRAND);
        escrow.lock(PID, address(0), AMOUNT);
    }

    function test_lock_revertsIfPlacementExists() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
        vm.expectRevert(AddieEscrow.PlacementExists.selector);
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
    }

    function test_lock_revertsIfTransferFromFails() public {
        usdc.setFailTransferFrom(true);
        vm.expectRevert(bytes("USDC transferFrom failed"));
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
    }

    function test_release_revertsNotOwner() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
        vm.expectRevert(AddieEscrow.NotOwner.selector);
        vm.prank(BRAND);
        escrow.release(PID);
    }

    function test_release_revertsIfNeverLocked() public {
        vm.expectRevert(AddieEscrow.PlacementNotLocked.selector);
        vm.prank(OWNER);
        escrow.release(PID);
    }

    function test_release_revertsIfAlreadyReleased() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
        vm.prank(OWNER);
        escrow.release(PID);
        vm.expectRevert(AddieEscrow.PlacementNotLocked.selector);
        vm.prank(OWNER);
        escrow.release(PID);
    }

    function test_release_revertsAfterRefund() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
        vm.prank(OWNER);
        escrow.refund(PID);
        vm.expectRevert(AddieEscrow.PlacementNotLocked.selector);
        vm.prank(OWNER);
        escrow.release(PID);
    }

    function test_release_revertsIfTransferFails() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
        usdc.setFailTransfer(true);
        vm.expectRevert(bytes("USDC transfer failed"));
        vm.prank(OWNER);
        escrow.release(PID);
    }

    function test_refund_revertsNotOwner() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
        vm.expectRevert(AddieEscrow.NotOwner.selector);
        vm.prank(BRAND);
        escrow.refund(PID);
    }

    function test_refund_revertsIfNeverLocked() public {
        vm.expectRevert(AddieEscrow.PlacementNotLocked.selector);
        vm.prank(OWNER);
        escrow.refund(PID);
    }

    function test_refund_revertsIfAlreadyRefunded() public {
        vm.prank(BRAND);
        escrow.lock(PID, CREATOR, AMOUNT);
        vm.prank(OWNER);
        escrow.refund(PID);
        vm.expectRevert(AddieEscrow.PlacementNotLocked.selector);
        vm.prank(OWNER);
        escrow.refund(PID);
    }

    function test_constructor_revertsZeroUsdc() public {
        vm.expectRevert(AddieEscrow.ZeroAddress.selector);
        new AddieEscrow(IERC20(address(0)), OWNER);
    }

    function test_constructor_revertsZeroOwner() public {
        vm.expectRevert(AddieEscrow.ZeroAddress.selector);
        new AddieEscrow(IERC20(address(usdc)), address(0));
    }

    /* --------------------------------- fuzz --------------------------------- */

    function testFuzz_lockReleaseRoundTrip(uint128 amount, address payee, bytes32 placementId) public {
        vm.assume(amount > 0);
        vm.assume(payee != address(0) && payee != BRAND && payee != address(escrow));
        usdc.mint(BRAND, amount);
        vm.prank(BRAND);
        escrow.lock(placementId, payee, amount);
        vm.prank(OWNER);
        escrow.release(placementId);
        assertEq(usdc.balanceOf(payee), amount);
    }

    function testFuzz_lockRefundRoundTrip(uint128 amount, bytes32 placementId) public {
        vm.assume(amount > 0);
        usdc.mint(BRAND, amount);
        uint256 balanceBefore = usdc.balanceOf(BRAND);
        vm.prank(BRAND);
        escrow.lock(placementId, CREATOR, amount);
        vm.prank(OWNER);
        escrow.refund(placementId);
        assertEq(usdc.balanceOf(BRAND), balanceBefore);
    }
}
