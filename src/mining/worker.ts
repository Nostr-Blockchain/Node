import { isMainThread, parentPort } from 'node:worker_threads';

import { buildBlockTags } from '../consensus/block-codec';
import { computeEventId } from '../consensus/nip01';
import { cacheWalkR1, verifyBlockPow } from '../consensus/pow';
import { hasLeadingZeroBits } from '../consensus/primitives';
import { CacheWalkR1Params } from '../networks/params';

export interface MiningWorkInput {
  chainIdHex: string;
  parentIdHex: string;
  eventIdHex: string;
  requiredDifficulty: number;
  fixedGateBits?: number;
  cacheWalkR1?: CacheWalkR1Params;
}

export interface MiningResult {
  eventIdHex: string;
  cpuWorkHex: string;
  success: boolean;
  nonce?: string;
  attempts?: number;
}

export interface WorkerSearchInput {
  readonly chainIdHex: string;
  readonly parentIdHex: string;
  readonly minerPubkeyHex: string;
  readonly txIds: readonly string[];
  readonly requiredDifficulty: number;
  readonly createdAt: number;
  readonly startNonce: string;
  readonly nonceStep: string;
  readonly maxAttempts: number;
  readonly fixedGateBits?: number;
  readonly cacheWalkR1?: CacheWalkR1Params;
}

export function evaluateCandidatePow(input: MiningWorkInput): MiningResult {
  const eventIdBytes = Buffer.from(input.eventIdHex, 'hex');
  const fixedGateBits = input.fixedGateBits ?? 6;
  if (!hasLeadingZeroBits(eventIdBytes, fixedGateBits)) {
    return {
      eventIdHex: input.eventIdHex,
      cpuWorkHex: '',
      success: false
    };
  }
  const cpuWork = cacheWalkR1(Buffer.from(input.chainIdHex, 'hex'), Buffer.from(input.parentIdHex, 'hex'), Buffer.from(input.eventIdHex, 'hex'), input.cacheWalkR1);
  return {
    eventIdHex: input.eventIdHex,
    cpuWorkHex: cpuWork.toString('hex'),
    success: verifyBlockPow({
      chainId: Buffer.from(input.chainIdHex, 'hex'),
      parentId: Buffer.from(input.parentIdHex, 'hex'),
      eventId: Buffer.from(input.eventIdHex, 'hex'),
      requiredDifficulty: input.requiredDifficulty,
      nonceGateBits: fixedGateBits,
      cacheWalkR1: input.cacheWalkR1
    })
  };
}

export function searchWinningNonce(input: WorkerSearchInput): MiningResult {
  let nonce = BigInt(input.startNonce);
  const nonceStep = BigInt(input.nonceStep);
  for (let attempts = 0; attempts < input.maxAttempts; attempts += 1) {
    const eventIdHex = computeEventId({
      pubkey: input.minerPubkeyHex,
      created_at: input.createdAt,
      kind: 7343,
      tags: buildBlockTags(input.chainIdHex, input.parentIdHex, [...input.txIds], nonce),
      content: '00'
    });
    const result = evaluateCandidatePow({
      chainIdHex: input.chainIdHex,
      parentIdHex: input.parentIdHex,
      eventIdHex,
      requiredDifficulty: input.requiredDifficulty,
      fixedGateBits: input.fixedGateBits,
      cacheWalkR1: input.cacheWalkR1
    });
    if (result.success) {
      return {
        ...result,
        nonce: nonce.toString(10),
        attempts: attempts + 1
      };
    }
    nonce += nonceStep;
  }
  return {
    eventIdHex: '',
    cpuWorkHex: '',
    success: false,
    attempts: input.maxAttempts
  };
}

if (!isMainThread && parentPort !== null) {
  parentPort.on('message', (message: WorkerSearchInput) => {
    parentPort?.postMessage(searchWinningNonce(message));
  });
}
