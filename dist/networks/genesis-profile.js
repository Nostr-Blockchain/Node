"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENESIS_PROFILE_BYTES = void 0;
exports.createGenesisProfile = createGenesisProfile;
exports.encodeGenesisProfile = encodeGenesisProfile;
exports.decodeGenesisProfile = decodeGenesisProfile;
exports.validateGenesisProfile = validateGenesisProfile;
exports.assertGenesisProfileMatchesParams = assertGenesisProfileMatchesParams;
const primitives_1 = require("../consensus/primitives");
exports.GENESIS_PROFILE_BYTES = 76;
function createGenesisProfile(params) {
    return Object.freeze({
        protocolVersion: params.protocolVersion,
        blockReward: params.blockReward,
        rewardMaturity: params.rewardMaturity,
        powDifficulty: params.initialDifficultyBits,
        baseFee: params.baseFee,
        inputFee: params.inputFee,
        outputFee: params.outputFee,
        maxTxInputs: params.maxTxInputs,
        maxTxOutputs: params.maxTxOutputs,
        maxBlockTransactions: params.maxBlockTransactions
    });
}
function encodeGenesisProfile(profile) {
    validateGenesisProfile(profile);
    const bytes = Buffer.concat([
        Buffer.from([profile.protocolVersion]),
        (0, primitives_1.encodeU128)(profile.blockReward),
        (0, primitives_1.encodeU32)(profile.rewardMaturity),
        Buffer.from([profile.powDifficulty]),
        (0, primitives_1.encodeU128)(profile.baseFee),
        (0, primitives_1.encodeU128)(profile.inputFee),
        (0, primitives_1.encodeU128)(profile.outputFee),
        encodeU16(profile.maxTxInputs),
        encodeU16(profile.maxTxOutputs),
        encodeU16(profile.maxBlockTransactions)
    ]);
    return bytes.toString('hex');
}
function decodeGenesisProfile(contentHex) {
    const bytes = (0, primitives_1.hexToBytes)(contentHex, exports.GENESIS_PROFILE_BYTES);
    const profile = Object.freeze({
        protocolVersion: bytes[0] ?? 0,
        blockReward: (0, primitives_1.decodeU128)(bytes, 1),
        rewardMaturity: (0, primitives_1.decodeU32)(bytes, 17),
        powDifficulty: bytes[21] ?? 0,
        baseFee: (0, primitives_1.decodeU128)(bytes, 22),
        inputFee: (0, primitives_1.decodeU128)(bytes, 38),
        outputFee: (0, primitives_1.decodeU128)(bytes, 54),
        maxTxInputs: (0, primitives_1.decodeU16)(bytes, 70),
        maxTxOutputs: (0, primitives_1.decodeU16)(bytes, 72),
        maxBlockTransactions: (0, primitives_1.decodeU16)(bytes, 74)
    });
    validateGenesisProfile(profile);
    return profile;
}
function validateGenesisProfile(profile) {
    if (profile.protocolVersion !== 0) {
        throw new Error('invalid genesis profile protocol version');
    }
    if (profile.blockReward <= 0n) {
        throw new Error('invalid genesis profile block reward');
    }
    if (profile.rewardMaturity < 1) {
        throw new Error('invalid genesis profile reward maturity');
    }
    if (profile.powDifficulty < 1 || profile.powDifficulty > 63) {
        throw new Error('invalid genesis profile pow difficulty');
    }
    if (profile.baseFee <= 0n || profile.inputFee < 0n || profile.outputFee < 0n) {
        throw new Error('invalid genesis profile fee values');
    }
    if (profile.maxTxInputs < 1 || profile.maxTxOutputs < 1 || profile.maxBlockTransactions < 1) {
        throw new Error('invalid genesis profile limits');
    }
}
function assertGenesisProfileMatchesParams(profile, params) {
    const expectedProfile = createGenesisProfile(params);
    const actualProfileHex = encodeGenesisProfile(profile);
    const expectedProfileHex = encodeGenesisProfile(expectedProfile);
    if (actualProfileHex !== expectedProfileHex) {
        throw new Error(`genesis profile does not match selected ${params.network} network params`);
    }
}
function encodeU16(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
        throw new Error('u16 out of range');
    }
    return Buffer.from([(value >>> 8) & 0xff, value & 0xff]);
}
