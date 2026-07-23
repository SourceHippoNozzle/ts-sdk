import process from 'node:process';
import {
  type EvmAddress,
  expectEvmAddress,
  expectEvmSignature,
  expectTxHash,
  type HexString,
  invariant,
  never,
  type TxHash,
} from '@polymarket/types';
import type Openfort from '@openfort/openfort-node';
import { Hex } from 'ox';
import {
  type Chain,
  createPublicClient,
  http,
  WaitForTransactionReceiptTimeoutError,
} from 'viem';
import { waitForTransactionReceipt } from 'viem/actions';
import * as viemChains from 'viem/chains';
import {
  CancelledSigningError,
  SigningError,
  TimeoutError,
  TransactionFailedError,
  TransportError,
} from './errors';
import type {
  Signer,
  SignerTransactionRequest,
  TransactionHandle,
  TransactionOutcome,
  TypedDataPayload,
} from './types';

invariant(
  process.release.name === 'node',
  'The @polymarket/client/openfort entrypoint requires a Node.js runtime.',
);
invariant(
  typeof window === 'undefined' && typeof document === 'undefined',
  'The @polymarket/client/openfort entrypoint cannot be imported in a browser-like runtime.',
);

export type OpenfortWalletConfig = {
  openfort: Openfort;
  accountId: string;
};

const allChains = Object.values(viemChains) as Chain[];

export function signerFrom(config: OpenfortWalletConfig): Signer {
  return {
    getAddress() {
      return resolveAddress(config);
    },
    signTypedData(payload) {
      return signTypedData(config, payload);
    },
    signMessage(message) {
      return signMessage(config, message);
    },
    async sendTransaction(request) {
      return new DirectTransactionHandle(
        await sendTransaction(config, request),
        request.chainId,
      );
    },
  };
}

async function resolveAddress(
  config: OpenfortWalletConfig,
): Promise<EvmAddress> {
  try {
    const wallet = await config.openfort.accounts.evm.backend.get({
      id: config.accountId,
    });
    return expectEvmAddress(wallet.address);
  } catch (error) {
    throw SigningError.fromError(error, 'Could not resolve signer address');
  }
}

async function sendTransaction(
  config: OpenfortWalletConfig,
  request: SignerTransactionRequest,
): Promise<TxHash> {
  try {
    const response = await config.openfort.accounts.evm.backend
      .sendTransaction(config.accountId, {
        chainId: request.chainId,
        transaction: {
          to: request.to,
          data: request.data,
          value: request.value?.toString(),
        },
      });

    return expectTxHash(response.hash);
  } catch (error) {
    throwSigningWorkflowError(error);
  }
}

async function signTypedData(
  config: OpenfortWalletConfig,
  payload: TypedDataPayload,
) {
  try {
    const response = await config.openfort.accounts.evm.backend
      .signTypedData(config.accountId, {
        domain: serializeBigInts(payload.domain),
        message: serializeBigInts(payload.message),
        primary_type: payload.primaryType,
        types: payload.types as Record<
          string,
          Array<{ name: string; type: string }>
        >,
      });

    return expectEvmSignature(response.signature);
  } catch (error) {
    throwSigningWorkflowError(error);
  }
}

async function signMessage(
  config: OpenfortWalletConfig,
  message: HexString,
) {
  try {
    const response = await config.openfort.accounts.evm.backend
      .signMessage(config.accountId, {
        message: Hex.toBytes(message as `0x${string}`),
      });

    return expectEvmSignature(response.signature);
  } catch (error) {
    throwSigningWorkflowError(error);
  }
}

function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') {
    return `${value}` as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeBigInts(item)) as T;
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        item === undefined ? [] : [[key, serializeBigInts(item)]],
      ),
    ) as T;
  }

  return value;
}

function throwSigningWorkflowError(error: unknown): never {
  if (isUserRejectedError(error)) {
    throw new CancelledSigningError('User rejected the signing request', {
      cause: error,
    });
  }

  throw SigningError.fromError(error);
}

function isUserRejectedError(
  error: unknown,
  seen = new Set<unknown>(),
): boolean {
  if (seen.has(error) || error === null || typeof error !== 'object') {
    return false;
  }

  seen.add(error);

  const candidate = error as {
    cause?: unknown;
    code?: unknown;
    error?: unknown;
    name?: unknown;
  };

  return (
    candidate.code === 4001 ||
    candidate.code === 'ACTION_REJECTED' ||
    candidate.name === 'APIUserAbortError' ||
    isUserRejectedError(candidate.error, seen) ||
    isUserRejectedError(candidate.cause, seen)
  );
}

class DirectTransactionHandle implements TransactionHandle {
  readonly transactionId = null;

  readonly #chainId: number;
  #transactionHash: TxHash;

  constructor(transactionHash: TxHash, chainId: number) {
    this.#chainId = chainId;
    this.#transactionHash = transactionHash;
  }

  get transactionHash() {
    return this.#transactionHash;
  }

  async wait(): Promise<TransactionOutcome> {
    try {
      const receipt = await waitForTransactionReceipt(
        createPublicClient({
          chain: resolveChain(this.#chainId),
          transport: http(),
        }),
        {
          hash: this.#transactionHash,
        },
      );

      const transactionHash = expectTxHash(receipt.transactionHash);
      this.#transactionHash = transactionHash;

      if (receipt.status === 'reverted') {
        throw new TransactionFailedError(
          `Transaction ${transactionHash} reverted`,
        );
      }

      return {
        transactionHash,
        transactionId: null,
      };
    } catch (error) {
      if (error instanceof WaitForTransactionReceiptTimeoutError) {
        throw new TimeoutError(
          `Timed out waiting for transaction ${this.#transactionHash} to settle`,
          { cause: error },
        );
      }

      throw TransportError.fromError(error);
    }
  }
}

function resolveChain(chainId: number) {
  const chain = allChains.find((candidate) => candidate.id === chainId);

  if (chain !== undefined) {
    return chain;
  }

  never(`Unsupported chain ID for direct Openfort transaction wait: ${chainId}`);
}
