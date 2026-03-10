# AGENTS.md — Database

**Scope:** Drizzle schema, migrations, database client

## Structure

```
packages/db/src/
├── index.ts           # Exports: createDb, schema, migrations
├── client.ts          # Database client factory
├── schema/            # Drizzle table definitions
│   ├── index.ts       # Schema barrel exports
│   ├── companies.ts
│   ├── agents.ts
│   └── ...
└── migrations/        # Generated SQL migrations
    └── meta/
```

## Schema Patterns

**Standard table structure:**
```typescript
export const agents = pgTable(
  "agents",  // plural, snake_case
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("idle"),
    config: jsonb("config").$type<Record<string, unknown>>()
      .notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (table) => ({
    // Index naming: {table}_{columns}_idx
    companyStatusIdx: index("agents_company_status_idx")
      .on(table.companyId, table.status),
  }),
);
```

**Naming conventions:**
- Tables: plural, snake_case (`agents`, `companies`)
- Columns: snake_case in DB, camelCase in TS
- Indexes: `{table}_{columns}_idx`
- Timestamps: always use `withTimezone: true`
- JSONB: use `.$type<T>()` for type safety

## Self-References

```typescript
import type { AnyPgColumn } from "drizzle-orm/pg-core";

parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id),
```

## Export Pattern

**Always export from schema/index.ts:**
```typescript
// schema/index.ts
export { agents } from "./agents.js";
export { companies } from "./companies.js";
// ... all tables
```

## Database Change Workflow

1. **Edit** `packages/db/src/schema/*.ts`
2. **Export** new tables from `packages/db/src/schema/index.ts`
3. **Generate** migration:
   ```bash
   pnpm db:generate
   ```
   (This compiles first, reads from `dist/schema/*.js`)
4. **Validate** compile:
   ```bash
   pnpm -r typecheck
   ```

## Migrations

**Configuration:** `drizzle.config.ts`
```typescript
{
  schema: "./dist/schema/*.js",  // Reads compiled JS
  out: "./src/migrations",       // Outputs SQL here
  dialect: "postgresql",
}
```

**Apply migrations:**
```bash
pnpm db:migrate  # Runs tsx src/migrate.ts
```

## Development Mode

**Embedded PostgreSQL (PGlite):**
- Leave `DATABASE_URL` unset
- Data persists at `~/.paperclip/instances/default/db`
- Auto-applies migrations on first run

**External PostgreSQL:**
- Set `DATABASE_URL` environment variable
- Production deployments use this mode

## Key Conventions

1. **Every entity has `companyId`** — Multi-tenancy boundary
2. **Use `defaultRandom()` for UUIDs** — Not `uuid_generate_v4()`
3. **Always use timestamps with timezone**
4. **JSONB defaults to `{}`** — Not NULL
5. **Soft deletes via `hiddenAt`** — No hard DELETEs
6. **Indexes on filtered queries** — Company + status combos
7. **Relations defined separately** — In relations.ts files

## Key Files

| File | Purpose |
|------|---------|
| `schema/index.ts` | All table exports |
| `client.ts` | Database client factory |
| `migrate.ts` | Migration runner script |
| `seed.ts` | Development seed data |
| `../drizzle.config.ts` | Drizzle-kit config |
