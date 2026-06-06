import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { Transcript } from '@prisma/generated';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import {
  TRANSCRIPT_QUEUE,
  TranscriptJobPayload,
} from './queues/transcript.queue';

@Injectable()
export class TranscriptsService {
  private readonly logger = new Logger(TranscriptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TRANSCRIPT_QUEUE)
    private readonly queue: Queue<TranscriptJobPayload>,
  ) {}
  // helper function to hash transcript to help with idempotency
  computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async persistTranscript(
    dto: CreateTranscriptDto,
    contentHash: string,
  ): Promise<Transcript> {
    return this.prisma.transcript.create({
      data: { content: dto.content, contentHash },
    });
  }

  async enqueueTranscriptJob(transcriptId: string): Promise<void> {
    await this.queue.add('process', { transcriptId });
  }

  async create(dto: CreateTranscriptDto): Promise<Transcript> {
    const contentHash = this.computeContentHash(dto.content);
    const transcript = await this.persistTranscript(dto, contentHash);
    this.enqueueTranscriptJob(transcript.id).catch((err: unknown) =>
      this.logger.error('Failed to enqueue transcript job', err),
    );
    return transcript;
  }

  async findOne(id: string): Promise<Transcript> {
    const transcript = await this.prisma.transcript.findUnique({
      where: { id },
    });
    if (!transcript) {
      throw new NotFoundException(`Transcript ${id} not found`);
    }
    return transcript;
  }
}
