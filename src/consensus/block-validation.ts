import { MAX_U128, REWARD_OUTPUT_INDEX } from './constants';
import { assertConsensus } from './errors';
import { GenesisParams, decodeGenesisContent } from './genesis';
import { NostrEvent } from './nip01';
import { UtxoRecord, compareBytes, hexToBytes } from './primitives';
import { ParsedBlock, parseBlockEvent } from './block-codec';
import { verifyBlockPow } from './pow';
import { TxEvaluation, validateParsedTransaction } from './transaction-validation';
import { ParsedTransaction } from './transaction-codec';
import { UtxoView } from '../state/utxo-view';
import { CryptoProvider } from '../crypto/provider';
import { computeBlockWork } from './difficulty';

export interface BlockValidationContext {
  medianTimePast: number;
  localTime: number;
  requiredTarget: bigint;
}

export interface BlockEvaluation {
  parsedBlock: ParsedBlock;
  txEvaluations: TxEvaluation[];
  consumedOutpoints: UtxoRecord[];
  createdTxOutputs: UtxoRecord[];
  rewardOutput: UtxoRecord | null;
  totalMinimumBurn: bigint;
  totalPriorityFee: bigint;
  blockRewardAmount: bigint;
  requiredTarget: bigint;
  blockWork: bigint;
}

export function validateGenesisBlock(event: NostrEvent): GenesisParams {
  const parsed = parseBlockEvent(event);
  assertConsensus(parsed.isGenesis, 'BLK_BAD_PARENT');
  return decodeGenesisContent(event.content);
}

export function validateBlock(
  event: NostrEvent,
  chainIdHex: string,
  parentId: Buffer,
  candidateHeight: bigint,
  params: GenesisParams,
  transactions: readonly ParsedTransaction[],
  view: UtxoView,
  cryptoProvider: CryptoProvider,
  context: BlockValidationContext
): BlockEvaluation {
  const parsedBlock = parseBlockEvent(event, chainIdHex);
  assertConsensus(!parsedBlock.isGenesis, 'BLK_BAD_PARENT');
  assertConsensus(compareBytes(parsedBlock.parentId!, parentId) === 0, 'BLK_BAD_PARENT');
  assertConsensus(parsedBlock.txIds.length <= params.maxBlockTransactions, 'BLK_BAD_TAGS');
  assertConsensus(transactions.length === parsedBlock.txIds.length, 'BLK_TX_DATA_MISSING');
  assertConsensus(event.created_at > context.medianTimePast, 'BLK_TIME_TOO_OLD');
  assertConsensus(event.created_at <= context.localTime + 120, 'BLK_TIME_FUTURE');
  for (let index = 0; index < transactions.length; index += 1) {
    assertConsensus(compareBytes(hexToBytes(transactions[index]!.event.id, 32), parsedBlock.txIds[index]!) === 0, 'BLK_TX_INVALID');
  }
  const powValid = verifyBlockPow({
    chainId: hexToBytes(chainIdHex, 32),
    parentId,
    eventId: hexToBytes(event.id, 32),
    requiredTarget: context.requiredTarget,
    nonceGateBits: Number(parsedBlock.event.tags[parsedBlock.event.tags.length - 1]![2])
  });
  assertConsensus(powValid, 'BLK_INSUFFICIENT_POW');

  const txEvaluations = transactions.map((transaction) => validateParsedTransaction(transaction, candidateHeight, params, cryptoProvider, view));
  const spentOutpoints = new Set<string>();
  for (const evaluation of txEvaluations) {
    for (const consumed of evaluation.consumedOutpoints) {
      const key = `${consumed.sourceId.toString('hex')}:${consumed.outputIndex}`;
      assertConsensus(!spentOutpoints.has(key), 'BLK_DOUBLE_SPEND');
      spentOutpoints.add(key);
    }
  }

  const totalMinimumBurn = txEvaluations.reduce((sum, evaluation) => sum + evaluation.minimumBurn, 0n);
  const totalPriorityFee = txEvaluations.reduce((sum, evaluation) => sum + evaluation.priorityFee, 0n);
  const blockRewardAmount = params.blockReward + totalPriorityFee;
  assertConsensus(blockRewardAmount <= MAX_U128, 'BLK_REWARD_OVERFLOW');
  const rewardOutput: UtxoRecord = {
    sourceId: Buffer.from(event.id, 'hex'),
    outputIndex: REWARD_OUTPUT_INDEX,
    owner: Buffer.from(event.pubkey, 'hex'),
    amount: blockRewardAmount,
    createdHeight: candidateHeight,
    isReward: true
  };

  return {
    parsedBlock,
    txEvaluations,
    consumedOutpoints: txEvaluations.flatMap((evaluation) => evaluation.consumedOutpoints),
    createdTxOutputs: txEvaluations.flatMap((evaluation) => evaluation.createdOutputs),
    rewardOutput,
    totalMinimumBurn,
    totalPriorityFee,
    blockRewardAmount,
    requiredTarget: context.requiredTarget,
    blockWork: computeBlockWork(context.requiredTarget)
  };
}
