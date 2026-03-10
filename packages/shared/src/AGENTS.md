# AGENTS.md — Shared

**Scope:** Domain constants, TypeScript types, Zod validators, API path constants

## Structure

```
packages/shared/src/
├── index.ts           # Main barrel: exports everything
├── constants.ts       # Enum-like arrays + derived types (247 lines)
├── api.ts             # API route path constants
├── config-schema.ts   # Runtime config validation
├── agent-url-key.ts   # URL key generation utilities
├── types/             # Domain entity types
│   ├── index.ts       # Type barrel exports
│   ├── agent.ts
│   ├── company.ts
│   └── ... (17 modules)
└── validators/        # Zod schemas
    ├── index.ts       # Validator barrel exports
    ├── agent.ts
    └── ... (11 modules)
```

## Constants Pattern

**Define enums as const arrays:**
```typescript
export const AGENT_STATUSES = [
  "active", "paused", "idle", "running", "error", ...
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];
```

**Common constants:**
- `COMPANY_STATUSES`, `AGENT_STATUSES`, `ISSUE_STATUSES`
- `APPROVAL_STATUSES`, `COST_EVENT_TYPES`
- `ADAPTER_TYPES`, `AGENT_PERMISSIONS`

## Type Patterns

**Pure interfaces (no classes):**
```typescript
export interface Agent {
  id: string;
  companyId: string;
  name: string;
  status: AgentStatus;  // Use constants-derived types
  adapterConfig: Record<string, unknown>;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
}
```

**Key type categories:**
- Entity types: `Agent`, `Company`, `Issue`, `Project`, `Goal`
- Runtime types: `AdapterRuntime`, `ExecutionContext`
- Config types: `PaperclipConfig`, `DeploymentMode`

## Validator Patterns

**Zod schemas with type inference:**
```typescript
import { z } from "zod";
import { AGENT_STATUSES } from "../constants.js";

export const createAgentSchema = z.object({
  name: z.string().min(1),
  status: z.enum(AGENT_STATUSES).optional(),
  // ...
});

export type CreateAgent = z.infer<typeof createAgentSchema>;
```

## API Path Constants

**Centralized API paths:**
```typescript
export const API_PREFIX = "/api";

export const API = {
  AGENTS: `${API_PREFIX}/agents`,
  COMPANIES: `${API_PREFIX}/companies`,
  ISSUES: `${API_PREFIX}/issues`,
  // ...
} as const;
```

## Adding a New Domain Entity

1. **Add constants** to `constants.ts`:
   ```typescript
   export const ENTITY_STATUSES = [...] as const;
   export type EntityStatus = (typeof ENTITY_STATUSES)[number];
   ```

2. **Add type** to `types/entity.ts`:
   ```typescript
   export interface Entity { ... }
   ```

3. **Export type** from `types/index.ts`:
   ```typescript
   export type { Entity } from "./entity.js";
   ```

4. **Add validator** to `validators/entity.ts`:
   ```typescript
   export const createEntitySchema = z.object({ ... });
   export type CreateEntity = z.infer<typeof createEntitySchema>;
   ```

5. **Export validator** from `validators/index.ts`.

## Conventions

1. **Use const arrays for enums** — Enables runtime iteration
2. **Derive types from constants** — Single source of truth
3. **Zod schemas in validators/** — Separate from types/
4. **Export from index.ts barrels** — Clean imports
5. **No business logic** — Pure types/constants only
6. **`.js` extensions in imports** — NodeNext resolution

## Key Files

| File | Purpose |
|------|---------|
| `constants.ts` | All enum definitions (247 lines) |
| `types/index.ts` | Type barrel exports (17 modules) |
| `validators/index.ts` | Zod barrel exports (11 modules) |
| `api.ts` | API path constants |
| `config-schema.ts` | Runtime config validation |
| `agent-url-key.ts` | URL key utilities |

## Dependencies

**Zero runtime dependencies** — Only `zod` for validation.

**Consumers:**
- `packages/db` — Uses constants for defaults
- `server` — Uses types and validators
- `ui` — Uses types and API constants
- `cli` — Uses types and validators
