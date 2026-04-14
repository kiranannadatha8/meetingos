# CLAUDE.md — MeetingOS Agent Operating Guide

> Instructions for Claude Code when operating in this repository.
> For *what we're building*, read `SPEC.md`. This file is *how to work here*.

---

## Read First

Before any non-trivial change:
1. **Read `SPEC.md`** — it's the source of truth for product behavior and boundaries.
2. **Check `docs/adr/`** — architectural decisions land here; don't relitigate them.
3. **Look at `packages/shared/`** — API contracts live there; changes must stay in sync across `apps/`.

---

## Repo Layout (Quick Reference)

```
apps/web            Next.js 14 dashboard          → pnpm (TS)
apps/bff            Express BFF + SSE + webhooks  → pnpm (TS)
apps/orchestrator   FastAPI + LangGraph agents    → uv (Python)
packages/shared     Shared TS types               → pnpm
packages/mcp-servers/mcp-linear, mcp-gmail        → uv (Python)
infra/              Docker Compose, Railway
```

Full detail in `SPEC.md` → Project Structure.

---

## Standard Commands

```bash
# Bring everything up locally
docker compose -f infra/docker-compose.yml up

# TS apps (run inside apps/web or apps/bff)
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm build

# Python apps (run inside apps/orchestrator or packages/mcp-servers/*)
uv run uvicorn app:app --reload
uv run pytest
uv run ruff check
uv run mypy .
```

Before finishing any task that touched code, run the relevant `test` + `lint` + `typecheck` commands and report the result.

---

## Operating Rules

### Always
- Validate at boundaries (Zod in TS, Pydantic in Py). Every webhook, every API request, every LLM output parsed as structured data.
- Use parameterized SQL. Never concatenate user input into queries.
- Log the LangSmith `run_id` with every log line inside an agent run — it's the only way to debug graph behavior.
- Keep each LangGraph node focused on one agent concern; if a node needs two prompts, split it.
- Prefer editing an existing file to creating a new one.
- Before running a command that modifies shared state (DB migrations, deploys, `railway up`), state what it will do and wait for confirmation.

### Ask First
- Adding a runtime dependency.
- Touching `infra/docker-compose.yml` or `railway.json`.
- Changing the LangGraph DAG topology (parallelism is load-bearing for the product).
- Bumping `claude-sonnet-4-6`, Whisper, or `text-embedding-3-small` model versions.
- Introducing a new MCP tool.
- Modifying `SPEC.md` — requires explicit user sign-off.

### Never
- Commit `.env`, OAuth tokens, or API keys. `.env.example` only.
- Auto-send emails. Gmail = drafts only. The MCP Gmail server must not expose a `send` tool in MVP.
- Call Linear or Gmail APIs outside the MCP server boundary.
- Invoke the agent graph synchronously from the BFF. Always enqueue via BullMQ.
- Store raw audio beyond 24 hours (cost + privacy).
- Use `--no-verify`, `git push --force`, or disable pre-commit hooks.
- Delete or rewrite history on `main`.

---

## Architecture Invariants

Breaking any of these changes the product. Don't without an ADR.

1. **Two backends, one DB.** Node BFF owns OAuth/webhooks/SSE; FastAPI orchestrator owns agents. They share Postgres (via Prisma in TS, SQLAlchemy in Py) and Redis (BullMQ + pub/sub for status).
2. **Agent fan-out is parallel.** `planner_node` → {decisions, actions, summary} must execute concurrently. Downstream `linear_tickets` and `email_draft` also run in parallel.
3. **Tool calls go through MCP.** Linear and Gmail access is via custom MCP servers in `packages/mcp-servers/`. No direct REST calls from agent nodes.
4. **Transcripts chunked + embedded.** 500-token chunks with 50-token overlap, stored in `transcripts` with `embedding vector(1536)`. pgvector `ivfflat` index.
5. **Every run traced.** LangSmith callback attached to the LangGraph runnable. No silent agent invocations.

---

## Code Style

- **TS:** Named exports only (except Next.js files that require default). Zod at boundaries. Discriminated unions (`Result<T, E>`) for fallible ops.
- **Python:** Pydantic v2 for all I/O. Full type hints. Async by default for I/O. `structlog` for logging.
- **Naming:** camelCase (TS vars), PascalCase (types/classes), snake_case (Python, DB). Tables plural.
- **Files:** `kebab-case.ts`, `snake_case.py`.

Examples live in `SPEC.md` → Code Style.

---

## Testing Expectations

- Unit test coverage target: 80% lines on new code.
- Integration tests hit real Postgres + Redis via Testcontainers — **do not mock the DB**.
- LLM-calling code uses VCR-style recording (`pytest-recording`); replay in CI.
- LangSmith eval set (`evals/meetings/`) must not regress on F1 for decisions or action items. Merges that regress require written justification.
- E2E tests (Playwright) cover the happy path end-to-end: upload → agents → Linear ticket → Gmail draft visible.

Do **not** disable or skip a failing test to unblock a commit. If a test is wrong, fix or delete it with justification. If the code is wrong, fix the code.

---

## Collaboration Defaults

- **Surface assumptions before coding.** List them, wait for correction.
- **One phase at a time.** Don't start Phase N+1 until Phase N is reviewed.
- **Small commits.** One logical change per commit. Conventional-commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`).
- **No unsolicited refactors.** Touch only what the task requires. Cleanup proposals go in a separate message.
- **Push back on bad ideas.** Don't say "of course!" to an approach with a real problem. Name the problem and propose an alternative.

---

## Current Phase

**Phase 0 — Scaffolding.** No application code yet. Focus on repo hygiene: SPEC, CLAUDE, `.gitignore`, `README`, initial commit.

Next: Phase 1 (Auth + DB schema).
