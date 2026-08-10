#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

import { NobleCryptoProvider } from '../crypto/noble-provider';
import { bytesToHex } from '../consensus/primitives';
import { bech32 } from '@scure/base';
import { computeEventId, NostrEvent } from '../consensus/nip01';
import { deriveTransactionTags, encodeTransactionContent, TransactionData } from '../consensus/transaction-codec';

function toNpub(pubkeyHex: string): string {
  const words = bech32.toWords(Buffer.from(pubkeyHex, 'hex'));
  return bech32.encode('npub', words, 5000);
}

export function buildSignedTransactionEvent(secretHex: string, chainIdHex: string, createdAt: number, data: TransactionData): NostrEvent {
  const provider = new NobleCryptoProvider();
  const secret = Buffer.from(secretHex, 'hex');
  const pubkey = bytesToHex(provider.deriveXOnlyPublicKey(secret));
  const unsigned = {
    pubkey,
    created_at: createdAt,
    kind: 7342,
    tags: deriveTransactionTags(chainIdHex, data),
    content: encodeTransactionContent(data)
  };
  const id = computeEventId(unsigned);
  return {
    ...unsigned,
    id,
    sig: bytesToHex(provider.signSchnorr(secret, Buffer.from(id, 'hex')))
  };
}

function main(): void {
  const [, , command, ...args] = process.argv;
  const provider = new NobleCryptoProvider();
  if (command === 'key') {
    const secret = randomBytes(32);
    const pubkey = provider.deriveXOnlyPublicKey(secret);
    console.log(JSON.stringify({ secret: bytesToHex(secret), pubkey: bytesToHex(pubkey), npub: toNpub(bytesToHex(pubkey)) }, null, 2));
    return;
  }
  if (command === 'sign-tx') {
    const [secretHex, chainIdHex, createdAtText, dataJson] = args;
    if (secretHex === undefined || chainIdHex === undefined || createdAtText === undefined || dataJson === undefined) {
      throw new Error('usage: sign-tx <secretHex> <chainIdHex> <createdAt> <transactionDataJson>');
    }
    console.log(JSON.stringify(buildSignedTransactionEvent(secretHex, chainIdHex, Number(createdAtText), JSON.parse(dataJson) as TransactionData), null, 2));
    return;
  }
  console.log(JSON.stringify({ command }, null, 2));
}

main();
