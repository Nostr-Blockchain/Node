"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NETWORK_PARAMS_BY_NAME = exports.TESTNET_PARAMS = exports.MAINNET_PARAMS = exports.PUBLIC_BINARY_NAME = exports.SUPPORTED_NETWORK_NAMES = void 0;
exports.isNetworkName = isNetworkName;
exports.assertNetworkName = assertNetworkName;
exports.getNetworkParams = getNetworkParams;
exports.SUPPORTED_NETWORK_NAMES = Object.freeze(['mainnet', 'testnet']);
exports.PUBLIC_BINARY_NAME = 'nostr-blockchain';
const SHARED_CACHEWALK_R1 = Object.freeze({
    scratchpadBytes: 262_144,
    lineBytes: 64,
    lineCount: 4_096,
    passes: 2
});
const SHARED_NETWORK_CONSTANTS = {
    protocolVersion: 0,
    txKind: 7_342,
    blockKind: 7_343,
    decimals: 8,
    baseUnitsPerNsr: 100000000n,
    blockReward: 5000000000n,
    rewardMaturity: 240,
    baseFee: 1000n,
    inputFee: 250n,
    outputFee: 500n,
    maxTxInputs: 32,
    maxTxOutputs: 32,
    maxBlockTransactions: 64,
    targetBlockSeconds: 15,
    difficultyWindow: 120,
    minDifficultyBits: 1,
    maxDifficultyBits: 63,
    nip13GateBits: 6,
    cacheWalkR1: SHARED_CACHEWALK_R1
};
exports.MAINNET_PARAMS = Object.freeze({
    network: 'mainnet',
    ...SHARED_NETWORK_CONSTANTS,
    initialDifficultyBits: 10,
    displaySymbol: 'NSR',
    expectedGenesisId: null
});
exports.TESTNET_PARAMS = Object.freeze({
    network: 'testnet',
    ...SHARED_NETWORK_CONSTANTS,
    initialDifficultyBits: 4,
    displaySymbol: 'tNSR',
    expectedGenesisId: null
});
exports.NETWORK_PARAMS_BY_NAME = Object.freeze({
    mainnet: exports.MAINNET_PARAMS,
    testnet: exports.TESTNET_PARAMS
});
function isNetworkName(value) {
    return value === 'mainnet' || value === 'testnet';
}
function assertNetworkName(value) {
    if (!isNetworkName(value)) {
        throw new Error(`invalid network name: ${value}`);
    }
    return value;
}
function getNetworkParams(network) {
    return exports.NETWORK_PARAMS_BY_NAME[network];
}
