import { Test, TestingModule } from '@nestjs/testing';
import { Transcript } from '@prisma/generated';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from './llm.service';
import { MemoryProcessorService } from './memory-processor.service';
import { MemoryWriterService } from './memory-writer.service';
import { ExtractedMemories } from './types/extracted-memories.types';

const mockPrismaService = () => ({
  transcript: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
});

const mockLlmService = () => ({
  extractMemories: jest.fn(),
});

const mockMemoryWriterService = () => ({
  writeMemories: jest.fn(),
});

const makeTranscript = (overrides: Partial<Transcript> = {}): Transcript => ({
  id: 'uuid-1',
  content: 'Alice discussed the backend redesign.',
  contentHash: 'abc123',
  status: 'pending',
  createdAt: new Date('2026-06-06'),
  ...overrides,
});

const makeJob = (transcriptId = 'uuid-1') =>
  ({ data: { transcriptId } }) as Job<{ transcriptId: string }>;

const makeMemories = (): ExtractedMemories => ({
  entities: { people: [], companies: [], locations: [] },
  topics: [],
  facts: [],
  sentiment: { overall: 'neutral', score: 0, notes: '' },
  timeline: [],
});

describe('MemoryProcessorService', () => {
  let service: MemoryProcessorService;
  let prisma: ReturnType<typeof mockPrismaService>;
  let llm: ReturnType<typeof mockLlmService>;
  let writer: ReturnType<typeof mockMemoryWriterService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryProcessorService,
        { provide: PrismaService, useFactory: mockPrismaService },
        { provide: LlmService, useFactory: mockLlmService },
        { provide: MemoryWriterService, useFactory: mockMemoryWriterService },
      ],
    }).compile();

    service = module.get(MemoryProcessorService);
    prisma = module.get(PrismaService);
    llm = module.get(LlmService);
    writer = module.get(MemoryWriterService);
  });

  describe('process (happy path)', () => {
    it('claims the transcript, extracts memories, writes files, and marks completed', async () => {
      const transcript = makeTranscript();
      const memories = makeMemories();

      prisma.transcript.updateMany.mockResolvedValue({
        count: 1,
      });
      prisma.transcript.findUnique.mockResolvedValue(transcript);
      llm.extractMemories.mockResolvedValue(memories);
      writer.writeMemories.mockResolvedValue(undefined);
      prisma.transcript.update.mockResolvedValue({});

      await service.process(makeJob());

      expect(prisma.transcript.updateMany).toHaveBeenCalledWith({
        where: { id: 'uuid-1', status: { in: ['pending', 'failed'] } },
        data: { status: 'processing' },
      });
      expect(prisma.transcript.findUnique).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
      expect(llm.extractMemories).toHaveBeenCalledWith(transcript.content);
      expect(writer.writeMemories).toHaveBeenCalledWith(
        memories,
        expect.any(String),
      );
      expect(prisma.transcript.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { status: 'completed' },
      });
    });
  });

  describe('process (idempotency — Layer 2)', () => {
    it('skips all work when CAS returns count 0 (already processing or completed)', async () => {
      prisma.transcript.updateMany.mockResolvedValue({ count: 0 });

      await service.process(makeJob());

      expect(prisma.transcript.findUnique).not.toHaveBeenCalled();
      expect(llm.extractMemories).not.toHaveBeenCalled();
      expect(writer.writeMemories).not.toHaveBeenCalled();
    });
  });

  describe('process (BullMQ retry after failure)', () => {
    it('re-claims a failed transcript on a BullMQ retry attempt', async () => {
      // Simulate: first attempt failed → status is now 'failed' → BullMQ retries
      // The CAS must accept status 'failed' so the retry can proceed.
      const transcript = makeTranscript({ status: 'failed' });
      const memories = makeMemories();

      prisma.transcript.updateMany.mockResolvedValue({ count: 1 });
      prisma.transcript.findUnique.mockResolvedValue(transcript);
      llm.extractMemories.mockResolvedValue(memories);
      writer.writeMemories.mockResolvedValue(undefined);
      prisma.transcript.update.mockResolvedValue({});

      await service.process(makeJob());

      expect(prisma.transcript.updateMany).toHaveBeenCalledWith({
        where: { id: 'uuid-1', status: { in: ['pending', 'failed'] } },
        data: { status: 'processing' },
      });
      expect(llm.extractMemories).toHaveBeenCalled();
      expect(prisma.transcript.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { status: 'completed' },
      });
    });

    it('does not re-claim a transcript that is currently processing (concurrent guard)', async () => {
      // status: 'processing' → CAS returns 0 → skip (another worker has it)
      prisma.transcript.updateMany.mockResolvedValue({ count: 0 });

      await service.process(makeJob());

      expect(llm.extractMemories).not.toHaveBeenCalled();
    });

    it('does not re-claim a completed transcript', async () => {
      // status: 'completed' → CAS returns 0 → skip
      prisma.transcript.updateMany.mockResolvedValue({ count: 0 });

      await service.process(makeJob());

      expect(llm.extractMemories).not.toHaveBeenCalled();
    });
  });

  describe('process (failure handling)', () => {
    it('marks transcript as failed and rethrows when LLM throws (allowing BullMQ retry)', async () => {
      prisma.transcript.updateMany.mockResolvedValue({
        count: 1,
      });
      prisma.transcript.findUnique.mockResolvedValue(makeTranscript());
      llm.extractMemories.mockRejectedValue(new Error('rate limit'));
      prisma.transcript.update.mockResolvedValue({});

      await expect(service.process(makeJob())).rejects.toThrow('rate limit');

      expect(prisma.transcript.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { status: 'failed' },
      });
    });

    it('marks transcript as failed and rethrows when storage write throws', async () => {
      prisma.transcript.updateMany.mockResolvedValue({
        count: 1,
      });
      prisma.transcript.findUnique.mockResolvedValue(makeTranscript());
      llm.extractMemories.mockResolvedValue(makeMemories());
      writer.writeMemories.mockRejectedValue(new Error('S3 unavailable'));
      prisma.transcript.update.mockResolvedValue({});

      await expect(service.process(makeJob())).rejects.toThrow(
        'S3 unavailable',
      );

      expect(prisma.transcript.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { status: 'failed' },
      });
    });

    it('throws when transcript is not found after claiming', async () => {
      prisma.transcript.updateMany.mockResolvedValue({
        count: 1,
      });
      prisma.transcript.findUnique.mockResolvedValue(null);
      prisma.transcript.update.mockResolvedValue({});

      await expect(service.process(makeJob())).rejects.toThrow(/not found/);
    });
  });
});
