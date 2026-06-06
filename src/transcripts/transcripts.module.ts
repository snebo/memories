import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TRANSCRIPT_QUEUE } from './queues/transcript.queue';
import { TranscriptsController } from './transcripts.controller';
import { TranscriptsService } from './transcripts.service';

@Module({
  imports: [BullModule.registerQueue({ name: TRANSCRIPT_QUEUE })],
  controllers: [TranscriptsController],
  providers: [TranscriptsService],
})
export class TranscriptsModule {}
