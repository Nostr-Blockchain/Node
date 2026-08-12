import { type BlockSigner } from '../mining/signer';
import { type NostrEvent, computeEventId, validateNip01Event } from '../consensus/nip01';
import { deriveTransactionTags, encodeTransactionContent, parseTransactionEvent, type TransactionData } from '../consensus/transaction-codec';
import { validateParsedTransaction } from '../consensus/transaction-validation';
import { type UtxoView } from '../state/utxo-view';
import { NobleCryptoProvider } from '../crypto/noble-provider';
import { type NetworkParams } from '../networks/params';
import { type GenesisParams } from '../consensus/genesis';
import { parseRecipient } from './addresses';
import { parseDecimalAmount } from './amounts';
import { selectWalletCoins, type WalletCoinSelection, type WalletSpendableUtxo } from './coin-selection';

const cryptoProvider = new NobleCryptoProvider();

export interface WalletBuildInput {
  readonly signer: BlockSigner;
  readonly chainIdHex: string;
  readonly networkParams: NetworkParams;
  readonly walletUtxos: readonly WalletSpendableUtxo[];
  readonly candidateHeight: bigint;
  readonly createdAt: number;
  readonly recipientText: string;
  readonly amountText: string;
  readonly priorityFeeText: string;
  readonly view: UtxoView;
}

export interface WalletBuildResult {
  readonly event: NostrEvent;
  readonly selection: WalletCoinSelection;
  readonly recipientPubkeyHex: string;
  readonly actualFee: bigint;
}

export function buildSignedTransactionEvent(secretHex: string, chainIdHex: string, createdAt: number, data: TransactionData): NostrEvent {
  const signer = {
    getPublicKeyHex(): string {
      return Buffer.from(cryptoProvider.deriveXOnlyPublicKey(Buffer.from(secretHex, 'hex'))).toString('hex');
    },
    signEventId(eventIdHex: string): string {
      return Buffer.from(cryptoProvider.signSchnorr(Buffer.from(secretHex, 'hex'), Buffer.from(eventIdHex, 'hex'))).toString('hex');
    }
  } satisfies BlockSigner;
  return signTransactionData(signer, chainIdHex, createdAt, data);
}

export function buildWalletTransaction(input: WalletBuildInput): WalletBuildResult {
  const recipientAmount = parseDecimalAmount(input.amountText, false);
  const requestedPriorityFee = parseDecimalAmount(input.priorityFeeText, true);
  const recipientPubkey = parseRecipient(input.recipientText);
  const selection = selectWalletCoins(
    input.walletUtxos,
    input.networkParams,
    input.candidateHeight,
    recipientAmount,
    requestedPriorityFee
  );
  const data: TransactionData = {
    version: input.networkParams.protocolVersion,
    inputs: selection.selectedUtxos.map((utxo) => ({
      sourceId: Buffer.from(utxo.sourceId),
      outputIndex: utxo.outputIndex
    })),
    outputs: [
      { ownerPubkey: Buffer.from(recipientPubkey), amount: selection.recipientAmount },
      ...(selection.useChangeOutput
        ? [{ ownerPubkey: Buffer.from(input.signer.getPublicKeyHex(), 'hex'), amount: selection.changeAmount }]
        : [])
    ]
  };
  const event = signTransactionData(input.signer, input.chainIdHex, input.createdAt, data);
  validateNip01Event(event, input.networkParams.txKind, cryptoProvider, 'TX');
  const parsed = parseTransactionEvent(event, input.chainIdHex);
  const evaluation = validateParsedTransaction(parsed, input.candidateHeight, toGenesisParams(input.networkParams), cryptoProvider, input.view);
  return {
    event,
    selection,
    recipientPubkeyHex: recipientPubkey.toString('hex'),
    actualFee: evaluation.actualFee
  };
}

function toGenesisParams(networkParams: NetworkParams): GenesisParams {
  return {
    protocolVersion: networkParams.protocolVersion,
    blockReward: networkParams.blockReward,
    rewardMaturity: networkParams.rewardMaturity,
    powDifficulty: networkParams.initialDifficultyBits,
    baseFee: networkParams.baseFee,
    inputFee: networkParams.inputFee,
    outputFee: networkParams.outputFee,
    maxTxInputs: networkParams.maxTxInputs,
    maxTxOutputs: networkParams.maxTxOutputs,
    maxBlockTransactions: networkParams.maxBlockTransactions
  };
}

function signTransactionData(signer: BlockSigner, chainIdHex: string, createdAt: number, data: TransactionData): NostrEvent {
  const unsignedEvent = {
    pubkey: signer.getPublicKeyHex(),
    created_at: createdAt,
    kind: 7342,
    tags: deriveTransactionTags(chainIdHex, data),
    content: encodeTransactionContent(data)
  };
  const eventId = computeEventId(unsignedEvent);
  return {
    ...unsignedEvent,
    id: eventId,
    sig: signer.signEventId(eventId)
  };
}
