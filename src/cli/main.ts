#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { parseStrictJson } from '../nostr/strict-json';
import { NodeRuntime } from '../node/runtime';
import { NostrEvent } from '../consensus/nip01';

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const dataDir = path.resolve(process.cwd(), 'data');
  const runtime = NodeRuntime.create(dataDir);

  if (command === 'status') {
    console.log(JSON.stringify(runtime.getStatus(), null, 2));
    return;
  }

  if (command === 'replay') {
    const filePath = args[0];
    if (filePath === undefined) {
      throw new Error('missing replay file path');
    }
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.length > 0);
    const events = lines.map((line) => parseStrictJson(line) as NostrEvent);
    const genesis = events.find((event) => event.tags[0]?.[1] === 'nostr-blockchain:genesis');
    if (genesis === undefined) {
      throw new Error('replay requires genesis event');
    }
    await runtime.start(genesis);
    const result = runtime.replayFromEvents(events);
    console.log(JSON.stringify({
      chainId: genesis.id,
      activeTip: result.snapshot.activeTip,
      height: result.snapshot.activeHeight.toString(10),
      bestTips: result.bestTips,
      utxoDigest: result.snapshot.utxoDigest,
      utxoCount: result.snapshot.utxos.length,
      cumulativeFixedRewards: result.snapshot.cumulativeFixedRewards.toString(10),
      cumulativeMinimumBurns: result.snapshot.cumulativeMinimumBurns.toString(10),
      cumulativePriorityFees: result.snapshot.cumulativePriorityFees.toString(10),
      totalSupply: result.snapshot.totalSupply.toString(10),
      pending: result.pending
    }, null, 2));
    await runtime.shutdown();
    return;
  }

  if (command === 'verify') {
    console.log(JSON.stringify(runtime.verify(), null, 2));
    return;
  }

  if (command === 'reindex') {
    runtime.reindex();
    console.log(JSON.stringify(runtime.getStatus(), null, 2));
    return;
  }

  if (command === 'mempool') {
    console.log(JSON.stringify(runtime.getMempoolTransactions(), null, 2));
    return;
  }

  if (command === 'balance') {
    const pubkey = args[0];
    if (pubkey === undefined) {
      throw new Error('missing pubkey');
    }
    console.log(JSON.stringify({ pubkey, balance: runtime.getBalance(pubkey).toString(10) }, null, 2));
    return;
  }

  if (command === 'utxos') {
    const pubkey = args[0];
    if (pubkey === undefined) {
      throw new Error('missing pubkey');
    }
    console.log(JSON.stringify(runtime.listUtxos(pubkey), null, 2));
    return;
  }

  console.log(JSON.stringify({ command, args }, null, 2));
}

void main();
