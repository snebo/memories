import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GrepMemoriesDto {
  @IsString()
  @IsNotEmpty()
  pattern: string;

  @IsOptional()
  @IsString()
  path?: string;
}
