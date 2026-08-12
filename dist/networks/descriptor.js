"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDescriptorPath = getDescriptorPath;
exports.getGenesisArtifactPath = getGenesisArtifactPath;
exports.readDescriptorStatus = readDescriptorStatus;
exports.loadGenesisArtifact = loadGenesisArtifact;
exports.verifyNetworkArtifacts = verifyNetworkArtifacts;
exports.loadAndValidateNetworkDescriptor = loadAndValidateNetworkDescriptor;
exports.validateNetworkDescriptor = validateNetworkDescriptor;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const block_codec_1 = require("../consensus/block-codec");
const genesis_1 = require("../consensus/genesis");
const nip01_1 = require("../consensus/nip01");
const noble_provider_1 = require("../crypto/noble-provider");
const genesis_profile_1 = require("./genesis-profile");
function getDescriptorPath(network, baseDir = process.cwd()) {
    return node_path_1.default.resolve(baseDir, 'networks', `${network}.json`);
}
function getGenesisArtifactPath(network, baseDir = process.cwd()) {
    return node_path_1.default.resolve(baseDir, 'networks', `${network}-genesis.json`);
}
function readDescriptorStatus(params, baseDir = process.cwd()) {
    const descriptorPath = getDescriptorPath(params.network, baseDir);
    const genesisPath = getGenesisArtifactPath(params.network, baseDir);
    if (!node_fs_1.default.existsSync(descriptorPath) || !node_fs_1.default.existsSync(genesisPath)) {
        return {
            path: descriptorPath,
            genesisPath,
            status: 'PRELAUNCH_DESCRIPTOR_MISSING',
            launched: false,
            chainId: null,
            descriptorSha256: null,
            genesisSha256: null,
            error: null
        };
    }
    try {
        const verifiedArtifacts = verifyNetworkArtifacts(params, baseDir);
        return {
            path: descriptorPath,
            genesisPath,
            status: 'VALID',
            launched: true,
            chainId: verifiedArtifacts.chainId,
            descriptorSha256: verifiedArtifacts.descriptorFileSha256,
            genesisSha256: verifiedArtifacts.genesisFileSha256,
            error: null
        };
    }
    catch (error) {
        return {
            path: descriptorPath,
            genesisPath,
            status: 'INVALID',
            launched: true,
            chainId: null,
            descriptorSha256: null,
            genesisSha256: null,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
function loadGenesisArtifact(network, baseDir = process.cwd()) {
    const artifactPath = getGenesisArtifactPath(network, baseDir);
    return JSON.parse(node_fs_1.default.readFileSync(artifactPath, 'utf8'));
}
function verifyNetworkArtifacts(params, baseDir = process.cwd()) {
    const descriptorPath = getDescriptorPath(params.network, baseDir);
    const genesisPath = getGenesisArtifactPath(params.network, baseDir);
    const descriptorFileText = node_fs_1.default.readFileSync(descriptorPath, 'utf8');
    const genesisFileText = node_fs_1.default.readFileSync(genesisPath, 'utf8');
    const descriptor = validateNetworkDescriptor(JSON.parse(descriptorFileText), params);
    const rawGenesisEvent = JSON.parse(genesisFileText);
    const cryptoProvider = new noble_provider_1.NobleCryptoProvider();
    const genesisEvent = (0, nip01_1.validateNip01Event)(rawGenesisEvent, params.blockKind, cryptoProvider, 'BLK');
    (0, genesis_1.validateGenesisEvent)(genesisEvent, cryptoProvider);
    (0, block_codec_1.parseBlockEvent)(genesisEvent);
    if (descriptor.genesis_event.id !== genesisEvent.id) {
        throw new Error('descriptor genesis event id does not match standalone genesis artifact');
    }
    if (JSON.stringify(descriptor.genesis_event) !== JSON.stringify(genesisEvent)) {
        throw new Error('descriptor genesis event does not match standalone genesis artifact');
    }
    return {
        descriptorPath,
        genesisPath,
        descriptorFileSha256: sha256Hex(Buffer.from(descriptorFileText, 'utf8')),
        genesisFileSha256: sha256Hex(Buffer.from(genesisFileText, 'utf8')),
        descriptor,
        genesisEvent,
        chainId: descriptor.chain_id
    };
}
function loadAndValidateNetworkDescriptor(params, baseDir = process.cwd()) {
    const descriptorPath = getDescriptorPath(params.network, baseDir);
    const sourceText = node_fs_1.default.readFileSync(descriptorPath, 'utf8');
    const rawDescriptor = JSON.parse(sourceText);
    return validateNetworkDescriptor(rawDescriptor, params);
}
function validateNetworkDescriptor(rawDescriptor, params) {
    const descriptor = asRecord(rawDescriptor, 'descriptor');
    const network = getRequiredString(descriptor, 'network');
    if (network !== params.network) {
        throw new Error(`descriptor network mismatch: expected ${params.network}, got ${network}`);
    }
    const format = getRequiredString(descriptor, 'format');
    if (format !== 'nostr-blockchain-network-v0') {
        throw new Error('descriptor format mismatch');
    }
    const chainId = getRequiredLowercaseHex(descriptor, 'chain_id', 64);
    const protocolVersion = getRequiredInteger(descriptor, 'protocol_version');
    if (protocolVersion !== params.protocolVersion) {
        throw new Error('descriptor protocol version mismatch');
    }
    const displaySymbol = getRequiredString(descriptor, 'display_symbol');
    if (displaySymbol !== params.displaySymbol) {
        throw new Error('descriptor display symbol mismatch');
    }
    const minimumKnownChainwork = getRequiredDecimalString(descriptor, 'minimum_known_chainwork');
    const minimumKnownHeight = getRequiredInteger(descriptor, 'minimum_known_height');
    if (minimumKnownHeight < 0) {
        throw new Error('descriptor minimum_known_height must be non-negative');
    }
    const minimumKnownBlockId = getRequiredLowercaseHex(descriptor, 'minimum_known_block_id', 64);
    const genesisEvent = validateGenesisEventShape(descriptor.genesis_event, params);
    if (chainId !== genesisEvent.id) {
        throw new Error('descriptor chain_id does not equal genesis_event.id');
    }
    if (params.expectedGenesisId !== null && chainId !== params.expectedGenesisId) {
        throw new Error(`descriptor chain_id does not match frozen ${params.network} genesis id`);
    }
    if (minimumKnownHeight === 0 && minimumKnownBlockId !== chainId) {
        throw new Error('descriptor minimum known block must match chain_id at height 0');
    }
    const bootstrapRelays = validateBootstrapRelays(descriptor.bootstrap_relays);
    return Object.freeze({
        format: 'nostr-blockchain-network-v0',
        network: params.network,
        chain_id: chainId,
        protocol_version: protocolVersion,
        display_symbol: displaySymbol,
        minimum_known_chainwork: minimumKnownChainwork,
        minimum_known_height: minimumKnownHeight,
        minimum_known_block_id: minimumKnownBlockId,
        genesis_event: genesisEvent,
        bootstrap_relays: bootstrapRelays
    });
}
function validateGenesisEventShape(value, params) {
    const event = asRecord(value, 'genesis_event');
    const validatedEvent = Object.freeze({
        id: getRequiredLowercaseHex(event, 'id', 64),
        pubkey: getRequiredLowercaseHex(event, 'pubkey', 64),
        created_at: getRequiredInteger(event, 'created_at'),
        kind: getRequiredInteger(event, 'kind'),
        tags: validateStringMatrix(event.tags, 'genesis_event.tags'),
        content: getRequiredLowercaseHex(event, 'content', 152),
        sig: getRequiredLowercaseHex(event, 'sig', 128)
    });
    if (validatedEvent.kind !== params.blockKind) {
        throw new Error('descriptor genesis event kind mismatch');
    }
    (0, genesis_profile_1.assertGenesisProfileMatchesParams)((0, genesis_profile_1.decodeGenesisProfile)(validatedEvent.content), params);
    const cryptoProvider = new noble_provider_1.NobleCryptoProvider();
    (0, nip01_1.validateNip01Event)(validatedEvent, params.blockKind, cryptoProvider, 'BLK');
    (0, genesis_1.validateGenesisEvent)(validatedEvent, cryptoProvider);
    (0, block_codec_1.parseBlockEvent)(validatedEvent);
    return validatedEvent;
}
function validateBootstrapRelays(value) {
    if (!Array.isArray(value)) {
        throw new Error('descriptor bootstrap_relays must be an array');
    }
    return Object.freeze(value.map((entry, index) => {
        const relay = asRecord(entry, `bootstrap_relays[${index}]`);
        const url = getRequiredString(relay, 'url');
        if (!url.startsWith('wss://')) {
            throw new Error('descriptor bootstrap relay must use wss://');
        }
        return Object.freeze({ url });
    }));
}
function validateStringMatrix(value, label) {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`);
    }
    return value.map((row, rowIndex) => {
        if (!Array.isArray(row)) {
            throw new Error(`${label}[${rowIndex}] must be an array`);
        }
        return row.map((entry, columnIndex) => {
            if (typeof entry !== 'string') {
                throw new Error(`${label}[${rowIndex}][${columnIndex}] must be a string`);
            }
            return entry;
        });
    });
}
function asRecord(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}
function getRequiredString(record, key) {
    const value = record[key];
    if (typeof value !== 'string') {
        throw new Error(`${key} must be a string`);
    }
    return value;
}
function getRequiredInteger(record, key) {
    const value = record[key];
    if (!Number.isInteger(value)) {
        throw new Error(`${key} must be an integer`);
    }
    return value;
}
function getRequiredDecimalString(record, key) {
    const value = getRequiredString(record, key);
    if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
        throw new Error(`${key} must be a canonical decimal string`);
    }
    return value;
}
function getRequiredLowercaseHex(record, key, expectedLength) {
    const value = getRequiredString(record, key);
    if (!new RegExp(`^[0-9a-f]{${expectedLength}}$`, 'u').test(value)) {
        throw new Error(`${key} must be ${expectedLength} lowercase hex characters`);
    }
    return value;
}
function sha256Hex(value) {
    return require('node:crypto').createHash('sha256').update(value).digest('hex');
}
