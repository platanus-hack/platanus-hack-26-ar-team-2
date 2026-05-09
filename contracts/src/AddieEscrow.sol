// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title  AddieEscrow
/// @notice Per-placement USDC escrow for Addie ad placements on Base.
///         Brand locks USDC at deal close; platform owner releases to the
///         creator on successful render or refunds the brand on brand-safety pull.
///         2 txs per placement: lock + (release | refund).
contract AddieEscrow {
    enum State {
        None,
        Locked,
        Released,
        Refunded
    }

    struct Placement {
        address payer;
        address payee;
        uint256 amount;
        State state;
    }

    IERC20 public immutable usdc;
    address public immutable owner;

    mapping(bytes32 => Placement) public placements;

    event Locked(bytes32 indexed placementId, address indexed payer, address indexed payee, uint256 amount);
    event Released(bytes32 indexed placementId, address indexed payee, uint256 amount);
    event Refunded(bytes32 indexed placementId, address indexed payer, uint256 amount);

    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error PlacementExists();
    error PlacementNotLocked();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 _usdc, address _owner) {
        if (address(_usdc) == address(0) || _owner == address(0)) revert ZeroAddress();
        usdc = _usdc;
        owner = _owner;
    }

    /// @notice Brand locks `amount` USDC against `placementId`, payable to `payee` on release.
    /// @dev    Caller must have approved this contract for at least `amount` of USDC.
    function lock(bytes32 placementId, address payee, uint256 amount) external {
        if (payee == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        Placement storage p = placements[placementId];
        if (p.state != State.None) revert PlacementExists();
        p.payer = msg.sender;
        p.payee = payee;
        p.amount = amount;
        p.state = State.Locked;
        emit Locked(placementId, msg.sender, payee, amount);
        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transferFrom failed");
    }

    /// @notice Platform settles the placement and pays the creator.
    function release(bytes32 placementId) external onlyOwner {
        Placement storage p = placements[placementId];
        if (p.state != State.Locked) revert PlacementNotLocked();
        p.state = State.Released;
        emit Released(placementId, p.payee, p.amount);
        require(usdc.transfer(p.payee, p.amount), "USDC transfer failed");
    }

    /// @notice Platform refunds the brand (e.g. brand-safety pull).
    function refund(bytes32 placementId) external onlyOwner {
        Placement storage p = placements[placementId];
        if (p.state != State.Locked) revert PlacementNotLocked();
        p.state = State.Refunded;
        emit Refunded(placementId, p.payer, p.amount);
        require(usdc.transfer(p.payer, p.amount), "USDC transfer failed");
    }
}
