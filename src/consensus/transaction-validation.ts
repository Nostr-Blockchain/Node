import { MAX_U128 } from './constants';
import { splitFees } from './fees';
import { GenesisParams } from './genesis';
import { ParsedTransaction, canonicalizeTransactionData, parseTransactionEvent } from './transaction-codec';
import { ConsensusError, assertConsensus } from './errors';
import { NostrEvent } from './nip01';
import { UtxoRecord, compareBytes, outpointKey } from './primitives';
import { CryptoProvider } from '../crypto/provider';
import { UtxoView } from '../state/utxo-view';

export interface TxEvaluation {
  parsed: ParsedTransaction;
  consumedOutpoints: UtxoRecord[];
  createdOutputs: UtxoRecord[];
  sumInputs: bigint;
  sumOutputs: bigint;
  actualFee: bigint;
  minimumBurn: bigint;
  priorityFee: bigint;
}

export function validateTransactionEvent(
  event: NostrEvent,
  chainIdHex: string,
  candidateHeight: bigint,
  params: GenesisParams,
  cryptoProvider: CryptoProvider,
  view: UtxoView
): TxEvaluation {
  const parsed = parseTransactionEvent(event, chainIdHex);
  return validateParsedTransaction(parsed, candidateHeight, params, cryptoProvider, view);
}

export function validateParsedTransaction(
  parsed: ParsedTransaction,
  candidateHeight: bigint,
  params: GenesisParams,
  cryptoProvider: CryptoProvider,
  view: UtxoView
): TxEvaluation {
  const { event } = parsed;
  const data = canonicalizeTransactionData(parsed.data);
  assertConsensus(data.inputs.length >= 1 && data.inputs.length <= params.maxTxInputs, 'TX_BAD_COUNTS');
  assertConsensus(data.outputs.length >= 1 && data.outputs.length <= params.maxTxOutputs, 'TX_BAD_COUNTS');

  for (let index = 1; index < data.inputs.length; index += 1) {
    const previous = data.inputs[index - 1]!;
    const current = data.inputs[index]!;
    const compare = compareBytes(previous.sourceId, current.sourceId);
    assertConsensus(compare < 0 || (compare === 0 && previous.outputIndex < current.outputIndex), 'TX_INPUT_ORDER');
  }

  const seenOutpoints = new Set<string>();
  const consumedOutpoints: UtxoRecord[] = [];
  let sumInputs = 0n;
  for (const input of data.inputs) {
    const key = outpointKey(input.sourceId, input.outputIndex);
    assertConsensus(!seenOutpoints.has(key), 'TX_DUPLICATE_INPUT');
    seenOutpoints.add(key);
    const utxo = view.getUtxo(input.sourceId, input.outputIndex);
    assertConsensus(utxo !== null, 'TX_INPUT_MISSING');
    assertConsensus(compareBytes(utxo.owner, Buffer.from(event.pubkey, 'hex')) === 0, 'TX_WRONG_OWNER');
    if (utxo.isReward) {
      assertConsensus(candidateHeight - utxo.createdHeight >= BigInt(params.rewardMaturity), 'TX_IMMATURE_REWARD');
    }
    consumedOutpoints.push(utxo);
    sumInputs += utxo.amount;
    assertConsensus(sumInputs <= MAX_U128 * BigInt(data.inputs.length), 'TX_VALUE_OVERFLOW');
  }

  const createdOutputs: UtxoRecord[] = [];
  let sumOutputs = 0n;
  data.outputs.forEach((output, index) => {
    assertConsensus(output.amount > 0n, 'TX_OUTPUT_ZERO');
    assertConsensus(cryptoProvider.isValidXOnlyPublicKey(output.ownerPubkey), 'TX_BAD_OUTPUT_KEY');
    sumOutputs += output.amount;
    assertConsensus(sumOutputs <= MAX_U128 * BigInt(data.outputs.length), 'TX_VALUE_OVERFLOW');
    createdOutputs.push({
      sourceId: Buffer.from(event.id, 'hex'),
      outputIndex: index,
      owner: output.ownerPubkey,
      amount: output.amount,
      createdHeight: candidateHeight,
      isReward: false
    });
  });

  assertConsensus(sumInputs >= sumOutputs, 'TX_OUTPUTS_EXCEED_INPUTS');
  const fees = splitFees(sumInputs, sumOutputs, params, data.inputs.length, data.outputs.length);
  assertConsensus(fees.actualFee >= fees.minimumBurn, 'TX_FEE_TOO_LOW');
  assertConsensus(fees.priorityFee <= MAX_U128 - params.blockReward, 'TX_PRIORITY_TOO_LARGE');

  return {
    parsed: {
      ...parsed,
      data
    },
    consumedOutpoints,
    createdOutputs,
    sumInputs,
    sumOutputs,
    actualFee: fees.actualFee,
    minimumBurn: fees.minimumBurn,
    priorityFee: fees.priorityFee
  };
}
