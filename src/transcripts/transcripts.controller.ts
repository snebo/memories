import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Transcript } from '@prisma/generated';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { TranscriptsService } from './transcripts.service';

@ApiTags('transcripts')
@Controller('transcripts')
export class TranscriptsController {
  constructor(private readonly transcriptsService: TranscriptsService) {}

  @ApiOperation({
    summary: 'Ingest a transcript for memory extraction',
    description:
      'Accepts raw transcript text, deduplicates by content hash, persists it, and enqueues an async LLM extraction job. ' +
      'If the same content has been submitted before, returns the existing record immediately. ' +
      'Poll GET /transcripts/:id until status is "completed" to confirm processing.',
  })
  @ApiCreatedResponse({
    description: 'Transcript accepted. Extraction job enqueued.',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        },
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed'],
          example: 'pending',
        },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed — content is missing or not a string',
  })
  @Post()
  async create(
    @Body() dto: CreateTranscriptDto,
  ): Promise<Pick<Transcript, 'id' | 'status'>> {
    const transcript = await this.transcriptsService.create(dto);
    return { id: transcript.id, status: transcript.status };
  }

  @ApiOperation({
    summary: 'Retrieve a transcript by ID',
    description:
      'Returns the full transcript record including its processing status. ' +
      'Status values: pending → processing → completed | failed.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID of the transcript returned by POST /transcripts',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @ApiOkResponse({
    description: 'Transcript record with current status',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        },
        content: {
          type: 'string',
          example: 'Alice discussed the Q3 backend redesign...',
        },
        contentHash: { type: 'string', example: 'a1b2c3d4...' },
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed'],
          example: 'completed',
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-06-07T09:00:00.000Z',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No transcript with that ID exists' })
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Transcript> {
    return this.transcriptsService.findOne(id);
  }
}
