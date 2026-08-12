#!/usr/bin/env node
export { buildSignedTransactionEvent } from '../wallet/builder';

function main(): void {
  const [, , command] = process.argv;
  if (command === undefined) {
    process.stdout.write('{"deprecated":"use nostr-blockchain CLI"}\n');
    return;
  }
  throw new Error('prototype wallet tool is deprecated; use nostr-blockchain wallet/send commands');
}

if (require.main === module) {
  main();
}
