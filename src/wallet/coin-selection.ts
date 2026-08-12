import { calculateMinimumBurn } from '../consensus/fees';
import { type UtxoRecord, compareBytes, sortOutpointsCanonical } from '../consensus/primitives';
import { type NetworkParams } from '../networks/params';

export interface WalletSpendableUtxo extends UtxoRecord {}

export interface WalletCoinSelection {
  readonly selectedUtxos: readonly WalletSpendableUtxo[];
  readonly recipientAmount: bigint;
  readonly requestedPriorityFee: bigint;
  readonly actualPriorityFee: bigint;
  readonly minimumBurn: bigint;
  readonly changeAmount: bigint;
  readonly selectedAmount: bigint;
  readonly useChangeOutput: boolean;
}

export function isSpendableWalletUtxo(utxo: WalletSpendableUtxo, candidateHeight: bigint, rewardMaturity: number): boolean {
  return !utxo.isReward || candidateHeight - utxo.createdHeight >= BigInt(rewardMaturity);
}

export function sortWalletUtxosForSelection(utxos: readonly WalletSpendableUtxo[]): WalletSpendableUtxo[] {
  return [...utxos].sort((left, right) => {
    if (left.amount !== right.amount) {
      return left.amount > right.amount ? -1 : 1;
    }
    const sourceCompare = compareBytes(left.sourceId, right.sourceId);
    if (sourceCompare !== 0) {
      return sourceCompare;
    }
    return left.outputIndex - right.outputIndex;
  });
}

export function selectWalletCoins(
  utxos: readonly WalletSpendableUtxo[],
  networkParams: Pick<NetworkParams, 'baseFee' | 'inputFee' | 'outputFee' | 'rewardMaturity' | 'maxTxInputs'>,
  candidateHeight: bigint,
  recipientAmount: bigint,
  requestedPriorityFee: bigint
): WalletCoinSelection {
  const spendableUtxos = sortWalletUtxosForSelection(
    utxos.filter((utxo) => isSpendableWalletUtxo(utxo, candidateHeight, networkParams.rewardMaturity))
  );
  const selectedUtxos: WalletSpendableUtxo[] = [];
  let selectedAmount = 0n;
  for (const utxo of spendableUtxos) {
    if (selectedUtxos.length >= networkParams.maxTxInputs) {
      break;
    }
    selectedUtxos.push(utxo);
    selectedAmount += utxo.amount;
    const oneOutputMinimumBurn = calculateMinimumBurn(networkParams as never, selectedUtxos.length, 1);
    if (selectedAmount >= recipientAmount + oneOutputMinimumBurn + requestedPriorityFee) {
      const oneOutputRemainder = selectedAmount - recipientAmount - oneOutputMinimumBurn - requestedPriorityFee;
      if (oneOutputRemainder === 0n || oneOutputRemainder <= networkParams.outputFee) {
        return {
          selectedUtxos: sortOutpointsCanonical(selectedUtxos),
          recipientAmount,
          requestedPriorityFee,
          actualPriorityFee: requestedPriorityFee + oneOutputRemainder,
          minimumBurn: oneOutputMinimumBurn,
          changeAmount: 0n,
          selectedAmount,
          useChangeOutput: false
        };
      }
      const twoOutputMinimumBurn = calculateMinimumBurn(networkParams as never, selectedUtxos.length, 2);
      return {
        selectedUtxos: sortOutpointsCanonical(selectedUtxos),
        recipientAmount,
        requestedPriorityFee,
        actualPriorityFee: requestedPriorityFee,
        minimumBurn: twoOutputMinimumBurn,
        changeAmount: selectedAmount - recipientAmount - twoOutputMinimumBurn - requestedPriorityFee,
        selectedAmount,
        useChangeOutput: true
      };
    }
  }
  throw new Error(`insufficient spendable funds within ${networkParams.maxTxInputs} inputs`);
}
