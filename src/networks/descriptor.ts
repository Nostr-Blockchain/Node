import fs from 'node:fs';
import path from 'node:path';

import { parseBlockEvent } from '../consensus/block-codec';
import { validateGenesisEvent } from '../consensus/genesis';
import { validateNip01Event } from '../consensus/nip01';
import { NobleCryptoProvider } from '../crypto/noble-provider';
import { NostrEvent } from '../consensus/nip01';
import { assertGenesisProfileMatchesParams, decodeGenesisProfile } from './genesis-profile';
import { NetworkName, NetworkParams } from './params';

export interface NetworkDescriptorRelay {
  readonly url: string;
}

export interface NetworkDescriptor {
  readonly format: 'nostr-blockchain-network-v0';
  readonly network: NetworkName;
  readonly chain_id: string;
  readonly protocol_version: number;
  readonly display_symbol: string;
  readonly minimum_known_chainwork: string;
  readonly minimum_known_height: number;
  readonly minimum_known_block_id: string;
  readonly genesis_event: NostrEvent;
  readonly bootstrap_relays: readonly NetworkDescriptorRelay[];
}

export interface DescriptorStatus {
  readonly path: string;
  readonly genesisPath: string;
  readonly status: 'VALID' | 'PRELAUNCH_DESCRIPTOR_MISSING' | 'INVALID';
  readonly launched: boolean;
  readonly chainId: string | null;
  readonly descriptorSha256: string | null;
  readonly genesisSha256: string | null;
  readonly error: string | null;
}

export interface VerifiedNetworkArtifacts {
  readonly descriptorPath: string;
  readonly genesisPath: string;
  readonly descriptorFileSha256: string;
  readonly genesisFileSha256: string;
  readonly descriptor: NetworkDescriptor;
  readonly genesisEvent: NostrEvent;
  readonly chainId: string;
}

export function getDescriptorPath(network: NetworkName, baseDir = process.cwd()): string {
  return path.resolve(baseDir, 'networks', `${network}.json`);
}

export function getGenesisArtifactPath(network: NetworkName, baseDir = process.cwd()): string {
  return path.resolve(baseDir, 'networks', `${network}-genesis.json`);
}

export function readDescriptorStatus(params: NetworkParams, baseDir = process.cwd()): DescriptorStatus {
  const descriptorPath = getDescriptorPath(params.network, baseDir);
  const genesisPath = getGenesisArtifactPath(params.network, baseDir);
  if (!fs.existsSync(descriptorPath) || !fs.existsSync(genesisPath)) {
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
  } catch (error) {
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

export function loadGenesisArtifact(network: NetworkName, baseDir = process.cwd()): NostrEvent {
  const artifactPath = getGenesisArtifactPath(network, baseDir);
  return JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as NostrEvent;
}

export function verifyNetworkArtifacts(params: NetworkParams, baseDir = process.cwd()): VerifiedNetworkArtifacts {
  const descriptorPath = getDescriptorPath(params.network, baseDir);
  const genesisPath = getGenesisArtifactPath(params.network, baseDir);
  const descriptorFileText = fs.readFileSync(descriptorPath, 'utf8');
  const genesisFileText = fs.readFileSync(genesisPath, 'utf8');
  const descriptor = validateNetworkDescriptor(JSON.parse(descriptorFileText) as unknown, params);
  const rawGenesisEvent = JSON.parse(genesisFileText) as unknown;
  const cryptoProvider = new NobleCryptoProvider();
  const genesisEvent = validateNip01Event(rawGenesisEvent, params.blockKind, cryptoProvider, 'BLK');
  validateGenesisEvent(genesisEvent, cryptoProvider);
  parseBlockEvent(genesisEvent);
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

export function loadAndValidateNetworkDescriptor(params: NetworkParams, baseDir = process.cwd()): NetworkDescriptor {
  const descriptorPath = getDescriptorPath(params.network, baseDir);
  const sourceText = fs.readFileSync(descriptorPath, 'utf8');
  const rawDescriptor = JSON.parse(sourceText) as unknown;
  return validateNetworkDescriptor(rawDescriptor, params);
}

export function validateNetworkDescriptor(rawDescriptor: unknown, params: NetworkParams): NetworkDescriptor {
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

function validateGenesisEventShape(value: unknown, params: NetworkParams): NostrEvent {
  const event = asRecord(value, 'genesis_event');
  const validatedEvent: NostrEvent = Object.freeze({
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

  assertGenesisProfileMatchesParams(decodeGenesisProfile(validatedEvent.content), params);
  const cryptoProvider = new NobleCryptoProvider();
  validateNip01Event(validatedEvent, params.blockKind, cryptoProvider, 'BLK');
  validateGenesisEvent(validatedEvent, cryptoProvider);
  parseBlockEvent(validatedEvent);
  return validatedEvent;
}

function validateBootstrapRelays(value: unknown): readonly NetworkDescriptorRelay[] {
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

function validateStringMatrix(value: unknown, label: string): string[][] {
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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function getRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function getRequiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  return value as number;
}

function getRequiredDecimalString(record: Record<string, unknown>, key: string): string {
  const value = getRequiredString(record, key);
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${key} must be a canonical decimal string`);
  }
  return value;
}

function getRequiredLowercaseHex(record: Record<string, unknown>, key: string, expectedLength: number): string {
  const value = getRequiredString(record, key);
  if (!new RegExp(`^[0-9a-f]{${expectedLength}}$`, 'u').test(value)) {
    throw new Error(`${key} must be ${expectedLength} lowercase hex characters`);
  }
  return value;
}

function sha256Hex(value: Uint8Array): string {
  return require('node:crypto').createHash('sha256').update(value).digest('hex') as string;
}
