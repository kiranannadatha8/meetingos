# Phase 1 — TODO

> Rolling checklist. Full plan and acceptance criteria live in [`plan.md`](./plan.md).
> Status convention: `[ ]` pending, `[~]` in progress, `[x]` done.

---

## Phase 1a — Data substrate

- [ ] **Task 1** — Bring up Postgres + Redis locally; verify pgvector (XS)
  - Gate: `docker compose ps` shows both healthy; `CREATE EXTENSION vector` succeeds.

- [ ] **Task 2** — `packages/db`: Prisma schema + first migration (M)
  - Gate: migration idempotent; `apps/web` type-checks against `@meetingos/db`; `vector(1536)` column + `ivfflat` index verified.

- [ ] **Task 3** — Orchestrator: SQLAlchemy models + DB-aware `/healthz` (M)
  - Gate: drift test green; `/healthz` reports `db: "ok" | "error"` correctly.

### ─ Checkpoint A ─ data substrate working end-to-end
- [ ] `pnpm test` + `uv run pytest` both green
- [ ] CI green on push
- [ ] Human review of `schema.prisma`

---

## Phase 1b — Authentication

- [ ] **Task 4** — NextAuth v5 + Google OAuth in `apps/web` (M)
  - Gate: real Google sign-in creates User + Session rows; sign-out deletes Session.
  - Human-side prereq: create Google OAuth client ID with localhost callback.

- [ ] **Task 5** — Protected `/dashboard` + session-aware home (S)
  - Gate: middleware redirects anonymous users; greeting renders; CTAs flip on auth state.

### ─ Checkpoint B ─ Phase 1 exit
- [ ] SPEC Phase 1 row exit criteria satisfied
- [ ] `docs/adr/0001-prisma-owns-schema.md` written
- [ ] `SPEC.md` Phase Gates table updated
- [ ] Human review before Phase 2

---

## Carried forward (not Phase 1)

Things noticed during planning but explicitly *not* in scope:

- BFF session verification (forwarding NextAuth session to `apps/bff`) — Phase 2 (needed for upload auth).
- Google Workspace directory sync — Phase 3 (needed for action-item owner resolution).
- `prisma/seed.ts` — optional; add only when Phase 2 UI work needs synthetic meetings.
- ESLint configs across TS workspaces — small cleanup, queue for a lull slice.
