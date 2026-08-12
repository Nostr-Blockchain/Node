import { createHash } from 'node:crypto';

import { schnorr } from '@noble/curves/secp256k1';

export interface ReferenceEventFields {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface ReferenceSignedEvent extends ReferenceEventFields {
  id: string;
  sig: string;
}

export function serializeReferenceEventForId(event: ReferenceEventFields): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function computeReferenceEventId(event: ReferenceEventFields): string {
  return createHash('sha256').update(Buffer.from(serializeReferenceEventForId(event), 'utf8')).digest('hex');
}

export function verifyReferenceSchnorrEvent(event: ReferenceSignedEvent): boolean {
  try {
    return schnorr.verify(event.sig, hexToBytes(event.id, 32), hexToBytes(event.pubkey, 32));
  } catch {
    return false;
  }
}

export function signReferenceEvent(secretKeyHex: string, event: ReferenceEventFields): ReferenceSignedEvent {
  const id = computeReferenceEventId(event);
  return {
    ...event,
    id,
    sig: Buffer.from(schnorr.sign(hexToBytes(id, 32), hexToBytes(secretKeyHex, 32))).toString('hex')
  };
}

function hexToBytes(value: string, expectedBytes: number): Buffer {
  if (!/^[0-9a-f]+$/u.test(value) || value.length !== expectedBytes * 2) {
    throw new Error(`expected ${expectedBytes} lowercase hex bytes`);
  }
  return Buffer.from(value, 'hex');
}
