import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import OpenAI from 'openai';
import { TRANSCRIPT_QUEUE } from '../transcripts/queues/transcript.queue';
import { LlmService, OPENAI_CLIENT } from './llm.service';
import { MemoryBrowserController } from './memory-browser.controller';
import { MemoryBrowserService } from './memory-browser.service';
import { MemoryProcessorService } from './memory-processor.service';
import { MemoryWriterService } from './memory-writer.service';
import { S3_CLIENT, StorageService } from './storage.service';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: TRANSCRIPT_QUEUE }),
  ],
  controllers: [MemoryBrowserController],
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new S3Client({
          endpoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
          region: 'us-east-1',
          credentials: {
            accessKeyId: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
            secretAccessKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
          },
          forcePathStyle: true,
        }),
    },
    {
      provide: OPENAI_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new OpenAI({ apiKey: config.getOrThrow<string>('OPENAI_API_KEY') }),
    },
    StorageService,
    LlmService,
    MemoryWriterService,
    MemoryProcessorService,
    MemoryBrowserService,
  ],
})
export class MemoryModule {}
