import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CatMemoryDto {
  /**
   * Full S3 object key of the memory file to read.
   * Use GET /memories to discover available paths.
   */
  @ApiProperty({
    description:
      'Full S3 key of the memory file to return. Use GET /memories to discover available paths.',
    example: 'people/alice-johnson.md',
  })
  @IsString()
  @IsNotEmpty()
  path: string;
}
