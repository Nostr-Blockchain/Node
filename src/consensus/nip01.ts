import { BLOCK_KIND, MAX_SAFE_CREATED_AT, TX_KIND } from './constants';
import { ConsensusError, assertConsensus } from './errors';
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

export function serializeEventForId(event: Omit<NostrEvent, 'id' | 'sig'>): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function computeEventId(event: Omit<NostrEvent, 'id' | 'sig'>): string {
  return bytesToHex(sha256(utf8Bytes(serializeEventForId(event))));
}

export function validateNip01Event(event: unknown, expectedKind: number, cryptoProvider: CryptoProvider, errorPrefix: 'TX' | 'BLK'): NostrEvent {
  assertConsensus(typeof event === 'object' && event !== null && !Array.isArray(event), `${errorPrefix}_BAD_JSON`);
  const record = event as Record<string, unknown>;
  const keys = Object.keys(record);
  assertConsensus(keys.length === 7, `${errorPrefix}_BAD_JSON`);
  const expectedKeys = ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'];
  assertConsensus(keys.slice().sort().join(',') === expectedKeys.join(','), `${errorPrefix}_BAD_JSON`);

  const nostrEvent: NostrEvent = {
    id: stringField(record.id, `${errorPrefix}_BAD_JSON`),
    pubkey: stringField(record.pubkey, `${errorPrefix}_BAD_JSON`),
    created_at: numberField(record.created_at, `${errorPrefix}_BAD_JSON`),
    kind: numberField(record.kind, `${errorPrefix}_BAD_JSON`),
    tags: tagField(record.tags, `${errorPrefix}_BAD_JSON`),
    content: stringField(record.content, `${errorPrefix}_BAD_JSON`),
    sig: stringField(record.sig, `${errorPrefix}_BAD_JSON`)
  };

  assertHex(nostrEvent.id, 32, `${errorPrefix}_BAD_NIP01_ID`);
  assertHex(nostrEvent.pubkey, 32, `${errorPrefix}_BAD_JSON`);
  assertHex(nostrEvent.sig, 64, `${errorPrefix}_BAD_SIGNATURE`);
  assertConsensus(BigInt(nostrEvent.created_at) >= 0n && BigInt(nostrEvent.created_at) <= MAX_SAFE_CREATED_AT, `${errorPrefix}_BAD_JSON`);
  assertConsensus(Number.isInteger(nostrEvent.kind) && nostrEvent.kind >= 0 && nostrEvent.kind <= 65535, `${errorPrefix}_BAD_KIND`);
  assertConsensus(nostrEvent.kind === expectedKind, `${errorPrefix}_BAD_KIND`);
  assertConsensus(cryptoProvider.isValidXOnlyPublicKey(hexToBytes(nostrEvent.pubkey, 32)), `${errorPrefix}_BAD_JSON`);

  const recomputed = computeEventId({
    pubkey: nostrEvent.pubkey,
    created_at: nostrEvent.created_at,
    kind: nostrEvent.kind,
    tags: nostrEvent.tags,
    content: nostrEvent.content
  });
  assertConsensus(recomputed === nostrEvent.id, `${errorPrefix}_BAD_NIP01_ID`);

  const signatureValid = cryptoProvider.verifySchnorr(
    hexToBytes(nostrEvent.pubkey, 32),
    hexToBytes(nostrEvent.id, 32),
    hexToBytes(nostrEvent.sig, 64)
  );
  assertConsensus(signatureValid, `${errorPrefix}_BAD_SIGNATURE`);

  return nostrEvent;
}

export function validateChainKind(kind: number): 'tx' | 'block' {
  if (kind === TX_KIND) return 'tx';
  if (kind === BLOCK_KIND) return 'block';
  throw new ConsensusError('BAD_KIND');
}

function stringField(value: unknown, code: string): string {
  assertConsensus(typeof value === 'string', code);
  return value;
}

function numberField(value: unknown, code: string): number {
  assertConsensus(typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value), code);
  return value;
}

function tagField(value: unknown, code: string): NostrTag[] {
  assertConsensus(Array.isArray(value), code);
  return value.map((tag) => {
    assertConsensus(Array.isArray(tag), code);
    assertConsensus(tag.every((entry) => typeof entry === 'string'), code);
    return [...tag] as string[];
  });
}

function assertHex(value: string, bytes: number, code: string): void {
  assertConsensus(/^[0-9a-f]+$/.test(value), code);
  assertConsensus(value.length === bytes * 2, code);
}
