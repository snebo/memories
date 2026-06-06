import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Transcript } from '@prisma/generated';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { TRANSCRIPT_QUEUE } from './queues/transcript.queue';
import { TranscriptsService } from './transcripts.service';

const mockPrismaService = () => ({
  transcript: {
    create: jest.fn(),
    findUnique: jest.fn(),
  },
});

const mockQueue = () => ({
  add: jest.fn(),
});

const makeTranscript = (overrides: Partial<Transcript> = {}): Transcript => ({
  id: 'uuid-1',
  content: 'hello world',
  contentHash: 'abc123',
  status: 'pending',
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

describe('TranscriptsService', () => {
  let service: TranscriptsService;
  let prisma: ReturnType<typeof mockPrismaService>;
  let queue: ReturnType<typeof mockQueue>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptsService,
        { provide: PrismaService, useFactory: mockPrismaService },
        { provide: getQueueToken(TRANSCRIPT_QUEUE), useFactory: mockQueue },
      ],
    }).compile();

    service = module.get(TranscriptsService);
    prisma = module.get(PrismaService);
    queue = module.get(getQueueToken(TRANSCRIPT_QUEUE));
  });

  describe('computeContentHash', () => {
    it('returns a 64-character hex SHA-256 digest', () => {
      const hash = service.computeContentHash('hello');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('produces the same hash for the same input', () => {
      const content = 'deterministic input';
      expect(service.computeContentHash(content)).toBe(
        service.computeContentHash(content),
      );
    });

    it('produces different hashes for different inputs', () => {
      expect(service.computeContentHash('a')).not.toBe(
        service.computeContentHash('b'),
      );
    });
  });

  describe('persistTranscript', () => {
    it('calls prisma.transcript.create with content and hash', async () => {
      const dto: CreateTranscriptDto = { content: 'test' };
      const hash = 'deadbeef';
      const transcript = makeTranscript({
        content: dto.content,
        contentHash: hash,
      });

      prisma.transcript.create.mockResolvedValue(transcript);

      const result = await service.persistTranscript(dto, hash);

      expect(prisma.transcript.create).toHaveBeenCalledWith({
        data: { content: dto.content, contentHash: hash },
      });
      expect(result).toStrictEqual(transcript);
    });
  });

  describe('enqueueTranscriptJob', () => {
    it('adds a "process" job with jobId, retry attempts, and exponential backoff', async () => {
      queue.add.mockResolvedValue({});

      await service.enqueueTranscriptJob('uuid-1');

      expect(queue.add).toHaveBeenCalledWith(
        'process',
        { transcriptId: 'uuid-1' },
        expect.objectContaining({
          jobId: 'uuid-1',
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        }),
      );
    });
  });

  describe('create', () => {
    it('returns existing transcript without enqueuing when hash already exists', async () => {
      const dto: CreateTranscriptDto = { content: 'hello' };
      const existing = makeTranscript({ status: 'completed' });

      jest.spyOn(service, 'computeContentHash').mockReturnValue('abc123');
      jest.spyOn(service, 'findByContentHash').mockResolvedValue(existing);
      jest.spyOn(service, 'persistTranscript');
      jest.spyOn(service, 'enqueueTranscriptJob');

      const result = await service.create(dto);

      expect(service.findByContentHash).toHaveBeenCalledWith('abc123');
      expect(service.persistTranscript).not.toHaveBeenCalled();
      expect(service.enqueueTranscriptJob).not.toHaveBeenCalled();
      expect(result).toStrictEqual(existing);
    });

    it('hashes, persists, enqueues with jobId, and returns new transcript', async () => {
      const dto: CreateTranscriptDto = { content: 'hello' };
      const transcript = makeTranscript();

      jest.spyOn(service, 'computeContentHash').mockReturnValue('abc123');
      jest.spyOn(service, 'findByContentHash').mockResolvedValue(null);
      jest.spyOn(service, 'persistTranscript').mockResolvedValue(transcript);
      jest.spyOn(service, 'enqueueTranscriptJob').mockResolvedValue();

      const result = await service.create(dto);

      expect(service.persistTranscript).toHaveBeenCalledWith(dto, 'abc123');
      expect(service.enqueueTranscriptJob).toHaveBeenCalledWith(transcript.id);
      expect(result).toStrictEqual(transcript);
    });

    it('still returns transcript when queue is unavailable', async () => {
      const dto: CreateTranscriptDto = { content: 'hello' };
      const transcript = makeTranscript();

      jest.spyOn(service, 'computeContentHash').mockReturnValue('abc123');
      jest.spyOn(service, 'findByContentHash').mockResolvedValue(null);
      jest.spyOn(service, 'persistTranscript').mockResolvedValue(transcript);
      jest
        .spyOn(service, 'enqueueTranscriptJob')
        .mockRejectedValue(new Error('Redis down'));

      const result = await service.create(dto);
      await Promise.resolve();

      expect(result).toStrictEqual(transcript);
    });
  });

  describe('findOne', () => {
    it('returns the transcript when found', async () => {
      const transcript = makeTranscript();
      prisma.transcript.findUnique.mockResolvedValue(transcript);

      const result = await service.findOne('uuid-1');

      expect(prisma.transcript.findUnique).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
      expect(result).toStrictEqual(transcript);
    });

    it('throws NotFoundException when transcript does not exist', async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('missing-id')).rejects.toThrow('missing-id');
    });
  });
});
