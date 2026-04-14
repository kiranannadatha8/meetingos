# Spec: MeetingOS

> Multi-agent meeting intelligence. Drop a transcript in, get decisions, action items, Linear tickets, and a draft follow-up email out — in ~60 seconds.

**Status:** Phase 0 (scaffolding). Living document — update before implementing scope changes.

---

## Objective

After every meeting, someone spends 20–40 minutes writing notes, extracting action items, and filing Jira tickets. MeetingOS replaces that loop.

**User:** A PM, EM, or team lead who runs 3+ meetings per day and needs action items filed without manual follow-up.

**Input:** An uploaded transcript (audio, `.vtt`, or `.txt`). Zoom/Meet bot ingestion is Phase 2.

**Output (within ~60s of upload completing):**
- A list of **decisions** made, with surrounding context
- A list of **action items** with owner + (optional) due date
- A **Linear issue** created for each action item, assigned to the owner
- A **Gmail draft** summarizing the meeting, addressed to attendees

**Non-goals (MVP):**
- Sending emails automatically (drafts only)
- Jira integration (Linear only)
- Multi-tenant enterprise features (SOC2, SSO beyond Google, audit logs)
- Real-time transcription during the meeting

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind | Server components for the dashboard, SSE via route handlers |
| Auth | NextAuth.js + Google OAuth | Ships with session-in-DB, easy Google Workspace integration |
| BFF | Node.js + Express | Webhook receiver, SSE proxy, OAuth callbacks |
| Queue | BullMQ + Redis | Async transcript processing, retry semantics |
| Orchestrator | FastAPI (Python) | LangGraph and Whisper are Python-native |
| ASR | OpenAI Whisper API | No local GPU dependency for MVP |
| Agent graph | LangGraph | Explicit parallel fan-out for decisions/actions/summary |
| LLM | Claude Sonnet 4.6 (`claude-sonnet-4-6`) | Reasoning quality for extraction + drafting |
| Tracing | LangSmith | Observability on agent runs, eval dataset |
| Tool calls | MCP (custom servers for Linear + Gmail) | Per product requirement |
| DB | PostgreSQL + pgvector | Relational data + transcript embeddings |
| Embeddings | `text-embedding-3-small` | 1536 dims, cheap, good semantic recall |
| Deploy | Railway | Multi-service friendly |
| CI | GitHub Actions | Lint + typecheck + unit tests per package |

---

## Project Structure

```
meetingos/
├── apps/
│   ├── web/              Next.js dashboard + upload UI
│   ├── bff/              Express: webhooks, OAuth, SSE proxy
│   └── orchestrator/     FastAPI: LangGraph agent runs
├── packages/
│   ├── shared/           Shared TS types (API contracts, enums)
│   └── mcp-servers/      mcp-linear, mcp-gmail (Python)
├── infra/
│   ├── docker-compose.yml
│   └── railway.json
├── docs/
│   ├── architecture.md
│   └── adr/              Architecture Decision Records
├── .github/workflows/
├── SPEC.md               this file
├── CLAUDE.md             agent operating instructions
└── README.md
```

---

## Commands

```bash
# Dev (brings up web + bff + orchestrator + postgres + redis)
docker compose -f infra/docker-compose.yml up

# Per-app dev (run in apps/<name>)
pnpm dev                  # web, bff
uv run uvicorn app:app --reload   # orchestrator

# Test
pnpm test                 # web, bff (Vitest)
uv run pytest             # orchestrator, mcp-servers

# Lint + typecheck
pnpm lint && pnpm typecheck
uv run ruff check && uv run mypy .

# Build (CI)
pnpm build
docker build -f apps/<name>/Dockerfile .
```

---

## Code Style

**TypeScript** (web, bff, shared):
```ts
// Named exports, no default exports except Next.js pages/route handlers.
// Zod for runtime validation at every system boundary.
// Return discriminated unions for fallible operations.

import { z } from 'zod';

const MeetingCreate = z.object({
  title: z.string().min(1).max(200),
  transcriptUrl: z.string().url(),
});

type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export async function createMeeting(input: unknown): Promise<Result<Meeting>> {
  const parsed = MeetingCreate.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  // ...
}
```

**Python** (orchestrator, mcp-servers):
```python
# Pydantic v2 models for all I/O. Type hints everywhere.
# Async by default for I/O. Structured logging via structlog.

from pydantic import BaseModel, Field
from typing import Literal

class ActionItem(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    owner_email: str | None = None
    due_date: str | None = None  # ISO 8601
    confidence: Literal["high", "medium", "low"]

async def extract_action_items(transcript: str) -> list[ActionItem]:
    ...
```

**Naming:**
- TS: `camelCase` vars, `PascalCase` types/components, `SCREAMING_SNAKE` env vars.
- Python: `snake_case` everything except classes (`PascalCase`).
- DB: `snake_case` tables and columns, plural table names (`meetings`, not `meeting`).
- Files: `kebab-case.ts` for TS, `snake_case.py` for Python.

---

## Testing Strategy

| Level | Framework | Location | Coverage target |
|---|---|---|---|
| Unit | Vitest (TS) / pytest (Py) | `*.test.ts` co-located / `tests/` sibling | 80% lines |
| Integration | Vitest + Testcontainers / pytest + docker fixtures | `apps/*/tests/integration/` | Critical paths |
| E2E | Playwright | `e2e/` at repo root | Happy path + 2 edge cases per MVP flow |

**Rules:**
- Integration tests hit a real Postgres + Redis (Testcontainers / docker-compose), not mocks.
- Agent node tests record LLM calls with `pytest-recording` / VCR; replay in CI.
- One eval suite in LangSmith: 10 labeled meetings, gate merges on no regression in decision/action-item F1.

---

## Boundaries

**Always:**
- Validate all external input with Zod (TS) or Pydantic (Py) at the boundary.
- Parameterized SQL only. No string concatenation into queries.
- Log the LangSmith run ID with every agent-related server log.
- Keep secrets in env vars; reference `.env.example` for the canonical list.
- Run `pnpm lint && pnpm typecheck` (or Python equivalents) before committing.

**Ask first:**
- Adding a new runtime dependency (check bundle / cold-start impact).
- Changing the DB schema (migrations are irreversible in production).
- Modifying the LangGraph DAG structure (parallelism guarantees are load-bearing).
- Bumping Claude / Whisper / embedding model versions (eval impact).
- Touching CI workflows.

**Never:**
- Commit `.env`, API keys, or OAuth tokens.
- Auto-send emails (Gmail = drafts only in MVP).
- Call Linear / Gmail APIs from anywhere other than the MCP server boundaries.
- Bypass the queue — agent runs must be enqueued, not invoked inline from the BFF.
- Store raw audio beyond 24h (cost + privacy).

---

## Success Criteria

An MVP is "done" when a first-time user can:

1. Sign in with Google in under 10 seconds.
2. Upload a 30-minute `.vtt` transcript and see status progress live via SSE.
3. See extracted decisions and action items rendered within 90 seconds of upload.
4. See one Linear issue created per action item, assigned to the correct owner (verified on 10-meeting eval set: ≥85% owner-resolution accuracy).
5. See a Gmail draft in their drafts folder, addressed to meeting attendees, within the same 90-second window.
6. Observe the full run as a trace in LangSmith with 3 parallel agent branches visible in the timeline.

**Non-functional:**
- p95 end-to-end latency ≤ 120s on a 30-min transcript.
- LangSmith eval F1 ≥ 0.80 on decisions, ≥ 0.75 on action items.
- Whisper + Claude cost per meeting ≤ $0.50 for a 1hr meeting.

---

## Open Questions

- **Owner directory source of truth:** Google Workspace directory sync, or manual user list per workspace? (Blocks Phase 3 action-item owner resolution.)
- **Retention policy:** How long do we keep transcripts? Regulatory implications?
- **Eval dataset sourcing:** Use public meeting corpora (ICSI, AMI) or synthetic? (Blocks prompt iteration loop.)

---

## Phase Gates

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 | Repo skeleton, SPEC, CLAUDE.md, git init | `git log` shows initial commit; SPEC reviewed |
| 1 | Auth + DB schema | Google sign-in works; migrations idempotent |
| 2 | Upload + transcription | 10-min audio → transcript in DB via UI |
| 3 | LangGraph orchestration | 3 parallel branches visible in LangSmith |
| 4 | Dashboard UI | End-to-end demo on sample transcript |
| 5 | MCP servers (Linear, Gmail) | Ticket + draft created from agent run |
| 6 | Deploy | Production URL runs happy path |

Each phase ends with a human review before advancing.
