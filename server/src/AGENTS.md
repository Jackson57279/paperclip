# AGENTS.md — Server

**Scope:** Express REST API routes, services, middleware

## Structure

```
server/src/
├── index.ts           # Server entry: DB init, auth, scheduler, HTTP server
├── app.ts             # Express app factory, middleware stack, route mounting
├── routes/            # API route handlers
├── services/          # Business logic
├── middleware/        # Express middleware
├── adapters/          # Agent adapter implementations
├── storage/           # File storage abstraction
├── secrets/           # Secret management
└── realtime/          # WebSocket live events
```

## Entry Points

| File | Purpose |
|------|---------|
| `index.ts` | HTTP server, embedded PG, auth setup, heartbeat scheduler |
| `app.ts` | Express app, middleware stack, route mounting |

## API Route Patterns

**Factory function receives Db:**
```typescript
export function agentRoutes(db: Db) {
  const router = Router();
  const svc = agentService(db);
  // ... route definitions
  return router;
}
```

**Middleware stack order:**
1. `express.json()` — Body parsing
2. `httpLogger` — Request logging
3. `privateHostnameGuard` — Hostname allowlist
4. `actorMiddleware` — Authentication
5. `boardMutationGuard` — CSRF protection

## Service Layer Pattern

**Factory returns typed service:**
```typescript
export function entityService(db: Db) {
  return {
    async list(companyId: string) { /* ... */ },
    async getById(id: string) { /* ... */ },
    async create(companyId: string, input: CreateInput) { /* ... */ },
  };
}
```

## Error Handling

**Use HttpError helpers:**
```typescript
throw badRequest("Invalid input", details);
throw unauthorized();
throw forbidden("Missing permission");
throw notFound();
throw conflict("Resource exists");
```

## Authentication & Authorization

**Actor types:**
- `"board"` — Human via session (full control)
- `"agent"` — AI via API key/JWT (company-scoped)

**Enforce company access:**
```typescript
assertBoard(req);                    // Require board actor
assertCompanyAccess(req, companyId); // Enforce company scoping
```

## Activity Logging

**Log all mutations:**
```typescript
await logActivity(db, {
  companyId,
  actorType: actor.actorType,
  actorId: actor.actorId,
  action: "entity.action",
  entityType: "entity",
  entityId: entity.id,
  details: { /* context */ },
});
```

## Conventions

1. **Always company-scope queries** — Filter by `companyId`
2. **Use `assertCompanyAccess`** before entity operations
3. **Log all mutations** via `logActivity()`
4. **Validate with Zod** — Use `validate()` middleware
5. **Redact sensitive data** — Use `redactEventPayload()`
6. **Use service factories** — Pass `Db` to create scoped instances
7. **Agent keys cannot cross companies** — Enforced at auth layer
8. **Board mutations require trusted origin** — CSRF protection

## Key Files

| File | Purpose |
|------|---------|
| `routes/authz.ts` | Authorization helpers |
| `routes/index.ts` | Route barrel exports |
| `services/index.ts` | Service barrel exports |
| `middleware/auth.ts` | Actor authentication |
| `middleware/validate.ts` | Zod validation |
| `middleware/error-handler.ts` | Global error handling |
| `errors.ts` | HttpError class and helpers |
| `types/express.d.ts` | Express Request extensions |

## Complexity Hotspots

**Files >1,000 lines (handle with care):**

| File | Lines | Concern |
|------|-------|---------|
| `routes/access.ts` | 2,604 | Auth/invite/permission god file — needs refactoring |
| `services/heartbeat.ts` | 2,330 | Core execution engine — changes affect all agents |
| `routes/agents.ts` | 1,489 | Agent CRUD + adapter logic — adapter defaults leak in |
| `services/issues.ts` | 1,408 | Complex SQL queries — circular dependency risk |
| `routes/issues.ts` | 1,189 | File upload + checkout — service layer concerns |

**Note:** These files are architectural hotspots. Prefer adding new features in separate files rather than expanding these further.
