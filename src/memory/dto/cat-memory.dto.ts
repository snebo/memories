import { IsNotEmpty, IsString } from 'class-validator';

export class CatMemoryDto {
  @IsString()
  @IsNotEmpty()
  path: string;
}
