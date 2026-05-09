// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AddieEscrow, IERC20} from "../src/AddieEscrow.sol";

/// @notice Deploy AddieEscrow to Base mainnet (or any chain via --rpc-url).
///
/// Required env:
///   PLATFORM_OWNER_ADDRESS  → address that controls release/refund (immutable owner).
///   USDC_ADDRESS            → ERC20 token address (defaults to USDC on Base mainnet
///                             0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 if unset).
///
/// Run (dry):
///   forge script script/Deploy.s.sol --rpc-url $ALCHEMY_RPC_URL
///
/// Run (broadcast + verify):
///   forge script script/Deploy.s.sol \
///       --rpc-url $ALCHEMY_RPC_URL \
///       --account <cast-wallet-name> \
///       --broadcast \
///       --verify --etherscan-api-key $BASESCAN_API_KEY
contract DeployAddieEscrow is Script {
    address internal constant USDC_BASE_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external returns (AddieEscrow escrow) {
        address owner = vm.envAddress("PLATFORM_OWNER_ADDRESS");
        address usdc = vm.envOr("USDC_ADDRESS", USDC_BASE_MAINNET);

        require(owner != address(0), "PLATFORM_OWNER_ADDRESS=0");
        require(usdc != address(0), "USDC_ADDRESS=0");

        console2.log("=== AddieEscrow deploy ===");
        console2.log("chain id:", block.chainid);
        console2.log("usdc:    ", usdc);
        console2.log("owner:   ", owner);

        vm.startBroadcast();
        escrow = new AddieEscrow(IERC20(usdc), owner);
        vm.stopBroadcast();

        console2.log("escrow:  ", address(escrow));
    }
}
