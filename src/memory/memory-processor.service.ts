import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSCRIPT_QUEUE } from '../transcripts/queues/transcript.queue';
import { LlmService } from './llm.service';
import { MemoryWriterService } from './memory-writer.service';

@Processor(TRANSCRIPT_QUEUE)
export class MemoryProcessorService extends WorkerHost {
  private readonly logger = new Logger(MemoryProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly writer: MemoryWriterService,
  ) {
    super();
  }

  async process(job: Job<{ transcriptId: string }>): Promise<void> {
    const { transcriptId } = job.data;

    const claimed = await this.claimTranscript(transcriptId);
    if (!claimed) {
      this.logger.warn(`Transcript ${transcriptId} already claimed — skipping`);
      return;
    }

    try {
      await this.processTranscript(transcriptId);
    } catch (err: unknown) {
      await this.markFailed(transcriptId);
      throw err;
    }
  }

  private async claimTranscript(transcriptId: string): Promise<boolean> {
    const result = await this.prisma.transcript.updateMany({
      where: { id: transcriptId, status: 'pending' },
      data: { status: 'processing' },
    });
    return result.count > 0;
  }

  private async processTranscript(transcriptId: string): Promise<void> {
    const transcript = await this.prisma.transcript.findUnique({
      where: { id: transcriptId },
    });

    if (!transcript) {
      throw new Error(`Transcript ${transcriptId} not found after claiming`);
    }

    const date = transcript.createdAt.toISOString().slice(0, 10);
    const memories = await this.llm.extractMemories(transcript.content);
    await this.writer.writeMemories(memories, date);

    await this.prisma.transcript.update({
      where: { id: transcriptId },
      data: { status: 'completed' },
    });

    this.logger.log(`Transcript ${transcriptId} processed successfully`);
  }

  private async markFailed(transcriptId: string): Promise<void> {
    await this.prisma.transcript.update({
      where: { id: transcriptId },
      data: { status: 'failed' },
    });
  }
}
