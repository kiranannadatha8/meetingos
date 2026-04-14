# Implementation Plan: Phase 1 — Auth + DB Schema

> Source of truth: [`../SPEC.md`](../SPEC.md). This plan implements the **Phase 1** row of that doc's Phase Gates table.
> Exit criteria (from SPEC): *Google sign-in works; migrations idempotent.*

---

## Overview

Land the data substrate and the sign-in flow. After Phase 1, a user can sign in with their Google Workspace account, a row appears in the `users` table, and both the Node side (Prisma) and the Python side (SQLAlchemy) can read/write the same Postgres. Upload, agent orchestration, and UI work in later phases all assume this foundation is stable.

## Architecture Decisions

### AD-1: Prisma owns the schema; SQLAlchemy mirrors it

**Decision:** Prisma is the single source of truth for DDL and migrations. SQLAlchemy models in `apps/orchestrator` are hand-written to match the live schema. The orchestrator does not run migrations.

**Why:** Dual migration ownership (Prisma + Alembic) is a race waiting to happen. With one owner, drift is possible in one direction only (hand-written SA models falling behind Prisma) and can be caught by a CI check that compares live Postgres `information_schema` against declared SA columns.

**Tradeoff:** Schema changes require updating two files (Prisma schema + SA models). Acceptable for MVP; revisit if the schema churns aggressively in Phase 3.

### AD-2: NextAuth v5 (Auth.js), database session strategy, Prisma adapter

**Decision:** Use `next-auth@5` (Auth.js v5 stable), database sessions (not JWT), Prisma adapter.

**Why:** v5 has first-class App Router support and typed `auth()` server helper. Database sessions are necessary for Phase 2 — the BFF will look up sessions in the DB to authenticate server-to-server requests from `apps/web`. JWT sessions couldn't be verified from the BFF without sharing the signing secret, which is brittle.

**Tradeoff:** Each request costs one DB round-trip for session lookup. Acceptable at MVP scale (<1K daily active users); add a session cache if it becomes hot.

### AD-3: `packages/db` hosts the Prisma schema, consumed by `apps/web` and `apps/bff`

**Decision:** New workspace package `packages/db` exports a configured `PrismaClient` singleton. Both `web` and `bff` import it.

**Why:** Co-locating Prisma with one app (e.g., `apps/web`) forces the other app to reach across apps for types. `packages/db` as a shared workspace package makes the client a proper cross-app dependency, mirrors how `packages/shared` works, and keeps `schema.prisma` in one place.

### AD-4: pgvector column uses `Unsupported("vector(1536)")` in Prisma

**Decision:** Prisma doesn't natively model the `vector` type. Declare transcripts' embedding column with `Unsupported("vector(1536)")`. Writes to that column go via `$executeRaw` helpers in a typed service, not via Prisma's generated query builder.

**Why:** Industry-standard workaround; Prisma still manages the column's existence via migrations, just not its query shape.

**Tradeoff:** Vector queries can't use Prisma's type safety. Mitigated by a thin typed wrapper in `packages/db` that enforces shape at the boundary.

### AD-5: Cross-app cookie sharing is deferred to Phase 2

**Decision:** Phase 1 only proves sign-in works *within* `apps/web`. BFF session verification (reading the NextAuth cookie or a forwarded session token) is Phase 2 work, scoped to the upload endpoint that needs it.

**Why:** Phase 1's exit criteria are narrow ("Google sign-in works"). Shoving BFF auth into Phase 1 dilutes the gate and couples two unrelated concerns.

---

## Dependency Graph

```
 Postgres + pgvector up           (Slice 1 — blocks all)
        │
        ▼
 packages/db: Prisma schema        (Slice 2)
        │
        ├──────────────────────────┬─────────────────────────┐
        ▼                          ▼                         ▼
 apps/orchestrator                apps/web                 (Phase 2+)
   SQLAlchemy DB conn              NextAuth + Google
      (Slice 3)                        (Slice 4)
                                         │
                                         ▼
                                  Protected dashboard shell
                                         (Slice 5)
```

**Parallelizable after Slice 2:** Slices 3 and 4 have no code-level dependency on each other. A second session could run them concurrently if available; solo, Slice 3 is the safer next step (less blocked by external setup like OAuth credentials).

---

## Task List

### Phase 1a — Data substrate

#### Task 1: Bring up Postgres + Redis locally; verify pgvector

**Description:** Use the docker-compose from Phase 0 to bring Postgres and Redis up on the host. Verify the `vector` extension can be created. Document the dev loop in `README.md`.

**Acceptance criteria:**
- [ ] `docker compose -f infra/docker-compose.yml up -d` starts both services and both report healthy within 30s
- [ ] `psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT '1'::vector(1);"` succeeds
- [ ] `README.md` gains a "Local development" section listing the exact commands

**Verification:**
- [ ] `docker compose ps` shows `postgres (healthy)` and `redis (healthy)`
- [ ] A Node one-liner (`node -e "..."`) using `pg` connects and `SELECT 1` returns
- [ ] A Python one-liner using `psycopg` connects and returns

**Dependencies:** None (depends on Phase 0 infra slice 6 artifacts)

**Files likely touched:**
- `README.md` (new "Local development" section)
- `.env` (local only, gitignored — created from `.env.example`)

**Estimated scope:** XS

---

#### Task 2: `packages/db` — Prisma schema, client, first migration

**Description:** Create a new workspace package that hosts Prisma. Define the full MVP schema: NextAuth tables (`User`, `Account`, `Session`, `VerificationToken`) and domain tables (`Meeting`, `Transcript`, `Decision`, `ActionItem`, `AgentRun`). Generate and apply the initial migration. Export a singleton `PrismaClient` for consumers.

**Acceptance criteria:**
- [ ] `packages/db/prisma/schema.prisma` models all tables listed in SPEC.md Phase 1
- [ ] `pnpm --filter @meetingos/db exec prisma migrate dev --name init` applies cleanly and creates migration SQL
- [ ] Running the migration twice in a row is a no-op (idempotent — explicitly tested in CI)
- [ ] `packages/db/src/client.ts` exports a `prisma` singleton (avoids multiple clients in dev hot-reload)
- [ ] `apps/web` imports `prisma` from `@meetingos/db` and type-checks
- [ ] Transcripts' embedding column is `vector(1536)` in Postgres (verified with `\d transcripts`)
- [ ] An `ivfflat` index exists on `transcripts.embedding` with `vector_l2_ops`

**Verification:**
- [ ] `pnpm --filter @meetingos/db test` passes (minimum: 1 test that creates + queries a `User` via the client against the live DB)
- [ ] `psql $DATABASE_URL -c "\d transcripts"` shows `embedding | vector(1536)`
- [ ] `pnpm typecheck` still green across the workspace

**Dependencies:** Task 1

**Files likely touched:**
- `packages/db/package.json`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/*/migration.sql`
- `packages/db/src/client.ts`
- `packages/db/src/client.test.ts`
- `packages/db/tsconfig.json`
- Root `pnpm-lock.yaml`

**Estimated scope:** M

---

#### Task 3: Orchestrator DB connection — SQLAlchemy models mirror Prisma

**Description:** Wire `apps/orchestrator` to Postgres via SQLAlchemy 2.x (async). Hand-write models that mirror the Prisma schema for the tables the orchestrator needs (`Meeting`, `Transcript`, `Decision`, `ActionItem`, `AgentRun`). Extend `/healthz` to verify the DB connection is live. No migrations from this side (AD-1).

**Acceptance criteria:**
- [ ] `apps/orchestrator/src/orchestrator/db.py` exposes an async engine + `get_session()` dependency
- [ ] Models for 5 tables match Prisma column names and types (column-by-column)
- [ ] A drift test queries `information_schema.columns` and asserts each SA model's columns exist in the live DB with matching types
- [ ] `/healthz` returns `{service, status, db: "ok" | "error"}` — `ok` when a `SELECT 1` succeeds, `error` otherwise

**Verification:**
- [ ] `uv run pytest` passes (health test extended + drift test)
- [ ] `uv run ruff check && uv run mypy` green
- [ ] Manually: stop Postgres, hit `/healthz`, see `db: "error"`; restart, see `db: "ok"`

**Dependencies:** Task 2 (schema must exist before the drift test can pass)

**Files likely touched:**
- `apps/orchestrator/pyproject.toml` (add `sqlalchemy`, `asyncpg`, `psycopg[binary]`)
- `apps/orchestrator/src/orchestrator/db.py`
- `apps/orchestrator/src/orchestrator/models.py`
- `apps/orchestrator/src/orchestrator/app.py` (extend `/healthz`)
- `apps/orchestrator/tests/test_health.py` (update expected response)
- `apps/orchestrator/tests/test_schema_drift.py` (new)

**Estimated scope:** M

---

### Checkpoint A — Data substrate

- [ ] Task 1, 2, 3 all complete and committed
- [ ] `pnpm test` green across TS workspace
- [ ] `uv run pytest` green in orchestrator
- [ ] `docker compose ps` shows healthy services
- [ ] CI workflow run on the push is green
- [ ] Human review: skim `packages/db/prisma/schema.prisma` and confirm the table shape matches SPEC before advancing

---

### Phase 1b — Authentication

#### Task 4: NextAuth v5 + Google OAuth in `apps/web`

**Description:** Add NextAuth v5 with the Google provider and Prisma adapter. Implement the `/api/auth/[...nextauth]` route handler and the typed `auth()` server helper. Sign-in and sign-out pages use the Auth.js built-in handlers. Session strategy: database.

**Acceptance criteria:**
- [ ] Clicking "Sign in" on `/` redirects to Google, and after consent, back to `/` with a session established
- [ ] A new `User` row is created on first sign-in; subsequent sign-ins reuse it
- [ ] A `Session` row exists in the DB with a future `expires` timestamp
- [ ] `auth()` in a Server Component returns `{ user: { id, email, name, image } }` for a signed-in user, `null` otherwise
- [ ] `/auth/signout` terminates the session (row is deleted from `Session` table)

**Verification:**
- [ ] Manual end-to-end: sign in with a real Google account, confirm DB state in psql
- [ ] Unit test: `auth.config.ts` exports a valid NextAuth config shape (type-check only)
- [ ] `pnpm --filter @meetingos/web test` still green
- [ ] CI run green

**Dependencies:** Task 2 (Prisma schema must have NextAuth tables)

**Files likely touched:**
- `apps/web/package.json` (add `next-auth@5`, `@auth/prisma-adapter`)
- `apps/web/src/auth.ts` (config + exported `auth`, `signIn`, `signOut`)
- `apps/web/src/app/api/auth/[...nextauth]/route.ts`
- `apps/web/src/app/page.tsx` (show sign-in / sign-out button)
- `apps/web/src/app/page.test.tsx` (update assertions)
- `apps/web/.env.local.example` (NEXTAUTH_URL, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)

**Estimated scope:** M

**Risks:** User must create a Google OAuth 2.0 client ID at console.cloud.google.com with the redirect URI `http://localhost:3000/api/auth/callback/google`. This is a human-only step; cannot be scripted. Block-mitigate: provide step-by-step instructions in `docs/auth-setup.md`.

---

#### Task 5: Protected dashboard shell + session-aware UI

**Description:** Add `middleware.ts` that gates `/dashboard/*` behind authentication. Build the minimal dashboard page that greets the user by name and offers sign-out. Home (`/`) becomes a marketing-ish page with a "Sign in" CTA for anonymous users and a "Go to dashboard" CTA for signed-in users.

**Acceptance criteria:**
- [ ] Navigating to `/dashboard` unauthenticated redirects to the Google sign-in flow
- [ ] After signing in, the user lands on `/dashboard` and sees "Hello, <their name>" plus a sign-out button
- [ ] Signing out from `/dashboard` redirects to `/`
- [ ] `/` shows different CTAs depending on auth state (Server Component using `auth()`)

**Verification:**
- [ ] Two RTL tests: `<DashboardGreeting name="Alice" />` renders "Hello, Alice"; an anonymous home page renders "Sign in"
- [ ] Manual end-to-end: incognito window → navigate to `/dashboard` → sign-in flow → dashboard visible
- [ ] `pnpm typecheck && pnpm test && pnpm build` green

**Dependencies:** Task 4

**Files likely touched:**
- `apps/web/src/middleware.ts`
- `apps/web/src/app/dashboard/page.tsx`
- `apps/web/src/app/dashboard/page.test.tsx` (component unit test for `DashboardGreeting`)
- `apps/web/src/components/dashboard-greeting.tsx` (extracted for testability)
- `apps/web/src/app/page.tsx` (update to show auth-aware CTA)
- `apps/web/src/app/page.test.tsx` (update expectations)

**Estimated scope:** S

---

### Checkpoint B — Phase 1 complete

- [ ] All 5 tasks complete and committed
- [ ] SPEC Phase 1 exit criteria met:
  - [ ] Google sign-in works (manually verified with a real Google account)
  - [ ] Migrations are idempotent (CI test asserts `prisma migrate deploy` is a no-op on a freshly migrated DB)
- [ ] CI green on the final push
- [ ] `docs/adr/0001-prisma-owns-schema.md` written summarizing AD-1
- [ ] SPEC Phase Gate for Phase 1 marked complete (diff `SPEC.md`)
- [ ] Human review before advancing to Phase 2

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Schema drift between Prisma and SQLAlchemy | HIGH — wrong data shapes break agents in Phase 3 | Drift test in Task 3 compares live `information_schema` against SA models. CI fails on drift. |
| OAuth setup is a human blocker | MEDIUM — blocks Tasks 4–5 end-to-end verification | Write `docs/auth-setup.md` with exact console.cloud.google.com clicks. Tasks 4–5 have component tests that don't need live OAuth. |
| Prisma + pgvector friction (no native type) | MEDIUM — risk of runtime errors on embedding writes | Wrap all vector writes in a typed helper in `packages/db` with runtime shape checks. Covered in Phase 2 when embeddings are actually written. |
| NextAuth v5 still labeled "stable but recent" | LOW | Pin exact version; if we hit a blocking bug, v4 is a straightforward fallback (same config surface). |
| Running migrations against prod data in the future | N/A for Phase 1 | Out of scope; addressed in Phase 6 (deploy). |

## Open Questions

- **Google Workspace directory sync** — Phase 1 only stores the user's own profile. The SPEC flags owner-resolution (Phase 3) as depending on a directory sync. Do we want to piggyback Phase 1 by pulling the user's directory on first sign-in, or defer entirely to Phase 3? (Recommendation: defer.)
- **Seed data for dev** — should we ship a `prisma/seed.ts` that inserts a synthetic meeting for local UI work? Convenient but adds code; skipping is fine.

## Estimated Scope

| Task | Size | Rough hours |
|---|---|---|
| 1. Docker + pgvector verify | XS | 0.5 |
| 2. Prisma schema + migrations | M | 2.5 |
| 3. Orchestrator SA + healthz | M | 2.0 |
| 4. NextAuth + Google OAuth | M | 2.0 |
| 5. Protected dashboard shell | S | 1.0 |
| Buffer (15%) | — | 1.0 |
| **Phase 1 total** | | **~9 hours** |

This tracks the ~4h estimate in the original plan's "Phase 1: Auth + DB" line, slightly expanded because the original undercounted the orchestrator SA wiring.
