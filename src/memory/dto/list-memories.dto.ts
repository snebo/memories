import { IsOptional, IsString } from 'class-validator';

export class ListMemoriesDto {
  @IsOptional()
  @IsString()
  path?: string;
}
