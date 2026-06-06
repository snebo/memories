import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTranscriptDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
