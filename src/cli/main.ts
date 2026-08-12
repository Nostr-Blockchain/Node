#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { getControlSocketPath, sendLocalControlRequest, hasControlSocket, readControlMetadata } from '../control/local-socket';
import { runDoctor } from '../diagnostics/doctor';
import { buildRuntimeStatus, formatStatusHuman } from '../diagnostics/status';
import { computeStateHash } from '../diagnostics/state-hash';
import { runConformanceHarness } from '../conformance/harness';
import { initializeNetworkDataDir, launchNetwork } from '../networks/launch';
import { readDescriptorStatus, verifyNetworkArtifacts } from '../networks/descriptor';
import { getNetworkParams, PUBLIC_BINARY_NAME, SUPPORTED_NETWORK_NAMES, type NetworkName } from '../networks/params';
import { resolveNodeDataDir } from '../node/data-dir';
import { createDefaultNodeConfig, type NodeConfig, loadNodeContext } from '../node/config';
import { RELEASE_SCHEMA_VERSION } from '../storage/release-schema';
import { NodeRuntime } from '../node/runtime';
import { LocalSignerProvider } from '../signer/provider';
import { toNpub } from '../wallet/addresses';

interface CliOutput {
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

interface RunningNodeProbe {
  readonly running: true;
  readonly status: Record<string, unknown>;
}

interface StoppedNodeProbe {
  readonly running: false;
  readonly code: string;
  readonly stale: boolean;
}

type NodeProbe = RunningNodeProbe | StoppedNodeProbe;

interface CommandOptions {
  readonly help?: boolean;
  readonly network?: string;
  readonly dataDir?: string;
  readonly out?: string;
  readonly events?: string;
  readonly json?: boolean;
  readonly mode?: string;
  readonly to?: string;
  readonly amount?: string;
  readonly priorityFee?: string;
  readonly id?: string;
  readonly height?: string;
  readonly launcherKey?: string;
  readonly bootstrap?: readonly string[];
  readonly validatorOnly?: boolean;
  readonly relayListen?: string;
  readonly relayPublicUrl?: string;
  readonly relayTlsCert?: string;
  readonly relayTlsKey?: string;
  readonly noUnlock?: boolean;
  readonly signerPasswordFile?: string;
}

interface CommandSpec {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly stateful: boolean;
  readonly optionKinds: Readonly<Record<string, 'boolean' | 'string'>>;
}

const SOFTWARE_VERSION = readPackageVersion();
const TEST_SAFE_START_MODE = 'attached';
const START_MODE_ENV_NAME = 'NOSTR_BLOCKCHAIN_START_MODE';
const trackedAttachedChildPids = new Set<number>();
let attachedChildCleanupRegistered = false;

const COMMAND_SPECS: Readonly<Record<string, CommandSpec>> = {
  version: {
    name: 'version',
    usage: `${PUBLIC_BINARY_NAME} version [--help]`,
    description: 'Print software and protocol metadata.',
    stateful: false,
    optionKinds: { '--help': 'boolean' }
  },
  'network-info': {
    name: 'network-info',
    usage: `${PUBLIC_BINARY_NAME} network-info --network mainnet|testnet [--help]`,
    description: 'Show selected network constants and descriptor status.',
    stateful: true,
    optionKinds: { '--network': 'string', '--help': 'boolean' }
  },
  'key generate': {
    name: 'key generate',
    usage: `${PUBLIC_BINARY_NAME} key generate --out <FILE> [--help]`,
    description: 'Generate an encrypted launcher or signer key file.',
    stateful: false,
    optionKinds: { '--out': 'string', '--help': 'boolean' }
  },
  launch: {
    name: 'launch',
    usage: `${PUBLIC_BINARY_NAME} launch --network mainnet|testnet --launcher-key <FILE> --bootstrap <WSS_URL> --bootstrap <WSS_URL> --bootstrap <WSS_URL> [--help]`,
    description: 'Create the one-time public network descriptor and genesis artifacts.',
    stateful: true,
    optionKinds: { '--network': 'string', '--launcher-key': 'string', '--bootstrap': 'string', '--help': 'boolean' }
  },
  init: {
    name: 'init',
    usage: `${PUBLIC_BINARY_NAME} init --network mainnet|testnet [--data-dir <DIR>] [--validator-only] [--relay-listen <HOST:PORT>] [--relay-public-url <WSS_URL>] [--relay-tls-cert <FILE>] [--relay-tls-key <FILE>] [--help]`,
    description: 'Initialize a network-specific node data directory.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--validator-only': 'boolean', '--relay-listen': 'string', '--relay-public-url': 'string', '--relay-tls-cert': 'string', '--relay-tls-key': 'string', '--help': 'boolean' }
  },
  start: {
    name: 'start',
    usage: `${PUBLIC_BINARY_NAME} start --network mainnet|testnet [--data-dir <DIR>] [--no-unlock] [--signer-password-file <FILE>] [--help]`,
    description: 'Start the full node process.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--no-unlock': 'boolean', '--signer-password-file': 'string', '--help': 'boolean' }
  },
  stop: {
    name: 'stop',
    usage: `${PUBLIC_BINARY_NAME} stop --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Stop a running full node process.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  status: {
    name: 'status',
    usage: `${PUBLIC_BINARY_NAME} status --network mainnet|testnet [--json] [--data-dir <DIR>] [--help]`,
    description: 'Show node status for a selected network.',
    stateful: true,
    optionKinds: { '--network': 'string', '--json': 'boolean', '--data-dir': 'string', '--help': 'boolean' }
  },
  doctor: {
    name: 'doctor',
    usage: `${PUBLIC_BINARY_NAME} doctor --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Run read-only node diagnostics.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  'signer unlock': {
    name: 'signer unlock',
    usage: `${PUBLIC_BINARY_NAME} signer unlock --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Unlock the local signer.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  'signer lock': {
    name: 'signer lock',
    usage: `${PUBLIC_BINARY_NAME} signer lock --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Lock the local signer.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  mining: {
    name: 'mining',
    usage: `${PUBLIC_BINARY_NAME} mining --network mainnet|testnet --mode continuous|disabled|mine-one [--data-dir <DIR>] [--help]`,
    description: 'Adjust mining mode.',
    stateful: true,
    optionKinds: { '--network': 'string', '--mode': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  'wallet address': {
    name: 'wallet address',
    usage: `${PUBLIC_BINARY_NAME} wallet address --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Show the wallet receive address.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  'wallet balance': {
    name: 'wallet balance',
    usage: `${PUBLIC_BINARY_NAME} wallet balance --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Show wallet balance.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  'wallet utxos': {
    name: 'wallet utxos',
    usage: `${PUBLIC_BINARY_NAME} wallet utxos --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'List wallet UTXOs.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  send: {
    name: 'send',
    usage: `${PUBLIC_BINARY_NAME} send --network mainnet|testnet --to <NPUB_OR_HEX> --amount <DECIMAL_NSR> [--priority-fee <DECIMAL_NSR>] [--data-dir <DIR>] [--help]`,
    description: 'Build and broadcast a payment transaction.',
    stateful: true,
    optionKinds: { '--network': 'string', '--to': 'string', '--amount': 'string', '--priority-fee': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  block: {
    name: 'block',
    usage: `${PUBLIC_BINARY_NAME} block --network mainnet|testnet (--height <H> | --id <BLOCK_ID>) [--data-dir <DIR>] [--help]`,
    description: 'Inspect a block by height or block ID.',
    stateful: true,
    optionKinds: { '--network': 'string', '--height': 'string', '--id': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  tx: {
    name: 'tx',
    usage: `${PUBLIC_BINARY_NAME} tx --network mainnet|testnet --id <TX_ID> [--data-dir <DIR>] [--help]`,
    description: 'Inspect a transaction by ID.',
    stateful: true,
    optionKinds: { '--network': 'string', '--id': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  mempool: {
    name: 'mempool',
    usage: `${PUBLIC_BINARY_NAME} mempool --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Inspect mempool contents.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  verify: {
    name: 'verify',
    usage: `${PUBLIC_BINARY_NAME} verify --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Verify on-disk node state.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  reindex: {
    name: 'reindex',
    usage: `${PUBLIC_BINARY_NAME} reindex --network mainnet|testnet [--data-dir <DIR>] [--help]`,
    description: 'Rebuild derived on-disk node state.',
    stateful: true,
    optionKinds: { '--network': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  replay: {
    name: 'replay',
    usage: `${PUBLIC_BINARY_NAME} replay --network mainnet|testnet --events <NDJSON> [--data-dir <DIR>] [--help]`,
    description: 'Replay an event set offline for diagnostics.',
    stateful: true,
    optionKinds: { '--network': 'string', '--events': 'string', '--data-dir': 'string', '--help': 'boolean' }
  },
  conformance: {
    name: 'conformance',
    usage: `${PUBLIC_BINARY_NAME} conformance --network mainnet|testnet [--help]`,
    description: 'Run the release conformance harness.',
    stateful: true,
    optionKinds: { '--network': 'string', '--help': 'boolean' }
  }
};

export async function runCli(argv: readonly string[]): Promise<CliOutput> {
  try {
    const command = resolveCommand(argv);
    if (command === null) {
      return errorOutput(`unknown command${argv.length > 0 ? `: ${argv.join(' ')}` : ''}`, mainHelp());
    }

    const options = parseOptions(command.spec, command.args);
    if (options.help === true) {
      return successOutput(commandHelp(command.spec));
    }

    if (command.spec.stateful) {
      const selectedNetwork = requireNetwork(options.network);
      return await handleStatefulCommand(command.spec, selectedNetwork, options);
    }

    return handleStatelessCommand(command.spec, options);
  } catch (error) {
    return errorOutput(error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  if (process.env.NOSTR_BLOCKCHAIN_INTERNAL_DAEMON === '1' && process.argv[2] === 'start') {
    await runInternalStart(process.argv.slice(2));
    return;
  }
  const output = await runCli(process.argv.slice(2));
  for (const line of output.stdout) {
    process.stdout.write(`${line}\n`);
  }
  for (const line of output.stderr) {
    process.stderr.write(`${line}\n`);
  }
  process.exitCode = output.exitCode;
}

if (require.main === module) {
  void main();
}

function resolveCommand(argv: readonly string[]): { spec: CommandSpec; args: readonly string[] } | null {
  if (argv.length === 0) {
    throw new Error(mainHelp());
  }

  const [firstToken, secondToken, ...remainingTokens] = argv;
  if (firstToken === '--help') {
    throw new Error(mainHelp());
  }

  if ((firstToken === 'key' || firstToken === 'signer' || firstToken === 'wallet') && secondToken !== undefined) {
    const compositeName = `${firstToken} ${secondToken}`;
    const compositeSpec = COMMAND_SPECS[compositeName];
    if (compositeSpec !== undefined) {
      return { spec: compositeSpec, args: remainingTokens };
    }
  }

  const singleSpec = COMMAND_SPECS[firstToken];
  if (singleSpec !== undefined) {
    return { spec: singleSpec, args: argv.slice(1) };
  }

  return null;
}

function parseOptions(spec: CommandSpec, args: readonly string[]): CommandOptions {
  const parsedOptions: Record<string, string | boolean | readonly string[] | undefined> = {};
  const bootstrapValues: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      continue;
    }
    if (!token.startsWith('--')) {
      throw new Error(`unknown argument for ${spec.name}: ${token}`);
    }
    const optionKind = spec.optionKinds[token];
    if (optionKind === undefined) {
      throw new Error(`unknown flag for ${spec.name}: ${token}`);
    }
    if (optionKind === 'boolean') {
      parsedOptions[toOptionKey(token)] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for ${token}`);
    }
    parsedOptions[toOptionKey(token)] = value;
    if (token === '--bootstrap') {
      bootstrapValues.push(value);
    }
    index += 1;
  }
  if (bootstrapValues.length > 0) {
    parsedOptions.bootstrap = bootstrapValues;
  }
  return parsedOptions as CommandOptions;
}

function handleStatelessCommand(spec: CommandSpec, options: CommandOptions): CliOutput {
  if (spec.name === 'version') {
    return successJson({
      binary: PUBLIC_BINARY_NAME,
      softwareVersion: SOFTWARE_VERSION,
      protocolVersion: 0,
      releaseSchemaVersion: RELEASE_SCHEMA_VERSION,
      supportedNetworks: SUPPORTED_NETWORK_NAMES
    });
  }

  if (spec.name === 'key generate') {
    if (options.out === undefined) {
      throw new Error('missing value for --out');
    }
    const password = process.env.NOSTR_BLOCKCHAIN_KEY_PASSWORD;
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('NOSTR_BLOCKCHAIN_KEY_PASSWORD must be set for encrypted key generation');
    }
    const signerProvider = new LocalSignerProvider(path.resolve(options.out));
    const generatedKey = signerProvider.ensureSignerFile(password);
    return successJson({
      out: path.resolve(options.out),
      pubkey: generatedKey.pubkeyHex
    });
  }

  return notImplemented(spec);
}

async function handleStatefulCommand(spec: CommandSpec, network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  const params = getNetworkParams(network);
  if (spec.name === 'network-info') {
    const descriptorStatus = readDescriptorStatus(params);
    return successJson({
      network: params.network,
      binary: PUBLIC_BINARY_NAME,
      softwareVersion: SOFTWARE_VERSION,
      releaseSchemaVersion: RELEASE_SCHEMA_VERSION,
      protocolVersion: params.protocolVersion,
      txKind: params.txKind,
      blockKind: params.blockKind,
      decimals: params.decimals,
      baseUnitsPerNsr: params.baseUnitsPerNsr.toString(10),
      displaySymbol: params.displaySymbol,
      blockReward: params.blockReward.toString(10),
      rewardMaturity: params.rewardMaturity,
      fees: {
        base: params.baseFee.toString(10),
        input: params.inputFee.toString(10),
        output: params.outputFee.toString(10)
      },
      limits: {
        maxTxInputs: params.maxTxInputs,
        maxTxOutputs: params.maxTxOutputs,
        maxBlockTransactions: params.maxBlockTransactions
      },
      difficulty: {
        targetBlockSeconds: params.targetBlockSeconds,
        difficultyWindow: params.difficultyWindow,
        initialDifficultyBits: params.initialDifficultyBits,
        minDifficultyBits: params.minDifficultyBits,
        maxDifficultyBits: params.maxDifficultyBits,
        nip13GateBits: params.nip13GateBits
      },
      cacheWalkR1: params.cacheWalkR1,
      defaultDataDir: resolveNodeDataDir(network, options.dataDir),
      descriptor: {
        path: path.relative(process.cwd(), descriptorStatus.path) || descriptorStatus.path,
        genesisPath: path.relative(process.cwd(), descriptorStatus.genesisPath) || descriptorStatus.genesisPath,
        status: descriptorStatus.status,
        launched: descriptorStatus.launched,
        chainId: descriptorStatus.chainId,
        expectedGenesisId: params.expectedGenesisId,
        descriptorSha256: descriptorStatus.descriptorSha256,
        genesisSha256: descriptorStatus.genesisSha256,
        error: descriptorStatus.error
      }
    });
  }

  if (spec.name === 'launch') {
    if (options.launcherKey === undefined) {
      throw new Error('missing value for --launcher-key');
    }
    const launched = launchNetwork({
      params,
      launcherKeyPath: options.launcherKey,
      bootstrapUrls: options.bootstrap ?? []
    });
    return successJson({
      network,
      chainId: launched.descriptor.chain_id,
      genesisEventId: launched.genesisEvent.id,
      descriptorPath: path.relative(process.cwd(), launched.descriptorPath) || launched.descriptorPath,
      genesisPath: path.relative(process.cwd(), launched.genesisPath) || launched.genesisPath,
      descriptorSha256: launched.descriptorSha256,
      genesisSha256: launched.genesisSha256,
      profile: {
        protocolVersion: params.protocolVersion,
        displaySymbol: params.displaySymbol,
        initialDifficultyBits: params.initialDifficultyBits,
        rewardMaturity: params.rewardMaturity,
        blockReward: params.blockReward.toString(10)
      }
    });
  }

  if (spec.name === 'init') {
    const initialized = initializeNetworkDataDir({
      params,
      dataDir: resolveNodeDataDir(network, options.dataDir),
      validatorOnly: options.validatorOnly === true,
      relayListen: options.relayListen,
      relayPublicUrl: options.relayPublicUrl,
      relayTlsCert: options.relayTlsCert,
      relayTlsKey: options.relayTlsKey
    });
    return successJson({
      network,
      chainId: initialized.chainId,
      dataDir: initialized.dataDir,
      configPath: initialized.configPath,
      databasePath: initialized.databasePath,
      descriptorSha256: initialized.verifiedArtifacts.descriptorFileSha256,
      genesisSha256: initialized.verifiedArtifacts.genesisFileSha256,
      signer: options.validatorOnly === true ? { type: 'none' } : { type: 'local-ncryptsec', path: 'miner.ncryptsec' }
    });
  }

  if (spec.name === 'start') {
    return await startNodeProcess(network, options);
  }

  if (spec.name === 'stop') {
    const dataDir = resolveNodeDataDir(network, options.dataDir);
    return successJson(await stopNodeProcess(dataDir));
  }

  if (spec.name === 'status') {
    const dataDir = resolveNodeDataDir(network, options.dataDir);
    return await statusNodeProcess(network, dataDir, options.json === true);
  }

  if (spec.name === 'doctor') {
    return await doctorNodeProcess(network, options);
  }

  if (spec.name === 'signer unlock') {
    const dataDir = resolveNodeDataDir(network, options.dataDir);
    const password = process.env.NOSTR_BLOCKCHAIN_SIGNER_PASSWORD;
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('NOSTR_BLOCKCHAIN_SIGNER_PASSWORD must be set for signer unlock');
    }
    const response = await sendLocalControlRequest(dataDir, 'signer_unlock', { password });
    if (!response.ok) {
      return errorOutput(response.code);
    }
    return successJson(response.payload ?? { ok: true });
  }

  if (spec.name === 'signer lock') {
    const dataDir = resolveNodeDataDir(network, options.dataDir);
    const response = await sendLocalControlRequest(dataDir, 'signer_lock');
    if (!response.ok) {
      return errorOutput(response.code);
    }
    return successJson(response.payload ?? { ok: true });
  }

  if (spec.name === 'verify') {
    return await verifyNodeData(network, options);
  }

  if (spec.name === 'wallet address') {
    return await walletAddress(network, options);
  }

  if (spec.name === 'wallet balance') {
    return await walletBalance(network, options);
  }

  if (spec.name === 'wallet utxos') {
    return await walletUtxos(network, options);
  }

  if (spec.name === 'send') {
    return await sendWalletPayment(network, options);
  }

  if (spec.name === 'reindex') {
    return await reindexNodeData(network, options);
  }

  if (spec.name === 'replay') {
    return await replayNodeData(network, options);
  }

  if (spec.name === 'conformance') {
    const report = await runConformanceHarness(network, {
      keepTemp: process.env.NOSTR_BLOCKCHAIN_CONFORMANCE_KEEP_TMP === '1'
    });
    const contactedPublicEndpoints = report.contactedPublicEndpoints.filter((url) => url.startsWith('wss://'));
    const diagnosticLines = [
      `network: ${network}`,
      `descriptor bootstrap urls inspected read-only: ${contactedPublicEndpoints.length}`,
      `public bootstrap urls contacted: 0`,
      ...(report.tempRoot === null ? [] : [`temp root: ${report.tempRoot}`]),
      '',
      ...report.lines
    ];
    return report.checks.every((check) => check.passed)
      ? successOutput(...diagnosticLines)
      : { exitCode: 1, stdout: diagnosticLines, stderr: [] };
  }

  return notImplemented(spec, network, options);
}

function requireNetwork(networkValue: string | undefined): NetworkName {
  if (networkValue === undefined) {
    throw new Error('missing required --network mainnet|testnet');
  }
  if (!SUPPORTED_NETWORK_NAMES.includes(networkValue as NetworkName)) {
    throw new Error(`invalid network name: ${networkValue}`);
  }
  return networkValue as NetworkName;
}

function notImplemented(spec: CommandSpec, network?: NetworkName, options?: CommandOptions): CliOutput {
  const dataDir = network !== undefined ? resolveNodeDataDir(network, options?.dataDir) : undefined;
  return {
    exitCode: 1,
    stdout: [],
    stderr: [JSON.stringify({
      error: 'NOT_IMPLEMENTED',
      command: spec.name,
      network: network ?? null,
      dataDir: dataDir ?? null
    }, null, 2)]
  };
}

function successJson(value: unknown): CliOutput {
  return {
    exitCode: 0,
    stdout: [JSON.stringify(value, jsonBigIntReplacer, 2)],
    stderr: []
  };
}

function successOutput(...lines: string[]): CliOutput {
  return { exitCode: 0, stdout: lines, stderr: [] };
}

function errorOutput(message: string, ...extraLines: string[]): CliOutput {
  return { exitCode: 1, stdout: [], stderr: [message, ...extraLines] };
}

function mainHelp(): string {
  return [
    `${PUBLIC_BINARY_NAME} <command> [options]`,
    '',
    'Commands:',
    ...Object.values(COMMAND_SPECS).map((spec) => `  ${spec.usage}`)
  ].join('\n');
}

function commandHelp(spec: CommandSpec): string {
  return [spec.usage, '', spec.description].join('\n');
}

function toOptionKey(flag: string): string {
  return flag.slice(2).replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return '0.0.0-unknown';
    }
    const rawPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof rawPackage.version === 'string' ? rawPackage.version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

function jsonBigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString(10) : value;
}

async function startNodeProcess(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const existingNode = await probeNodeProcess(dataDir);
  if (existingNode.running) {
    return successJson({ started: false, running: true, status: existingNode.status });
  }

  const startMode = getStartMode();
  const childArguments = [
    path.resolve(__filename),
    'start',
    '--network', network,
    ...(options.dataDir === undefined ? [] : ['--data-dir', options.dataDir]),
    ...(options.noUnlock === true ? ['--no-unlock'] : []),
    ...(options.signerPasswordFile === undefined ? [] : ['--signer-password-file', options.signerPasswordFile])
  ];
  const child = spawn(process.execPath, childArguments, {
    detached: startMode !== TEST_SAFE_START_MODE,
    stdio: 'ignore',
    env: { ...process.env, NOSTR_BLOCKCHAIN_INTERNAL_DAEMON: '1' }
  });
  if (startMode !== TEST_SAFE_START_MODE) {
    child.unref();
  } else if (child.pid !== undefined) {
    trackAttachedChildProcess(child.pid);
  }

  try {
    const status = await waitForStatus(dataDir);
    return successJson({ started: true, pid: child.pid ?? null, status });
  } catch (error) {
    terminateSpawnedNode(child.pid ?? null, dataDir);
    throw error;
  }
}

async function stopNodeProcess(dataDir: string): Promise<Record<string, unknown>> {
  const node = await probeNodeProcess(dataDir);
  if (!node.running) {
    return { running: false, stopped: false, code: node.code, stale: node.stale };
  }
  const trackedPid = readTrackedNodePid(dataDir);
  const response = await sendLocalControlRequest(dataDir, 'stop');
  if (response.ok && trackedPid !== null) {
    await waitForProcessExit(trackedPid, 5_000);
    trackedAttachedChildPids.delete(trackedPid);
  }
  return { running: true, stopped: response.ok, code: response.code };
}

async function statusNodeProcess(network: NetworkName, dataDir: string, asJson: boolean): Promise<CliOutput> {
  const node = await probeNodeProcess(dataDir);
  if (!node.running) {
    const payload = {
      running: false,
      network,
      lifecycle: 'STOPPED',
      dataDir,
      code: node.code,
      staleControlSocket: node.stale
    };
    return asJson ? successJson(payload) : successOutput(`network: ${network}`, `lifecycle: STOPPED`, `data dir: ${dataDir}`, 'running: no');
  }
  const payload = node.status;
  if (asJson) {
    return successJson(payload);
  }
  return successOutput(...formatStatusHuman(payload as unknown as import('../diagnostics/status').NodeStatusSnapshot, SOFTWARE_VERSION));
}

async function doctorNodeProcess(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  const context = loadNodeContext(network, resolveNodeDataDir(network, options.dataDir));
  const report = await runDoctor(context);
  return report.ok ? successJson(report) : { exitCode: 1, stdout: [JSON.stringify(report, null, 2)], stderr: [] };
}

async function verifyNodeData(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const node = await probeNodeProcess(dataDir);
  if (node.running) {
    return errorOutput('MAINTENANCE_LOCKED: stop the running node before verify');
  }
  const runtime = new NodeRuntime(createOfflineRuntimeConfig(network, dataDir), null);
  try {
    await runtime.start(verifyNetworkArtifacts(getNetworkParams(network)).genesisEvent);
    const status = buildRuntimeStatus(runtime);
    const verification = runtime.verify();
    return successJson({ verification, status });
  } finally {
    await runtime.shutdown();
  }
}

async function reindexNodeData(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const node = await probeNodeProcess(dataDir);
  if (node.running) {
    return errorOutput('MAINTENANCE_LOCKED: stop the running node before reindex');
  }
  const runtime = new NodeRuntime(createOfflineRuntimeConfig(network, dataDir), null);
  try {
    await runtime.start(verifyNetworkArtifacts(getNetworkParams(network)).genesisEvent);
    const before = buildRuntimeStatus(runtime);
    runtime.reindex();
    const after = buildRuntimeStatus(runtime);
    return successJson({
      before,
      after,
      matches: before.tip === after.tip && before.cumulativeWork === after.cumulativeWork && before.utxoDigest === after.utxoDigest && before.stateHash === after.stateHash
    });
  } finally {
    await runtime.shutdown();
  }
}

async function replayNodeData(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  if (options.events === undefined) {
    throw new Error('missing value for --events');
  }
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const eventsPath = path.resolve(options.events);
  const eventLines = fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/gu).filter((line) => line.trim().length > 0);
  const events = eventLines.map((line) => JSON.parse(line) as import('../consensus/nip01').NostrEvent);
  const artifacts = verifyNetworkArtifacts(getNetworkParams(network));
  const runtime = new NodeRuntime(createOfflineRuntimeConfig(network, dataDir), null);
  try {
    await runtime.start(artifacts.genesisEvent);
    const replay = runtime.replayFromEvents(events);
    const activeBlock = replay.snapshot.activeTip === null ? null : runtime.chainExecutor.getConnectedBlock(replay.snapshot.activeTip);
    const currentDifficulty = activeBlock?.requiredDifficulty ?? runtime.getGenesisParams().powDifficulty;
    return successJson({
      eventsPath,
      replay,
      stateHash: computeStateHash(artifacts.chainId, replay.snapshot, currentDifficulty)
    });
  } finally {
    await runtime.shutdown();
  }
}

function createOfflineRuntimeConfig(network: NetworkName, dataDir: string = resolveNodeDataDir(network)): NodeConfig {
  const configPath = path.join(dataDir, 'node.json');
  const config = fs.existsSync(configPath)
    ? loadNodeContext(network, dataDir).runtimeConfig
    : createDefaultNodeConfig(network, dataDir);
  config.miningEnabled = false;
  config.miningMode = 'disabled';
  config.embeddedRelayPort = null;
  config.embeddedRelayListen = null;
  config.relays = [];
  return config;
}

async function waitForStatus(dataDir: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const node = await probeNodeProcess(dataDir);
    if (node.running) {
      return node.status;
    }
    await sleep(50);
  }
  throw new Error('CONTROL_UNAVAILABLE: timed out waiting for local control socket');
}

async function probeNodeProcess(dataDir: string): Promise<NodeProbe> {
  if (!hasControlSocket(dataDir)) {
    return { running: false, code: 'CONTROL_UNAVAILABLE', stale: false };
  }

  try {
    const response = await sendLocalControlRequest(dataDir, 'status');
    if (!response.ok) {
      return { running: false, code: response.code, stale: false };
    }
    return { running: true, status: response.payload as Record<string, unknown> };
  } catch {
    removeControlSocketMetadata(dataDir);
    return { running: false, code: 'CONTROL_STALE', stale: true };
  }
}

function removeControlSocketMetadata(dataDir: string): void {
  fs.rmSync(getControlSocketPath(dataDir), { force: true });
}

function readTrackedNodePid(dataDir: string): number | null {
  try {
    return readControlMetadata(dataDir).pid;
  } catch {
    return null;
  }
}

function getStartMode(): string {
  return process.env[START_MODE_ENV_NAME] === TEST_SAFE_START_MODE ? TEST_SAFE_START_MODE : 'daemon';
}

function trackAttachedChildProcess(pid: number): void {
  trackedAttachedChildPids.add(pid);
  if (attachedChildCleanupRegistered) {
    return;
  }
  attachedChildCleanupRegistered = true;
  process.once('exit', () => {
    for (const trackedPid of trackedAttachedChildPids) {
      terminateProcessByPid(trackedPid);
    }
    trackedAttachedChildPids.clear();
  });
}

function terminateSpawnedNode(pid: number | null, dataDir: string): void {
  removeControlSocketMetadata(dataDir);
  if (pid !== null) {
    trackedAttachedChildPids.delete(pid);
    terminateProcessByPid(pid);
  }
}

function terminateProcessByPid(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    // Process already exited.
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await sleep(50);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runInternalStart(argv: readonly string[]): Promise<void> {
  const command = resolveCommand(argv);
  if (command === null) {
    throw new Error('missing start command');
  }
  const options = parseOptions(command.spec, command.args);
  const network = requireNetwork(options.network);
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const context = loadNodeContext(network, dataDir);
  const artifacts = verifyNetworkArtifacts(getNetworkParams(network));
  const runtime = new NodeRuntime(context.runtimeConfig, null);
  const control = new (require('../control/local-socket').LocalControlSocket)(dataDir, {
    onStatus: () => ({ running: true, softwareVersion: SOFTWARE_VERSION, ...buildRuntimeStatus(runtime) }),
    onStop: () => {
      void control.close().finally(() => void runtime.shutdown().finally(() => process.exit(0)));
    },
    onSignerUnlock: (password: string) => runtime.unlockSigner(password),
    onSignerLock: () => {
      runtime.lockSigner();
      return { state: runtime.getSignerState() };
    },
    onWalletAddress: () => runtime.getWalletAddress(),
    onWalletBalance: () => runtime.getWalletBalanceSummary(),
    onWalletUtxos: () => runtime.getWalletUtxos(),
    onWalletSend: (request: { readonly to: string; readonly amount: string; readonly priorityFee: string }) => runtime.sendWalletPayment(request.to, request.amount, request.priorityFee)
  });
  await runtime.start(artifacts.genesisEvent);
  if (options.signerPasswordFile !== undefined) {
    runtime.unlockSigner(readPasswordFile(options.signerPasswordFile));
  }
  await control.listen();
  const shutdown = () => {
    void control.close().finally(() => void runtime.shutdown().finally(() => process.exit(0)));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await new Promise<void>(() => undefined);
}

function readPasswordFile(filePath: string): string {
  const stats = fs.statSync(filePath);
  if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
    throw new Error(`signer password file permissions are too broad: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8').replace(/\r?\n$/u, '');
}

async function walletAddress(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const node = await probeNodeProcess(dataDir);
  if (node.running) {
    const response = await sendLocalControlRequest(dataDir, 'wallet_address');
    return response.ok ? successJson(response.payload ?? {}) : errorOutput(response.code);
  }
  const context = loadNodeContext(network, dataDir);
  const signerPubkey = context.runtimeConfig.signerPubkey;
  if (context.runtimeConfig.signerType !== 'local-ncryptsec' || signerPubkey === null || signerPubkey === undefined) {
    return errorOutput('BOOT_SIGNER_UNAVAILABLE');
  }
  return successJson({
    network,
    pubkey: signerPubkey,
    npub: toNpub(signerPubkey)
  });
}

async function walletBalance(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const node = await probeNodeProcess(dataDir);
  if (node.running) {
    const response = await sendLocalControlRequest(dataDir, 'wallet_balance');
    return response.ok ? successJson(response.payload ?? {}) : errorOutput(response.code);
  }
  const runtime = await startOfflineRuntime(network, dataDir);
  try {
    return successJson(runtime.getWalletBalanceSummary());
  } finally {
    await runtime.shutdown();
  }
}

async function walletUtxos(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const node = await probeNodeProcess(dataDir);
  if (node.running) {
    const response = await sendLocalControlRequest(dataDir, 'wallet_utxos');
    return response.ok ? successJson({ network, utxos: response.payload ?? [] }) : errorOutput(response.code);
  }
  const runtime = await startOfflineRuntime(network, dataDir);
  try {
    return successJson({ network, utxos: runtime.getWalletUtxos() });
  } finally {
    await runtime.shutdown();
  }
}

async function sendWalletPayment(network: NetworkName, options: CommandOptions): Promise<CliOutput> {
  if (options.to === undefined) {
    throw new Error('missing value for --to');
  }
  if (options.amount === undefined) {
    throw new Error('missing value for --amount');
  }
  const dataDir = resolveNodeDataDir(network, options.dataDir);
  const node = await probeNodeProcess(dataDir);
  if (!node.running) {
    return errorOutput('CONTROL_UNAVAILABLE: start the node before send');
  }
  const response = await sendLocalControlRequest(dataDir, 'wallet_send', {
    to: options.to,
    amount: options.amount,
    priorityFee: options.priorityFee ?? '0'
  });
  return response.ok ? successJson({ network, ...(response.payload as Record<string, unknown>) }) : errorOutput(response.code);
}

async function startOfflineRuntime(network: NetworkName, dataDir: string): Promise<NodeRuntime> {
  const runtime = new NodeRuntime(createOfflineRuntimeConfig(network, dataDir), null);
  await runtime.start(verifyNetworkArtifacts(getNetworkParams(network)).genesisEvent);
  return runtime;
}
