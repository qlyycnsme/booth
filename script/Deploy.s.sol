// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {BoothClub} from "../src/BoothClub.sol";
import {BoothToken} from "../src/BoothToken.sol";

/// @dev Arc USDC is 0x3600... on mainnet and testnet. Set OPS_ADDRESS and PROTOCOL_OWNER.
contract DeployScript is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        address ops = vm.envAddress("OPS_ADDRESS");
        address protocol = vm.envAddress("PROTOCOL_OWNER");
        address createSigner = vm.envOr("CREATE_SIGNER", protocol);
        uint256 stakeToCreate = vm.envOr("STAKE_TO_CREATE", uint256(10_000_000)); // 10 USDC (6 dp)
        uint256 minVault = vm.envOr("MIN_VAULT_STAKE", uint256(100 ether));
        address usdc = vm.envOr("USDC", ARC_USDC);

        vm.startBroadcast();
        BoothToken boothToken = new BoothToken(protocol);
        BoothClub boothClub =
            new BoothClub(usdc, address(boothToken), ops, protocol, createSigner, stakeToCreate, minVault);
        if (vm.envOr("MINT_TEST_BOOTH", false) && protocol == msg.sender) {
            boothToken.mint(protocol, 1_000_000 ether);
        }
        vm.stopBroadcast();

        console.log("BOOTH", address(boothToken));
        console.log("BoothClub", address(boothClub));
        console.log("createSigner", createSigner);
    }
}
