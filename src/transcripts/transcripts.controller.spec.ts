import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { TranscriptsController } from './transcripts.controller';
import { TranscriptsService } from './transcripts.service';
import { Transcript } from '@prisma/generated';

const mockTranscriptsService = () => ({
  create: jest.fn(),
  findOne: jest.fn(),
});

const makeTranscript = (overrides: Partial<Transcript> = {}): Transcript => ({
  id: 'uuid-1',
  content: 'hello world',
  contentHash: 'abc123',
  status: 'pending',
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

describe('TranscriptsController (integration)', () => {
  let app: INestApplication;
  let service: ReturnType<typeof mockTranscriptsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TranscriptsController],
      providers: [
        { provide: TranscriptsService, useFactory: mockTranscriptsService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    service = module.get(TranscriptsService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /transcripts', () => {
    it('returns 201 with id and status when content is valid', async () => {
      const transcript = makeTranscript();
      (service.create as jest.Mock).mockResolvedValue(transcript);

      const { body } = await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content: 'hello world' })
        .expect(201);

      expect(body).toEqual({ id: transcript.id, status: transcript.status });
      expect(service.create).toHaveBeenCalledWith({ content: 'hello world' });
    });

    it('returns 400 when content is empty', async () => {
      await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content: '' })
        .expect(400);
    });

    it('returns 400 when content is missing', async () => {
      await request(app.getHttpServer())
        .post('/transcripts')
        .send({})
        .expect(400);
    });

    it('returns 400 when content is not a string', async () => {
      await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content: 42 })
        .expect(400);
    });

    it('returns 400 when unknown fields are sent', async () => {
      (service.create as jest.Mock).mockResolvedValue(makeTranscript());
      await request(app.getHttpServer())
        .post('/transcripts')
        .send({ content: 'valid', unknownField: 'x' })
        .expect(400);
    });
  });

  describe('GET /transcripts/:id', () => {
    it('returns 200 with the full transcript when found', async () => {
      const transcript = makeTranscript();
      (service.findOne as jest.Mock).mockResolvedValue(transcript);

      const { body } = await request(app.getHttpServer())
        .get('/transcripts/uuid-1')
        .expect(200);

      expect(body.id).toBe(transcript.id);
      expect(body.status).toBe(transcript.status);
      expect(service.findOne).toHaveBeenCalledWith('uuid-1');
    });

    it('returns 404 when transcript does not exist', async () => {
      (service.findOne as jest.Mock).mockRejectedValue(
        new NotFoundException('Transcript uuid-x not found'),
      );

      await request(app.getHttpServer()).get('/transcripts/uuid-x').expect(404);
    });
  });
});
