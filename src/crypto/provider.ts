export interface CryptoProvider {
  isValidXOnlyPublicKey(pubkey32: Uint8Array): boolean;
  verifySchnorr(pubkey32: Uint8Array, message32: Uint8Array, signature64: Uint8Array): boolean;
  signSchnorr(secret32: Uint8Array, message32: Uint8Array): Uint8Array;
  deriveXOnlyPublicKey(secret32: Uint8Array): Uint8Array;
}
