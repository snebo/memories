/**
 * Integration tests for the transcript ingest flow.
 *
 * Prerequisites: Docker Compose stack must be running.
 *   docker compose up -d postgres redis minio
 *
 * These tests use the real PostgreSQL database and Redis queue.
 * OpenAI is mocked so no API calls are made.
 * The tests clean up all created transcripts after each run.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { LLM_CLIENT } from '../../src/memory/llm-client.interface';
import { PrismaService } from '../../src/prisma/prisma.service';

const mockLlmClient = { complete: jest.fn() };

describe('Transcript Ingest Flow (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_CLIENT)
      .useValue(mockLlmClient)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.transcript.deleteMany();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.transcript.deleteMany();
  });

  describe('POST /transcripts', () => {
    it('persists a new transcript with status pending', async () => {
      const content = 'Alice led the Q3 backend redesign discussion.';

      const { body } = await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content })
        .expect(201);

      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');

      const record = await prisma.transcript.findUnique({
        where: { id: body.id },
      });
      expect(record).not.toBeNull();
      expect(record!.content).toBe(content);
      expect(record!.status).toBe('pending');
    });

    it('returns the same record for duplicate content (idempotency)', async () => {
      const content = `Idempotency test transcript ${Date.now()}`;

      const { body: first } = await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content })
        .expect(201);

      const { body: second } = await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content })
        .expect(201);

      expect(first.id).toBe(second.id);

      const count = await prisma.transcript.count({
        where: { content },
      });
      expect(count).toBe(1);
    });

    it('stores different content as separate records', async () => {
      const { body: a } = await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content: 'First unique transcript content A' })
        .expect(201);

      const { body: b } = await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content: 'Second unique transcript content B' })
        .expect(201);

      expect(a.id).not.toBe(b.id);
      expect(await prisma.transcript.count()).toBe(2);
    });

    it('returns 400 when content is missing', async () => {
      await request(app.getHttpServer())
        .post('/transcripts')
        .send({})
        .expect(400);
    });

    it('returns 400 when content is an empty string', async () => {
      await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content: '' })
        .expect(400);
    });

    it('returns 400 when unknown fields are supplied', async () => {
      await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content: 'valid content', extra: 'nope' })
        .expect(400);
    });
  });

  describe('GET /transcripts/:id', () => {
    it('returns the full transcript record by ID', async () => {
      const content = 'Readable transcript content.';
      const { body: created } = await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content })
        .expect(201);

      const { body } = await request(app.getHttpServer())
        .get(`/transcripts/${created.id}`)
        .expect(200);

      expect(body.id).toBe(created.id);
      expect(body.content).toBe(content);
      expect(body.status).toBe('pending');
      expect(body.createdAt).toBeDefined();
    });

    it('returns 404 for a non-existent ID', async () => {
      await request(app.getHttpServer())
        .get('/transcripts/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
