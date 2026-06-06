# Memories

A production-grade NestJS service that ingests conversation transcripts, extracts structured knowledge from them via an LLM, and stores the result as searchable markdown files in object storage.

---

## Quick start

```bash
cp .env.example .env           # add your OPENAI_API_KEY
bash scripts/setup.sh          # starts Docker services + runs migrations
```

The API is available at **http://localhost:3000** and the Swagger UI at **http://localhost:3000/api**.

---

## Architecture

### Overview

```
POST /transcripts
      │
      ▼
TranscriptsService          ← SHA-256 dedup, persists to PostgreSQL
      │
      ▼
BullMQ (transcript queue)   ← Redis-backed, jobId = transcriptId (dedup at queue level)
      │
      ▼
MemoryProcessorService      ← BullMQ WorkerHost, CAS pending→processing
      │
      ▼
LlmService                  ← OpenAI GPT-4o, json_schema response_format
      │
      ▼
MemoryWriterService         ← builds / merges per-entity markdown files
      │
      ▼
StorageService              ← AWS S3 SDK → MinIO
      │
      ▼
GET /memories, /memories/cat, /memories/grep
```

### Module structure

| Module              | Responsibility                                                |
| ------------------- | ------------------------------------------------------------- |
| `TranscriptsModule` | HTTP ingest, dedup, DB persistence, queue enqueue             |
| `MemoryModule`      | BullMQ worker, LLM extraction, storage writes, read endpoints |
| `PrismaModule`      | Global database client (PrismaPg adapter)                     |

### Memory file hierarchy

```
memories/
  people/               ← one file per person (slug of name)
  topics/               ← one file per topic discussed
  entities/
    companies/          ← one file per company
    locations/          ← one file per location
  timeline/
    2026-Q3/            ← quarter or month-period directory
      summary.md
```

Each file is append-only: new information is added in a dated `### YYYY-MM-DD` block so the full history is preserved without overwriting earlier extractions.

---

## API endpoints

| Method | Path               | Description                         |
| ------ | ------------------ | ----------------------------------- |
| `POST` | `/transcripts`     | Ingest a transcript                 |
| `GET`  | `/transcripts/:id` | Poll processing status              |
| `GET`  | `/memories`        | List files/directories (`ls`)       |
| `GET`  | `/memories/cat`    | Read a file (`cat`)                 |
| `GET`  | `/memories/grep`   | Regex search with excerpts (`grep`) |

Full documentation with request/response examples is available at **`/api`** (Swagger UI).

---

## Design decisions

### Two-layer idempotency

Duplicate transcripts (identical content) are handled at two independent layers:

| Layer | Mechanism                                                        | What it catches                               |
| ----- | ---------------------------------------------------------------- | --------------------------------------------- |
| 1     | SHA-256 content hash + `@unique` DB index                        | Duplicate HTTP submissions                    |
| 2     | BullMQ `jobId = transcriptId`                                    | Duplicate queue entries if enqueue is retried |
| 3     | CAS `updateMany({ where: { status: 'pending' } })` in the worker | Concurrent worker startup for the same job    |

Even if the same transcript is submitted simultaneously from multiple clients, exactly one extraction job runs and exactly one set of memory files is written.

### Async processing with polling

`POST /transcripts` returns `{ id, status: "pending" }` immediately and enqueues an async job. Callers poll `GET /transcripts/:id` until `status` is `"completed"` or `"failed"`. This keeps HTTP response times fast and decouples ingest throughput from LLM latency.

### LLM structured output

GPT-4o is called with `response_format: { type: "json_schema" }` and a strict schema covering people, companies, locations, topics, facts, sentiment, and timeline. Structured output eliminates prompt engineering for JSON formatting and makes parsing deterministic. `parseExtractedMemories` is a pure function that applies safe defaults for missing arrays so a partial LLM response never crashes the worker.

### Append-only markdown merge

Memory files are never overwritten. New extractions are appended as dated blocks. The service reads each target file from MinIO, merges new information in, and writes the result back. A `### date` duplicate-guard means retrying a failed job does not double-write the same block.

### Path-style S3 for MinIO compatibility

The AWS S3 SDK is configured with `forcePathStyle: true`. MinIO uses path-based URLs (`http://minio:9000/bucket/key`) rather than virtual-hosted URLs, so this flag is required for local development. In production against real AWS S3, remove this flag.

### BullMQ retry configuration

Jobs are configured with `attempts: 3` and exponential back-off starting at 2 s. Failed jobs remain in the queue's failed set (`removeOnFail: false`) so they can be inspected and retried manually. Successful jobs are removed (`removeOnComplete: true`) to keep the Redis memory footprint small.

---

## Assumptions

- **OpenAI GPT-4o is available.** The extraction schema relies on `response_format: json_schema`, which requires at least GPT-4o. Older models are not supported without removing the schema constraint.
- **Transcripts are plain text.** No audio transcription or PDF parsing is included.
- **Single tenant.** All memory files share one MinIO bucket. Multi-tenancy would require per-tenant bucket prefixes.
- **Redis is the BullMQ transport.** Swapping to another queue backend requires only changing `BullModule` configuration.
- **Memory extraction is best-effort.** A failed job (after 3 retries) leaves the transcript in `failed` status without losing the original content.

---

## Test strategy

### Unit tests — `npm test`

Each service is tested in isolation with Jest mocks. 100 tests across 9 suites.

Key coverage:

- `LlmService.parseExtractedMemories` — valid, partial, empty, malformed JSON, extra fields
- `MemoryWriterService` — `toSlug`, all four `build*Content` methods (new + merge + duplicate-date guard), exact S3 key structure for every entity type
- `MemoryProcessorService` — CAS idempotency, retry-on-failure, duplicate job skip
- `StorageService` — `listFiles` (dir/file split, prefix normalisation), `listAllFiles` (pagination via `ContinuationToken`)
- `MemoryBrowserService` — `grep` (match, no-match, invalid regex, excerpt context), `cat` (NotFoundException)
- Controller integration tests — HTTP validation, error codes, and service delegation

### Integration tests — `npm run test:integration`

Requires Docker services running (`docker compose up -d`). Tests the real HTTP → service → database/MinIO chain.

- `transcript-ingest` — persistence, SHA-256 dedup, `GET /transcripts/:id`, 404
- `memory-queries` — file listing, cat, grep against real MinIO with seeded fixtures; uses an isolated `memories-integration-test` bucket

### E2E test — `npm run test:e2e`

Requires the full Docker Compose stack. Boots the entire NestJS application with mocked OpenAI and exercises the complete flow end-to-end:

1. `POST /transcripts`
2. Poll `GET /transcripts/:id` until `status === "completed"`
3. `GET /memories/grep` and `GET /memories/cat` to verify memory files were written

Uses an isolated `memories-e2e-test` bucket, cleaned up after each test.

---

## What I'd do with more time

| Area                  | Detail                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pagination**        | `GET /memories` uses a single S3 page (max 1000 objects). Add cursor-based pagination with `ContinuationToken`.                                                                    |
| **SSE / webhooks**    | Replace polling with Server-Sent Events or a webhook callback so clients are pushed a notification when processing completes.                                                      |
| **Dead-letter queue** | Route permanently failed jobs to a DLQ with alerting instead of leaving transcripts silently in `failed` status.                                                                   |
| **Semantic search**   | Replace the regex full-scan in `grep` with an embedding index (pgvector or Qdrant) for semantic similarity search.                                                                 |
| **Multi-tenancy**     | Namespace all S3 keys and DB records by `tenantId`. Currently the entire bucket is shared.                                                                                         |
| **Authentication**    | Add a JWT or API-key guard. The API is currently unauthenticated.                                                                                                                  |
| **Observability**     | Structured JSON logging with correlation IDs + OpenTelemetry traces spanning the full request → queue job → LLM call → storage write path.                                         |
| **LLM fallback**      | Add a circuit breaker around the OpenAI call with a fallback to a secondary provider or a graceful partial extraction on timeout.                                                  |
| **Path validation**   | Validate that `path` query params conform to expected key patterns. S3 key-space isolation provides a security boundary, but rejecting obviously malformed paths would improve UX. |
| **Memory versioning** | Keep a `history/` copy of every file version so diffs across extractions can be inspected without parsing the markdown.                                                            |

---

## Environment variables

| Variable           | Required | Default     | Description                                   |
| ------------------ | -------- | ----------- | --------------------------------------------- |
| `DATABASE_URL`     | Yes      | —           | PostgreSQL connection string                  |
| `REDIS_HOST`       | Yes      | `localhost` | Redis hostname                                |
| `REDIS_PORT`       | No       | `6379`      | Redis port                                    |
| `MINIO_ENDPOINT`   | Yes      | —           | MinIO endpoint URL (e.g. `http://minio:9000`) |
| `MINIO_ACCESS_KEY` | Yes      | —           | MinIO / S3 access key                         |
| `MINIO_SECRET_KEY` | Yes      | —           | MinIO / S3 secret key                         |
| `MINIO_BUCKET`     | No       | `memories`  | Target bucket name                            |
| `OPENAI_API_KEY`   | Yes      | —           | OpenAI API key                                |
| `OPENAI_MODEL`     | No       | `gpt-4o`    | Model used for extraction                     |
| `PORT`             | No       | `3000`      | HTTP listen port                              |
