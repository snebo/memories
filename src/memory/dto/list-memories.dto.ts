import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListMemoriesDto {
  /**
   * Directory prefix to list. Omit to list the root.
   * Trailing slash is optional — the service normalises it.
   */
  @ApiProperty({
    required: false,
    description:
      'Directory prefix to list. Omit to list the root. Trailing slash is optional.',
    example: 'people/',
  })
  @IsOptional()
  @IsString()
  path?: string;
}
