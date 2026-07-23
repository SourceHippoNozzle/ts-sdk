# Project Context

@./AGENTS.md

## Quick start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck

# Lint
pnpm lint

# Fix auto-fixable lint issues
pnpm lint:fix

# Run all tests
pnpm test

# Test a specific package
pnpm --filter @polymarket/client test
pnpm --filter @polymarket/bindings test
pnpm --filter @polymarket/types test
```

## Monorepo structure

```
polymarket-ts-sdk/
├── packages/
│   ├── client/       # Main SDK client (@polymarket/client)
│   │   ├── src/actions/     # Public API actions (markets, clob, perps, etc.)
│   │   ├── src/decorators/  # Client decorators mirroring actions
│   │   ├── src/privy.ts     # Privy wallet integration (reference pattern)
│   │   ├── src/viem.ts      # Viem wallet integration
│   │   ├── src/ethers-v5.ts # Ethers v5 wallet integration
│   │   └── src/errors.ts    # Public error types
│   ├── bindings/     # API schemas & bindings (@polymarket/bindings)
│   │   └── src/clob/, data/, gamma/, subscriptions/
│   └── types/        # Shared type primitives (@polymarket/types)
├── examples/scripts/ # Runnable TypeScript examples
│   └── src/          # Public (list-markets, search) & Secure (create-order, positions)
├── docs/             # Design docs (sdk-direction.md)
├── AGENTS.md         # Full agent guidelines (extends this file)
├── CLAUDE.md         # ← You are here
└── CONTRIBUTING.md   # Contribution guide
```

## Key conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): message`
- **Types**: Prefer `type` over `interface`
- **Functions**: Prefer declarations over arrow functions
- **Errors**: Public functions export `...Error` union types with TSDoc `@throws`
- **Wallet integrations**: Each gets its own entry point (`./privy`, `./viem`, `./ethers-v5`) with optional peer deps
- **Perps**: All perps surfaces must carry `@experimental` TSDoc tag

## Build & test workflow

1. **Root-level verification** (after multi-package changes):
   ```bash
   pnpm build && pnpm typecheck && pnpm lint && pnpm test
   ```

2. **Package-specific** (after focused changes):
   ```bash
   pnpm --filter @polymarket/bindings build
   pnpm --filter @polymarket/client test
   ```

3. **tsconfig**: Editor tooling uses root `tsconfig.json`; builds use `tsconfig.build.json`

## Adding a new wallet entry point

To add a new wallet provider (mirroring `./privy` or `./viem`):

1. Create `packages/client/src/<name>.ts` exporting `signerFrom(config)` → `Signer`
2. Add `"./<name>": { "types": ..., "default": ... }` to `exports` in `packages/client/package.json`
3. Add `"./<name>": [...]` to `typesVersions` in `packages/client/package.json`
4. Add the wallet SDK as an optional `peerDependency` (see patterns for `@privy-io/node`)
5. Guard with Node.js runtime check: `invariant(process.release.name === 'node', ...)`
6. Export a `DirectTransactionHandle` class implementing `TransactionHandle`
7. Handle errors with `throwSigningWorkflowError` / `isUserRejectedError`
8. Add integration test gated on env vars
