import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CatMemoryDto } from './dto/cat-memory.dto';
import { GrepMemoriesDto } from './dto/grep-memories.dto';
import { ListMemoriesDto } from './dto/list-memories.dto';
import {
  CatMemoryResponse,
  GrepResponse,
  ListMemoriesResponse,
  MemoryBrowserService,
} from './memory-browser.service';

@ApiTags('memories')
@Controller('memories')
export class MemoryBrowserController {
  constructor(private readonly memoryBrowserService: MemoryBrowserService) {}

  @ApiOperation({
    summary: 'List memory files and directories (ls)',
    description:
      'Returns a flat listing of files and sub-directory prefixes under the given path. ' +
      'Equivalent to running `aws s3 ls s3://memories/<path>`. ' +
      'Omit `path` to list the root of the bucket.',
  })
  @ApiQuery({
    name: 'path',
    required: false,
    description: 'Directory prefix to list. Omit to list the root.',
    example: 'people/',
  })
  @ApiOkResponse({
    description: 'Directory listing',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', example: 'people/' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', example: 'people/alice-johnson.md' },
              type: {
                type: 'string',
                enum: ['file', 'directory'],
                example: 'file',
              },
            },
          },
          example: [
            { key: 'people/alice-johnson.md', type: 'file' },
            { key: 'people/bob-smith.md', type: 'file' },
          ],
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Unknown query parameter supplied' })
  @Get()
  list(@Query() query: ListMemoriesDto): Promise<ListMemoriesResponse> {
    return this.memoryBrowserService.list(query.path);
  }

  @ApiOperation({
    summary: 'Return the raw content of a memory file (cat)',
    description:
      'Fetches and returns the full markdown content of a single memory file from MinIO. ' +
      'Use GET /memories to discover available file paths.',
  })
  @ApiQuery({
    name: 'path',
    required: true,
    description: 'Full S3 key of the memory file to read.',
    example: 'people/alice-johnson.md',
  })
  @ApiOkResponse({
    description: 'File content returned as a UTF-8 string',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', example: 'people/alice-johnson.md' },
        content: {
          type: 'string',
          example:
            '# Alice Johnson\n\n**Role**: Engineer\n\n## Updates\n\n### 2026-06-07\n- Led the Q3 backend redesign discussion\n',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'No file exists at the given path' })
  @ApiBadRequestResponse({
    description: 'path is missing or an unknown query parameter was supplied',
  })
  @Get('cat')
  cat(@Query() query: CatMemoryDto): Promise<CatMemoryResponse> {
    return this.memoryBrowserService.cat(query.path);
  }

  @ApiOperation({
    summary: 'Search memory files by regex (grep)',
    description:
      'Lists all object keys under the optional path prefix, fetches each file, ' +
      'and returns the subset that contain a line matching the supplied JavaScript regex. ' +
      'Each match includes up to one surrounding context line. ' +
      'The regex is applied case-insensitively.',
  })
  @ApiQuery({
    name: 'pattern',
    required: true,
    description: 'JavaScript-compatible regex, applied case-insensitively.',
    example: 'backend engineer',
  })
  @ApiQuery({
    name: 'path',
    required: false,
    description: 'Prefix that limits which files are searched.',
    example: 'people/',
  })
  @ApiOkResponse({
    description:
      'Matching files with line excerpts (±1 context line per match)',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', example: 'backend engineer' },
        path: { type: 'string', example: 'people/' },
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', example: 'people/alice-johnson.md' },
              excerpts: {
                type: 'array',
                items: { type: 'string' },
                example: [
                  '**Role**: Engineer\n- Led the backend redesign\n- Proposed microservices migration',
                ],
              },
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'pattern is missing, empty, or not a valid JavaScript regex',
  })
  @Get('grep')
  grep(@Query() query: GrepMemoriesDto): Promise<GrepResponse> {
    return this.memoryBrowserService.grep(query.pattern, query.path);
  }
}
