/**
 * Integration tests for the memory browser endpoints.
 *
 * Prerequisites: Docker Compose stack must be running.
 *   docker compose up -d minio
 *
 * A dedicated integration test bucket (memories-integration-test) is created
 * automatically and wiped before each test so these tests are fully isolated
 * from the development bucket.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { OPENAI_CLIENT } from '../../src/memory/llm.service';
import { S3_CLIENT, StorageService } from '../../src/memory/storage.service';

// Use a dedicated bucket so these tests never touch the dev bucket.
process.env['MINIO_BUCKET'] = 'memories-integration-test';

const mockOpenAiClient = {
  chat: { completions: { create: jest.fn() } },
};

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

describe('Memory Browser Endpoints (Integration)', () => {
  let app: INestApplication;
  let storage: StorageService;
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

    storage = moduleFixture.get(StorageService);
    s3 = moduleFixture.get<S3Client>(S3_CLIENT);
  });

  afterAll(async () => {
    await emptyBucket(s3, 'memories-integration-test');
    await app.close();
  });

  beforeEach(async () => {
    await emptyBucket(s3, 'memories-integration-test');

    // Seed test fixtures
    await storage.writeFile(
      'people/alice-johnson.md',
      '# Alice Johnson\n\n**Role**: Engineer\n\n## Updates\n\n### 2026-06-07\n- Led the backend redesign\n',
    );
    await storage.writeFile(
      'people/bob-smith.md',
      '# Bob Smith\n\n**Role**: Frontend Engineer\n\n## Updates\n\n### 2026-06-07\n- Raised timeline concerns\n',
    );
    await storage.writeFile(
      'topics/backend-redesign.md',
      '# Backend Redesign\n\n## Updates\n\n### 2026-06-07\n**Summary**: Moving to microservices\n\n**Key Points**:\n- Use event-driven architecture\n- Auth service first\n',
    );
    await storage.writeFile(
      'entities/companies/acme-corp.md',
      '# Acme Corp\n\n## Updates\n\n### 2026-06-07\n- Primary employer of Alice\n',
    );
  });

  describe('GET /memories', () => {
    it('lists top-level directories at the root', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories')
        .expect(200);

      expect(body.path).toBe('');
      const keys = body.entries.map((e: { key: string }) => e.key);
      expect(keys).toContain('entities/');
      expect(keys).toContain('people/');
      expect(keys).toContain('topics/');
    });

    it('lists files under a specific path prefix', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories')
        .query({ path: 'people/' })
        .expect(200);

      expect(body.path).toBe('people/');
      const keys = body.entries.map((e: { key: string }) => e.key);
      expect(keys).toContain('people/alice-johnson.md');
      expect(keys).toContain('people/bob-smith.md');
      const types = body.entries.map((e: { type: string }) => e.type);
      expect(types.every((t: string) => t === 'file')).toBe(true);
    });

    it('returns an empty entries array for a non-existent prefix', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories')
        .query({ path: 'nonexistent/' })
        .expect(200);

      expect(body.entries).toEqual([]);
    });

    it('returns 400 when an unknown query param is sent', async () => {
      await request(app.getHttpServer())
        .get('/memories')
        .query({ path: 'people/', unknown: 'x' })
        .expect(400);
    });
  });

  describe('GET /memories/cat', () => {
    it('returns the full content of an existing file', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories/cat')
        .query({ path: 'people/alice-johnson.md' })
        .expect(200);

      expect(body.path).toBe('people/alice-johnson.md');
      expect(body.content).toContain('# Alice Johnson');
      expect(body.content).toContain('Led the backend redesign');
    });

    it('returns 404 for a file that does not exist', async () => {
      await request(app.getHttpServer())
        .get('/memories/cat')
        .query({ path: 'people/ghost.md' })
        .expect(404);
    });

    it('returns 400 when path is omitted', async () => {
      await request(app.getHttpServer()).get('/memories/cat').expect(400);
    });
  });

  describe('GET /memories/grep', () => {
    it('returns files containing the pattern with line excerpts', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'backend' })
        .expect(200);

      expect(body.pattern).toBe('backend');
      expect(body.matches.length).toBeGreaterThanOrEqual(2);
      const files = body.matches.map((m: { file: string }) => m.file);
      expect(files).toContain('people/alice-johnson.md');
      expect(files).toContain('topics/backend-redesign.md');
    });

    it('matches case-insensitively', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'ALICE' })
        .expect(200);

      const files = body.matches.map((m: { file: string }) => m.file);
      expect(files).toContain('people/alice-johnson.md');
    });

    it('restricts search to the given path prefix', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'engineer', path: 'people/' })
        .expect(200);

      const files = body.matches.map((m: { file: string }) => m.file);
      expect(files.every((f: string) => f.startsWith('people/'))).toBe(true);
    });

    it('returns empty matches when pattern does not match anything', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'xyzzy-no-match-anywhere' })
        .expect(200);

      expect(body.matches).toEqual([]);
    });

    it('returns 400 for an invalid regex', async () => {
      await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: '[unclosed' })
        .expect(400);
    });

    it('returns 400 when pattern is omitted', async () => {
      await request(app.getHttpServer()).get('/memories/grep').expect(400);
    });

    it('each match includes line excerpts that contain the matching text', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'microservices' })
        .expect(200);

      expect(body.matches).toHaveLength(1);
      const allExcerpts: string[] = body.matches.flatMap(
        (m: { excerpts: string[] }) => m.excerpts,
      );
      expect(allExcerpts.some((e) => /microservices/i.test(e))).toBe(true);
    });
  });
});
