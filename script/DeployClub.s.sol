// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {BoothClub} from "../src/BoothClub.sol";

/// @dev Redeploy BoothClub against an existing BOOTH token (keeps testnet mint).
contract DeployClubScript is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        address ops = vm.envAddress("OPS_ADDRESS");
        address protocol = vm.envAddress("PROTOCOL_OWNER");
        address createSigner = vm.envOr("CREATE_SIGNER", protocol);
        address booth = vm.envAddress("BOOTH");
        uint256 stakeToCreate = vm.envOr("STAKE_TO_CREATE", uint256(10_000_000));
        uint256 minVault = vm.envOr("MIN_VAULT_STAKE", uint256(100 ether));
        address usdc = vm.envOr("USDC", ARC_USDC);

        vm.startBroadcast();
        BoothClub boothClub =
            new BoothClub(usdc, booth, ops, protocol, createSigner, stakeToCreate, minVault);
        vm.stopBroadcast();

        console.log("BOOTH", booth);
        console.log("BoothClub", address(boothClub));
        console.log("createSigner", createSigner);
    }
}
