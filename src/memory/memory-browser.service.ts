import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StorageEntry, StorageService } from './storage.service';

export interface ListMemoriesResponse {
  readonly path: string;
  readonly entries: StorageEntry[];
}

export interface CatMemoryResponse {
  readonly path: string;
  readonly content: string;
}

export interface GrepMatch {
  readonly file: string;
  readonly excerpts: string[];
}

export interface GrepResponse {
  readonly pattern: string;
  readonly path: string;
  readonly matches: GrepMatch[];
}

@Injectable()
export class MemoryBrowserService {
  constructor(private readonly storage: StorageService) {}

  async list(path?: string): Promise<ListMemoriesResponse> {
    const entries = await this.storage.listFiles(path);
    return { path: path ?? '', entries };
  }

  async cat(path: string): Promise<CatMemoryResponse> {
    const content = await this.storage.readFile(path);
    if (content === null) {
      throw new NotFoundException(`File not found: ${path}`);
    }
    return { path, content };
  }

  async grep(pattern: string, path?: string): Promise<GrepResponse> {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch {
      throw new BadRequestException(`Invalid regex pattern: ${pattern}`);
    }

    const keys = await this.storage.listAllFiles(path);

    const matchResults = await Promise.all(
      keys.map((key) => this.matchFile(key, regex)),
    );

    const matches = matchResults.filter((m): m is GrepMatch => m !== null);

    return { pattern, path: path ?? '', matches };
  }

  private async matchFile(
    key: string,
    regex: RegExp,
  ): Promise<GrepMatch | null> {
    const content = await this.storage.readFile(key);
    if (content === null) return null;

    const excerpts = this.extractExcerpts(content, regex);
    if (excerpts.length === 0) return null;

    return { file: key, excerpts };
  }

  private extractExcerpts(content: string, regex: RegExp): string[] {
    const lines = content.split('\n');
    const excerpts: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 1);
        excerpts.push(lines.slice(start, end + 1).join('\n'));
      }
    }

    return excerpts;
  }
}
