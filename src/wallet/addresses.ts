import { bech32 } from '@scure/base';

import { NobleCryptoProvider } from '../crypto/noble-provider';

const cryptoProvider = new NobleCryptoProvider();

export function toNpub(pubkeyHex: string): string {
  const words = bech32.toWords(Buffer.from(pubkeyHex, 'hex'));
  return bech32.encode('npub', words, 5000);
}

export function parseRecipient(recipientText: string): Buffer {
  if (/^[0-9a-f]{64}$/u.test(recipientText)) {
    const recipientPubkey = Buffer.from(recipientText, 'hex');
    if (!cryptoProvider.isValidXOnlyPublicKey(recipientPubkey)) {
      throw new Error('invalid raw recipient pubkey');
    }
    return recipientPubkey;
  }
  try {
    const decoded = bech32.decode(recipientText as `${string}1${string}`, 5000);
    if (decoded.prefix !== 'npub') {
      throw new Error('invalid npub prefix');
    }
    const recipientPubkey = Buffer.from(bech32.fromWords(decoded.words));
    if (recipientPubkey.length !== 32 || !cryptoProvider.isValidXOnlyPublicKey(recipientPubkey)) {
      throw new Error('invalid npub recipient pubkey');
    }
    return recipientPubkey;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'invalid recipient');
  }
}
