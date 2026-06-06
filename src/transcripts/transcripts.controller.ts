import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Transcript } from '@prisma/generated';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { TranscriptsService } from './transcripts.service';

@Controller('transcripts')
export class TranscriptsController {
  constructor(private readonly transcriptsService: TranscriptsService) {}

  @Post()
  async create(
    @Body() dto: CreateTranscriptDto,
  ): Promise<Pick<Transcript, 'id' | 'status'>> {
    const transcript = await this.transcriptsService.create(dto);
    return { id: transcript.id, status: transcript.status };
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Transcript> {
    return this.transcriptsService.findOne(id);
  }
}
