import { cacheWalkR1, verifyBlockPow } from '../consensus/pow';
import { leadingZeroBits } from '../consensus/primitives';

export interface MiningWorkInput {
  chainIdHex: string;
  parentIdHex: string;
  eventIdHex: string;
  requiredTarget: bigint;
}

export interface MiningResult {
  eventIdHex: string;
  cpuWorkHex: string;
  success: boolean;
}

export function evaluateCandidatePow(input: MiningWorkInput): MiningResult {
  const eventIdBytes = Buffer.from(input.eventIdHex, 'hex');
  if (leadingZeroBits(eventIdBytes) < 6) {
    return {
      eventIdHex: input.eventIdHex,
      cpuWorkHex: '',
      success: false
    };
  }
  const cpuWork = cacheWalkR1(Buffer.from(input.chainIdHex, 'hex'), Buffer.from(input.parentIdHex, 'hex'), Buffer.from(input.eventIdHex, 'hex'));
  return {
    eventIdHex: input.eventIdHex,
    cpuWorkHex: cpuWork.toString('hex'),
    success: verifyBlockPow({
      chainId: Buffer.from(input.chainIdHex, 'hex'),
      parentId: Buffer.from(input.parentIdHex, 'hex'),
      eventId: Buffer.from(input.eventIdHex, 'hex'),
      requiredTarget: input.requiredTarget,
      nonceGateBits: 6
    })
  };
}
