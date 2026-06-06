import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TRANSCRIPT_QUEUE, TranscriptJobPayload } from './transcript.queue';

@Processor(TRANSCRIPT_QUEUE)
export class TranscriptProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptProcessor.name);

  async process(job: Job<TranscriptJobPayload>): Promise<void> {
    this.logger.log(`Processing transcript job ${job.data.transcriptId}`);
  }
}
