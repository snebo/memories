# Memories

A NestJS service that ingests conversation transcripts, extracts structured knowledge from them via an LLM, and stores the result as searchable Markdown files in object storage.

---

## Quick start

```bash
cp .env.example .env   # fill in your API key(s)
docker compose up -d --build
```

API: **http://localhost:3000** · Swagger UI: **http://localhost:3000/api**

---

## Core packages

| Package | Role |
|---|---|
| `@nestjs/*` | Framework — modules, DI, decorators, BullMQ integration |
| `prisma` / `@prisma/adapter-pg` | ORM with native PostgreSQL driver |
| `bullmq` / `@nestjs/bullmq` | Redis-backed job queue with dedup and retry |
| `@aws-sdk/client-s3` | S3-compatible storage (MinIO in dev, real S3 in prod) |
| `openai` | OpenAI GPT-4o adapter |
| `@google/generative-ai` | Google Gemini adapter |
| `class-validator` / `class-transformer` | DTO validation |
| `@nestjs/swagger` | Auto-generated API docs from decorators |
| `jest` / `supertest` | Unit, integration, and E2E testing |

---

## Architecture

### Thought process

The goal was a system that could ingest arbitrary transcripts and build a growing, queryable knowledge base from them — without the caller waiting on LLM latency. NestJS was the natural fit: its module system, DI container, and decorator-first design map cleanly onto the problem (ingest module, processing module, storage module). PostgreSQL tracks transcript state and deduplication metadata. Redis + BullMQ handles the async job queue with built-in retries and deduplication. MinIO runs locally to simulate S3 without a cloud account.

### Request flow

```
POST /transcripts
      │
      ▼
TranscriptsService          — SHA-256 dedup, persist to PostgreSQL, enqueue job
      │
      ▼
BullMQ (transcript queue)   — Redis-backed; jobId = transcriptId prevents duplicate queue entries
      │
      ▼
MemoryProcessorService      — BullMQ consumer; CAS pending→processing before any real work
      │
      ▼
LlmService                  — delegates to the configured LLM adapter (OpenAI or Gemini)
      │
      ▼
MemoryWriterService         — builds / merges per-entity Markdown files
      │
      ▼
StorageService              — AWS S3 SDK → MinIO (or real S3)
      │
      ▼
GET /memories  /memories/cat  /memories/grep
```

### Module structure

| Module | Responsibility |
|---|---|
| `TranscriptsModule` | HTTP ingest, SHA-256 dedup, DB persistence, queue enqueue |
| `MemoryModule` | BullMQ worker, LLM extraction, storage writes, read endpoints |
| `PrismaModule` | Global database client |

---

## Memory file structure

```
memories/
  people/           ← one file per person (name-slug.md)
  topics/           ← one file per topic discussed
  entities/
    companies/
    locations/
  timeline/
    2026-Q3/
      summary.md
```

Each file is append-only. New extractions are written as dated `### YYYY-MM-DD` blocks so the full history accumulates without overwriting earlier entries. A duplicate-date guard means retrying a failed job never double-writes the same block.

**Why Markdown?** Plain text is hard to read and hard to grep meaningfully. Well-structured Markdown lets `GET /memories/grep` return excerpts that are immediately human-readable — the heading, date, and bullet context all survive in the excerpt window.

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/transcripts` | Ingest a transcript |
| `GET` | `/transcripts/:id` | Poll processing status |
| `GET` | `/memories` | List files / directories (`ls`) |
| `GET` | `/memories/cat` | Return file contents (`cat`) |
| `GET` | `/memories/grep` | Regex search with line excerpts (`grep`) |

Full request/response examples at **`/api`** (Swagger UI).

---

## Design decisions

### Fire-and-forget ingest

`POST /transcripts` validates input, persists the record, enqueues a background job, and returns `{ id, status: "pending" }` immediately. The caller polls `GET /transcripts/:id` until `status` reaches `"completed"` or `"failed"`.

**Advantage:** HTTP response times are fast and independent of LLM latency (which can be 5–30 s).  
**Disadvantage:** Callers must implement polling. A webhook or SSE push would be better UX but adds infrastructure complexity.

---

### Two-layer idempotency

Duplicate transcripts (same content, submitted more than once) are caught at two independent layers:

| Layer | Mechanism | What it prevents |
|---|---|---|
| 1 | SHA-256 `contentHash` + `@unique` DB index + BullMQ `jobId = transcriptId` | Duplicate HTTP submissions and duplicate queue entries |
| 2 | CAS `updateMany({ where: { status: { in: ['pending', 'failed'] } } })` inside the worker | Two workers racing on the same job |

**Known gap:** If a worker calls the LLM successfully but crashes before writing to storage, the retry will call the LLM again for the same transcript — wasted API spend, but no incorrect data (the file merge is itself idempotent). The fix is a Redis `SET NX` lock keyed on `transcriptId` around the LLM call, with a TTL slightly longer than max LLM response time. This was left out to keep complexity low.

---

### One file per entity

Each person, company, topic, and location gets its own Markdown file rather than storing everything in one large document.

**Advantage:** `GET /memories/grep` can scope searches to a specific directory (`people/`, `topics/`) and return per-file excerpts. Files stay small and focused.  
**Disadvantage:** A transcript mentioning 10 people and 5 topics produces up to 15 file reads/writes. At scale this creates a large number of small objects in storage, which is not ideal for S3 cost or listing performance.

---

### LLM structured output

The LLM is called with a strict JSON schema (`response_format: json_schema` for OpenAI; `responseMimeType: application/json` + `responseSchema` for Gemini). This forces the model to return a predictable structure covering people, companies, locations, topics, facts, sentiment, and timeline — no prompt engineering needed to get JSON out.

**Advantage:** Parsing is deterministic; a well-typed `parseExtractedMemories` function with safe array defaults means a partial LLM response never crashes the worker.  
**Disadvantage:** The structured constraint limits what the LLM can express. Free-form text responses carry more nuance, but they are much harder to parse reliably.

---

### Multi-provider LLM

The LLM adapter is selected at startup via `LLM_PROVIDER=openai|gemini`. Both adapters implement the same `LlmClient` interface (`complete(transcript): Promise<string>`), so `LlmService` is provider-agnostic. Switching providers is a single env-var change with no code change.

---

### MinIO instead of real S3

MinIO runs as a Docker service and implements the full S3 API. The AWS S3 SDK is pointed at it with `forcePathStyle: true`. In production, remove that flag and point `MINIO_ENDPOINT` at a real AWS endpoint — no application code changes required.

**Advantage:** Zero cloud cost or account setup for local development.  
**Disadvantage:** MinIO's behaviour can differ subtly from real S3 on edge cases (ACLs, versioning, lifecycle rules). These differences don't affect this service but are worth noting for future features.

---

### Single queue consumer

`MemoryProcessorService` consumes the `transcript` queue directly. A two-stage fan-out (ingest queue → memory queue + other queues) was considered and rejected: there is currently only one concern on transcript ingest, so adding a second queue buys complexity without benefit. When a second downstream action is needed (webhooks, search indexing), the refactor to fan-out is straightforward with BullMQ.

---

## Testing strategy

### Unit tests — `npm test`

Services are tested in isolation with Jest mocks. Key coverage:

- `LlmService.parseExtractedMemories` — valid, partial, empty, malformed JSON, extra fields
- `MemoryWriterService` — slug generation, all content builders, exact S3 key structure, duplicate-date guard
- `MemoryProcessorService` — CAS idempotency, retry-on-failure, duplicate job skip
- `StorageService` — directory/file listing, prefix normalisation, pagination via `ContinuationToken`
- `MemoryBrowserService` — grep (match, no-match, invalid regex, excerpt context), cat (404)
- Adapter tests — `OpenAiLlmAdapter` and `GeminiLlmAdapter` against mocked SDKs

### Integration tests — `npm run test:integration`

Requires Docker services running. Tests the full HTTP → service → PostgreSQL / MinIO chain with real infrastructure and isolated test buckets.

### E2E test — `npm run test:e2e`

Boots the full NestJS application with a mocked LLM client, submits a transcript, polls until `status === "completed"`, then verifies memory files are queryable via `grep` and `cat`.

---

## What I'd do with more time

| Area | Detail |
|---|---|
| **Real-time notifications** | Replace polling with SSE or webhooks so callers are pushed a notification when processing completes |
| **Authentication** | JWT or API-key guard so users can only access their own transcripts and memories |
| **LLM-assisted merge** | Use a second LLM call to intelligently deduplicate and reconcile new information with what's already in a memory file, rather than appending blindly |
| **Memory versioning** | Keep a `history/` snapshot of every file version to track how understanding of a topic evolved across transcripts |
| **AI-rated retrieval** | Have the LLM score retrieved memory excerpts for relevance before returning them to the caller |
| **Semantic search** | Replace the regex full-scan in `grep` with an embedding index (pgvector or Qdrant) for similarity search |
| **Redis lock around LLM** | Add `SET NX` around the LLM call to prevent redundant API spend on retries |
| **Dead-letter queue** | Route permanently failed jobs to a DLQ with alerting rather than leaving them silently in `failed` status |
| **Pagination** | `GET /memories` currently reads a single S3 page (max 1,000 objects); add cursor-based pagination |
| **Multi-tenancy** | Namespace all S3 keys and DB records by `userId`; currently the entire bucket is shared |

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_HOST` | Yes | `localhost` | Redis hostname |
| `REDIS_PORT` | No | `6379` | Redis port |
| `MINIO_ENDPOINT` | Yes | — | MinIO / S3 endpoint (e.g. `http://minio:9000`) |
| `MINIO_ACCESS_KEY` | Yes | — | Access key |
| `MINIO_SECRET_KEY` | Yes | — | Secret key |
| `MINIO_BUCKET` | No | `memories` | Target bucket name |
| `LLM_PROVIDER` | No | `openai` | `openai` or `gemini` |
| `OPENAI_API_KEY` | If `LLM_PROVIDER=openai` | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model name |
| `GEMINI_API_KEY` | If `LLM_PROVIDER=gemini` | — | Google Gemini API key |
| `GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model name |
| `PORT` | No | `3000` | HTTP listen port |
