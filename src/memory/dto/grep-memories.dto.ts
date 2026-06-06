import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GrepMemoriesDto {
  /**
   * JavaScript-compatible regular expression used to match lines across all
   * memory files. Applied case-insensitively.
   */
  @ApiProperty({
    description:
      'JavaScript-compatible regex applied case-insensitively across all memory files under the given path prefix.',
    example: 'backend engineer',
  })
  @IsString()
  @IsNotEmpty()
  pattern: string;

  /**
   * Narrows the search to keys under this prefix. Omit to search all files.
   */
  @ApiProperty({
    required: false,
    description:
      'Prefix that limits which files are searched. Omit to search all memory files.',
    example: 'people/',
  })
  @IsOptional()
  @IsString()
  path?: string;
}
