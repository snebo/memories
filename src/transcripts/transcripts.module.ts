import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TRANSCRIPT_QUEUE } from './queues/transcript.queue';
import { TranscriptProcessor } from './queues/transcript.processor';
import { TranscriptsController } from './transcripts.controller';
import { TranscriptsService } from './transcripts.service';

@Module({
  imports: [BullModule.registerQueue({ name: TRANSCRIPT_QUEUE })],
  controllers: [TranscriptsController],
  providers: [TranscriptsService, TranscriptProcessor],
})
export class TranscriptsModule {}
