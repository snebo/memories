import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTranscriptDto {
  /**
   * The full text of the conversation or meeting transcript to be processed.
   * The system computes a SHA-256 hash to deduplicate identical submissions.
   */
  @ApiProperty({
    description:
      'Raw transcript text to be processed. Duplicate submissions (same content) return the existing record.',
    example:
      'Alice discussed the Q3 backend redesign with the team. She proposed moving to a microservices architecture, starting with the authentication service. Bob agreed but raised concerns about the migration timeline.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;
}
