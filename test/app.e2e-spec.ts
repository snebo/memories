/**
 * Smoke test — verifies the application bootstraps successfully.
 * The meaningful E2E flow is in transcript-to-memory.e2e-spec.ts.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OPENAI_CLIENT } from '../src/memory/llm.service';

const mockOpenAiClient = {
  chat: { completions: { create: jest.fn() } },
};

describe('Application bootstrap (E2E smoke)', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /transcripts returns 400 for missing body (app is healthy)', async () => {
    await request(app.getHttpServer())
      .post('/transcripts')
      .send({})
      .expect(400);
  });

  it('GET /memories returns 200 (app is healthy)', async () => {
    await request(app.getHttpServer()).get('/memories').expect(200);
  });
});
