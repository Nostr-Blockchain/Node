import { BLOCK_KIND, MAX_SAFE_CREATED_AT, TX_KIND } from './constants';
import { ClassifiedConsensusError, ConsensusError } from './errors';
import { bytesToHex, hexToBytes, sha256, utf8Bytes } from './primitives';
import { CryptoProvider } from '../crypto/provider';

export type NostrTag = string[];

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: NostrTag[];
  content: string;
  sig: string;
}

const EXPECTED_TOP_LEVEL_KEYS = ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'];

export function serializeEventForId(event: Omit<NostrEvent, 'id' | 'sig'>): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function computeEventId(event: Omit<NostrEvent, 'id' | 'sig'>): string {
  return bytesToHex(sha256(utf8Bytes(serializeEventForId(event))));
}

export function validateNip01Event(event: unknown, expectedKind: number, cryptoProvider: CryptoProvider, errorPrefix: 'TX' | 'BLK'): NostrEvent {
  assertRepresentation(typeof event === 'object' && event !== null && !Array.isArray(event), `${errorPrefix}_BAD_JSON`);
  const record = event as Record<string, unknown>;
  const keys = Object.keys(record);
  assertRepresentation(keys.length === 7, `${errorPrefix}_BAD_JSON`);
  assertRepresentation(keys.slice().sort().join(',') === EXPECTED_TOP_LEVEL_KEYS.join(','), `${errorPrefix}_BAD_JSON`);

  const nostrEvent: NostrEvent = {
    id: stringField(record.id, `${errorPrefix}_BAD_JSON`),
    pubkey: stringField(record.pubkey, `${errorPrefix}_BAD_JSON`),
    created_at: numberField(record.created_at, `${errorPrefix}_BAD_JSON`),
    kind: numberField(record.kind, `${errorPrefix}_BAD_JSON`),
    tags: tagField(record.tags, `${errorPrefix}_BAD_JSON`),
    content: stringField(record.content, `${errorPrefix}_BAD_JSON`),
    sig: stringField(record.sig, `${errorPrefix}_BAD_JSON`)
  };

  assertRepresentation(isLowercaseHexOfLength(nostrEvent.id, 32), `${errorPrefix}_BAD_NIP01_ID`);
  assertRepresentation(isLowercaseHexOfLength(nostrEvent.pubkey, 32), `${errorPrefix}_BAD_JSON`);
  assertRepresentation(isLowercaseHexOfLength(nostrEvent.sig, 64), `${errorPrefix}_BAD_SIGNATURE`);
  assertRepresentation(BigInt(nostrEvent.created_at) >= 0n && BigInt(nostrEvent.created_at) <= MAX_SAFE_CREATED_AT, `${errorPrefix}_BAD_JSON`);

  const canonicalEventId = computeEventId({
    pubkey: nostrEvent.pubkey,
    created_at: nostrEvent.created_at,
    kind: nostrEvent.kind,
    tags: nostrEvent.tags,
    content: nostrEvent.content
  });

  assertIntrinsic(Number.isInteger(nostrEvent.kind) && nostrEvent.kind >= 0 && nostrEvent.kind <= 65535, `${errorPrefix}_BAD_KIND`, canonicalEventId);
  assertIntrinsic(nostrEvent.kind === expectedKind, `${errorPrefix}_BAD_KIND`, canonicalEventId);
  assertIntrinsic(cryptoProvider.isValidXOnlyPublicKey(hexToBytes(nostrEvent.pubkey, 32)), `${errorPrefix}_BAD_JSON`, canonicalEventId);

  assertRepresentation(canonicalEventId === nostrEvent.id, `${errorPrefix}_BAD_NIP01_ID`, canonicalEventId);

  const signatureValid = cryptoProvider.verifySchnorr(
    hexToBytes(nostrEvent.pubkey, 32),
    hexToBytes(nostrEvent.id, 32),
    hexToBytes(nostrEvent.sig, 64)
  );
  assertRepresentation(signatureValid, `${errorPrefix}_BAD_SIGNATURE`, canonicalEventId);

  return nostrEvent;
}

export function validateChainKind(kind: number): 'tx' | 'block' {
  if (kind === TX_KIND) return 'tx';
  if (kind === BLOCK_KIND) return 'block';
  throw new ConsensusError('BAD_KIND');
}

function stringField(value: unknown, code: string): string {
  assertRepresentation(typeof value === 'string', code);
  return value;
}

function numberField(value: unknown, code: string): number {
  assertRepresentation(typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && Number.isSafeInteger(value), code);
  return value;
}

function tagField(value: unknown, code: string): NostrTag[] {
  assertRepresentation(Array.isArray(value), code);
  return value.map((tag) => {
    assertIntrinsic(Array.isArray(tag), code, null);
    assertIntrinsic(tag.every((entry) => typeof entry === 'string'), code, null);
    return [...tag] as string[];
  });
}

function isLowercaseHexOfLength(value: string, bytes: number): boolean {
  return value.length === bytes * 2 && /^[0-9a-f]+$/u.test(value);
}

function assertRepresentation(condition: unknown, code: string, canonicalEventId: string | null = null): asserts condition {
  if (!condition) {
    throw new ClassifiedConsensusError(code, 'representation-invalid', canonicalEventId, false);
  }
}

function assertIntrinsic(condition: unknown, code: string, canonicalEventId: string | null): asserts condition {
  if (!condition) {
    throw new ClassifiedConsensusError(code, 'id-intrinsic-invalid', canonicalEventId, canonicalEventId !== null);
  }
}
