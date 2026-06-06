/**
 * End-to-end test: transcript ingest → LLM extraction → memory files → grep.
 *
 * Prerequisites: Docker Compose stack must be fully running.
 *   docker compose up -d
 *
 * OpenAI is replaced with a deterministic mock so no real API calls are made.
 * The test polls GET /transcripts/:id until status reaches "completed" (max 30 s),
 * then verifies the memory files are queryable via GET /memories/grep.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OPENAI_CLIENT } from '../src/memory/llm.service';
import { S3_CLIENT } from '../src/memory/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Isolated bucket — never touches the dev bucket.
process.env['MINIO_BUCKET'] = 'memories-e2e-test';

const EXTRACTED_MEMORIES = {
  entities: {
    people: [
      {
        name: 'Alice Johnson',
        role: 'Backend Engineer',
        context: 'Led the Q3 backend redesign proposal',
      },
    ],
    companies: [{ name: 'Acme Corp', context: 'Alice works here' }],
    locations: [],
  },
  topics: [
    {
      name: 'Backend Redesign',
      summary: 'Moving to a microservices architecture',
      keyPoints: [
        'Start with authentication service',
        'Use event-driven patterns',
      ],
    },
  ],
  facts: [
    {
      content: 'Migration is targeted for Q3 2026',
      confidence: 'high',
      relatedEntities: ['Alice Johnson', 'Acme Corp'],
    },
  ],
  sentiment: {
    overall: 'positive',
    score: 0.8,
    notes: 'Team is aligned on the direction',
  },
  timeline: [
    {
      date: '2026-Q3',
      event: 'Backend migration kickoff',
      participants: ['Alice Johnson'],
    },
  ],
};

const mockOpenAiClient = {
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(EXTRACTED_MEMORIES) } }],
      }),
    },
  },
};

async function poll<T>(
  fn: () => Promise<T>,
  until: (val: T) => boolean,
  intervalMs = 500,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (until(result)) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('poll timed out');
}

async function emptyBucket(s3: S3Client, bucket: string): Promise<void> {
  const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  if (!list.Contents?.length) return;
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: list.Contents.map((o) => ({ Key: o.Key! })) },
    }),
  );
}

describe('POST /transcripts → poll → GET /memories/grep (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let s3: S3Client;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OPENAI_CLIENT)
      .useValue(mockOpenAiClient)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    s3 = moduleFixture.get<S3Client>(S3_CLIENT);
  });

  afterAll(async () => {
    await prisma.transcript.deleteMany();
    await emptyBucket(s3, 'memories-e2e-test');
    await app.close();
  });

  beforeEach(async () => {
    await prisma.transcript.deleteMany();
    await emptyBucket(s3, 'memories-e2e-test');
    mockOpenAiClient.chat.completions.create.mockClear();
  });

  it('processes a transcript end-to-end and writes queryable memory files', async () => {
    // Step 1: submit the transcript
    const { body: transcript } = await request(app.getHttpServer())
      .post('/transcripts')
      .send({
        content:
          'Alice Johnson led the Q3 backend redesign discussion at Acme Corp. ' +
          'She proposed moving to microservices, starting with the authentication service.',
      })
      .expect(201);

    expect(transcript.id).toBeDefined();
    expect(transcript.status).toBe('pending');

    // Step 2: poll until the worker completes processing
    const final = await poll(
      async () => {
        const { body } = await request(app.getHttpServer())
          .get(`/transcripts/${transcript.id}`)
          .expect(200);
        return body as { status: string };
      },
      (body) => body.status === 'completed' || body.status === 'failed',
    );

    expect(final.status).toBe('completed');

    // Step 3: verify the LLM was called once
    expect(mockOpenAiClient.chat.completions.create).toHaveBeenCalledTimes(1);

    // Step 4: grep for Alice Johnson's memory file
    const { body: aliceGrep } = await request(app.getHttpServer())
      .get('/memories/grep')
      .query({ pattern: 'alice johnson', path: 'people/' })
      .expect(200);

    expect(aliceGrep.matches.length).toBeGreaterThan(0);
    const aliceFile = aliceGrep.matches.find(
      (m: { file: string }) => m.file === 'people/alice-johnson.md',
    );
    expect(aliceFile).toBeDefined();

    // Step 5: verify the topic memory file was written
    const { body: topicGrep } = await request(app.getHttpServer())
      .get('/memories/grep')
      .query({ pattern: 'microservices', path: 'topics/' })
      .expect(200);

    expect(topicGrep.matches.length).toBeGreaterThan(0);
    expect(topicGrep.matches[0].file).toBe('topics/backend-redesign.md');

    // Step 6: cat Alice's file and verify content
    const { body: catResult } = await request(app.getHttpServer())
      .get('/memories/cat')
      .query({ path: 'people/alice-johnson.md' })
      .expect(200);

    expect(catResult.content).toContain('# Alice Johnson');
    expect(catResult.content).toContain('Backend Engineer');
  });

  it('is idempotent — resubmitting the same transcript does not create duplicate memory files', async () => {
    const content =
      'Bob Smith raised concerns about the migration timeline at Acme Corp.';

    await request(app.getHttpServer())
      .post('/transcripts')
      .send({ content })
      .expect(201);

    const { body: duplicate } = await request(app.getHttpServer())
      .post('/transcripts')
      .send({ content })
      .expect(201);

    // Wait for the first submission to finish
    await poll(
      async () => {
        const { body } = await request(app.getHttpServer())
          .get(`/transcripts/${duplicate.id}`)
          .expect(200);
        return body as { status: string };
      },
      (b) => b.status === 'completed' || b.status === 'failed',
    );

    // OpenAI should only have been called once (the second POST returns existing record)
    expect(mockOpenAiClient.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});
