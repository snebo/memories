import { Controller, Get, Query } from '@nestjs/common';
import { CatMemoryDto } from './dto/cat-memory.dto';
import { GrepMemoriesDto } from './dto/grep-memories.dto';
import { ListMemoriesDto } from './dto/list-memories.dto';
import {
  CatMemoryResponse,
  GrepResponse,
  ListMemoriesResponse,
  MemoryBrowserService,
} from './memory-browser.service';

@Controller('memories')
export class MemoryBrowserController {
  constructor(private readonly memoryBrowserService: MemoryBrowserService) {}

  @Get()
  list(@Query() query: ListMemoriesDto): Promise<ListMemoriesResponse> {
    return this.memoryBrowserService.list(query.path);
  }

  @Get('cat')
  cat(@Query() query: CatMemoryDto): Promise<CatMemoryResponse> {
    return this.memoryBrowserService.cat(query.path);
  }

  @Get('grep')
  grep(@Query() query: GrepMemoriesDto): Promise<GrepResponse> {
    return this.memoryBrowserService.grep(query.pattern, query.path);
  }
}
