import { schnorr, secp256k1 } from '@noble/curves/secp256k1';

import { CryptoProvider } from './provider';

export class NobleCryptoProvider implements CryptoProvider {
  public isValidXOnlyPublicKey(pubkey32: Uint8Array): boolean {
    try {
      const compressed = Buffer.concat([Buffer.from([0x02]), Buffer.from(pubkey32)]);
      secp256k1.ProjectivePoint.fromHex(compressed);
      return true;
    } catch {
      return false;
    }
  }

  public verifySchnorr(pubkey32: Uint8Array, message32: Uint8Array, signature64: Uint8Array): boolean {
    try {
      return schnorr.verify(signature64, message32, pubkey32);
    } catch {
      return false;
    }
  }

  public signSchnorr(secret32: Uint8Array, message32: Uint8Array): Uint8Array {
    return schnorr.sign(message32, secret32);
  }

  public deriveXOnlyPublicKey(secret32: Uint8Array): Uint8Array {
    return schnorr.getPublicKey(secret32);
  }
}
