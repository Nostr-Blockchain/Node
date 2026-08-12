import { GenesisParams } from './genesis';

export interface FeeBreakdown {
  actualFee: bigint;
  minimumBurn: bigint;
  priorityFee: bigint;
}

export function calculateMinimumBurn(params: GenesisParams, inputCount: number, outputCount: number): bigint {
  return 1000n + (250n * BigInt(inputCount)) + (500n * BigInt(outputCount));
}

export function splitFees(sumInputs: bigint, sumOutputs: bigint, params: GenesisParams, inputCount: number, outputCount: number): FeeBreakdown {
  const actualFee = sumInputs - sumOutputs;
  const minimumBurn = calculateMinimumBurn(params, inputCount, outputCount);
  const priorityFee = actualFee - minimumBurn;
  return { actualFee, minimumBurn, priorityFee };
}
