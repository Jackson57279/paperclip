# AGENTS.md — UI

**Scope:** React + Vite board UI components, pages, API clients

## Structure

```
ui/src/
├── main.tsx           # React entry: providers, router
├── App.tsx            # Root app component
├── pages/             # Route pages (24 pages)
├── components/        # Shared UI components
│   └── ui/            # shadcn/ui base components
├── api/               # API client layer
├── hooks/             # React hooks
├── lib/               # Utilities (router, utils, queryKeys)
├── context/           # React context providers
└── adapters/          # Agent adapter UI components
```

## Entry Points

| File | Purpose |
|------|---------|
| `main.tsx` | React DOM mount, provider stack |
| `App.tsx` | Root component, route layout |

## Component Patterns

**shadcn/ui base components:**
```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("...", {
  variants: {
    variant: { default: "...", destructive: "..." },
    size: { default: "...", sm: "..." },
  },
});

function Button({ className, variant, size, ...props }) {
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
```

**Import path aliases:**
- `@/components/ui/*` — UI components
- `@/lib/*` — Utilities
- `@/api/*` — API clients
- `@/hooks/*` — React hooks
- Relative imports — Feature-specific modules

## API Client Pattern

**ApiError class:**
```typescript
export class ApiError extends Error {
  status: number;
  body: unknown;
}
```

**API function pattern:**
```typescript
export async function listAgents(companyId: string): Promise<Agent[]> {
  const res = await fetch(`/api/companies/${companyId}/agents`);
  if (!res.ok) throw new ApiError(res.status, await res.json());
  return res.json();
}
```

## React Query Patterns

**Query key factory:**
```typescript
// lib/queryKeys.ts
export const queryKeys = {
  agents: {
    list: (companyId: string) => ["agents", companyId] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
  },
};
```

**Hook usage:**
```typescript
const { data: agents, isLoading, error } = useQuery({
  queryKey: queryKeys.agents.list(selectedCompanyId!),
  queryFn: () => agentsApi.list(selectedCompanyId!),
  enabled: !!selectedCompanyId,
});
```

## Routing

**Page components in `pages/`:**
- Each file corresponds to a route
- Use React Router for navigation
- Company-scoped pages use `selectedCompanyId` from context

## Context Providers

**Company selection context:**
- `CompanyProvider` — Manages selected company
- Use `useCompany()` hook in company-scoped pages
- Persist selection to localStorage

## Error Handling

**Surface API errors clearly:**
```typescript
if (error) {
  return <ErrorAlert error={error} />;
}
```

**Never silently ignore errors:**
- Always show error UI
- Log to console in development
- Consider error boundaries for crashes

## Conventions

1. **Keep routes aligned with API** — Match page to endpoint
2. **Use company context** — Company-scoped pages read from context
3. **Surface failures clearly** — Error UI, not silent failures
4. **Use React Query for server state** — Caching, loading, error states
5. **PascalCase for components** — `AgentCard.tsx`
6. **camelCase for utilities** — `formatDate.ts`
7. **Named exports only** — No default exports

## Key Files

| File | Purpose |
|------|---------|
| `api/client.ts` | Base API client |
| `api/agents.ts` | Agent API functions |
| `lib/queryKeys.ts` | React Query key factory |
| `lib/utils.ts` | Utility functions (cn, etc) |
| `context/CompanyContext.tsx` | Company selection |
| `context/ThemeContext.tsx` | Theme provider |

## Build

**Development:**
```bash
pnpm dev:ui  # Vite dev server
```

**Production:**
- Built into `dist/`
- Served by API server in production
- Bundled as part of `pnpm build`
