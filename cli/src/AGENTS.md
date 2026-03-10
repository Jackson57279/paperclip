# AGENTS.md — CLI

**Scope:** Paperclip CLI commands, checks, adapter commands

## Structure

```
cli/src/
├── index.ts           # CLI entry: command dispatcher
├── commands/          # CLI command implementations
│   ├── client/        # Client commands
│   └── index.ts       # Command barrel exports
├── checks/            # Validation checks
│   └── index.ts       # Check barrel exports
├── adapters/          # Adapter-specific CLI commands
└── __tests__/         # CLI tests (11 files)
```

## Entry Point

**`index.ts`** — CLI command dispatcher
- Uses command pattern for subcommands
- Handles global flags and help
- Dispatches to command handlers

## Command Pattern

**Command structure:**
```typescript
// commands/example.ts
export const exampleCommand = {
  name: "example",
  description: "Does something",
  args: [
    { name: "input", description: "Input file" },
  ],
  options: [
    { name: "--verbose", description: "Verbose output" },
  ],
  async execute(args, options) {
    // Command logic
  },
};
```

**Export from commands/index.ts:**
```typescript
export { exampleCommand } from "./example.js";
```

## Checks Pattern

**Validation checks:**
```typescript
// checks/example.ts
export async function checkExample(): Promise<CheckResult> {
  const passed = await someValidation();
  return {
    name: "Example Check",
    passed,
    message: passed ? "OK" : "Failed",
  };
}
```

**Run all checks:**
```typescript
import { allChecks } from "./checks/index.js";

for (const check of allChecks) {
  const result = await check();
  // Report result
}
```

## Adapter Commands

**Each adapter has CLI commands:**
- `setup` — Initial adapter configuration
- `verify` — Verify adapter installation
- `configure` — Interactive configuration

Located in `cli/src/adapters/{adapter}/`.

## Conventions

1. **Use command objects** — Not positional function arguments
2. **Export all commands from index.ts** — Barrel pattern
3. **Checks return CheckResult** — Consistent reporting
4. **Exit codes matter** — 0 for success, non-zero for failure
5. **Support --help** — Auto-generated from command metadata
6. **NPM-published** — Built with esbuild, published to npm

## Build

**Development:**
```bash
pnpm paperclipai  # Run CLI from source
```

**Production build:**
```bash
pnpm build:npm  # Creates bundled CLI
```

**Published as:** `paperclipai` npm package

## Key Files

| File | Purpose |
|------|---------|
| `index.ts` | CLI entry point |
| `commands/index.ts` | Command exports |
| `checks/index.ts` | Check exports |
| `../esbuild.config.mjs` | Build configuration |
