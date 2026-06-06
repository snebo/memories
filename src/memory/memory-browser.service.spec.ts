import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StorageEntry, StorageService } from './storage.service';
import { MemoryBrowserService } from './memory-browser.service';

const mockStorageService = () => ({
  listFiles: jest.fn(),
  listAllFiles: jest.fn(),
  readFile: jest.fn(),
});

describe('MemoryBrowserService', () => {
  let service: MemoryBrowserService;
  let storage: ReturnType<typeof mockStorageService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryBrowserService,
        { provide: StorageService, useFactory: mockStorageService },
      ],
    }).compile();

    service = module.get(MemoryBrowserService);
    storage = module.get(StorageService);
  });

  describe('list', () => {
    it('returns entries from storage for the root when no path given', async () => {
      const entries: StorageEntry[] = [
        { key: 'people/', type: 'directory' },
        { key: 'topics/', type: 'directory' },
      ];
      storage.listFiles.mockResolvedValue(entries);

      const result = await service.list();

      expect(storage.listFiles).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ path: '', entries });
    });

    it('returns entries for a specific path prefix', async () => {
      const entries: StorageEntry[] = [{ key: 'people/alice.md', type: 'file' }];
      storage.listFiles.mockResolvedValue(entries);

      const result = await service.list('people/');

      expect(storage.listFiles).toHaveBeenCalledWith('people/');
      expect(result).toEqual({ path: 'people/', entries });
    });

    it('returns empty entries when path is empty in storage', async () => {
      storage.listFiles.mockResolvedValue([]);

      const result = await service.list('nonexistent/');

      expect(result).toEqual({ path: 'nonexistent/', entries: [] });
    });
  });

  describe('cat', () => {
    it('returns path and content when the file exists', async () => {
      storage.readFile.mockResolvedValue('# Alice Johnson\n\nSome content.');

      const result = await service.cat('people/alice-johnson.md');

      expect(storage.readFile).toHaveBeenCalledWith('people/alice-johnson.md');
      expect(result).toEqual({
        path: 'people/alice-johnson.md',
        content: '# Alice Johnson\n\nSome content.',
      });
    });

    it('throws NotFoundException when the file does not exist', async () => {
      storage.readFile.mockResolvedValue(null);

      await expect(service.cat('people/nobody.md')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('includes the missing path in the NotFoundException message', async () => {
      storage.readFile.mockResolvedValue(null);

      await expect(service.cat('people/ghost.md')).rejects.toThrow(
        'people/ghost.md',
      );
    });
  });

  describe('grep', () => {
    const fileA = 'people/alice.md';
    const fileB = 'topics/backend.md';
    // No blank line between header and body so context window includes '# Alice'
    const contentA = '# Alice\nWorks on the backend team.\nShe likes TypeScript.';
    const contentB = '# Backend\n\nAll things backend engineering.\nIncludes Node.js.';

    beforeEach(() => {
      storage.listAllFiles.mockResolvedValue([fileA, fileB]);
      storage.readFile.mockImplementation((key: string) => {
        if (key === fileA) return Promise.resolve(contentA);
        if (key === fileB) return Promise.resolve(contentB);
        return Promise.resolve(null);
      });
    });

    it('returns matching files and line excerpts for a pattern', async () => {
      const result = await service.grep('typescript');

      expect(result.pattern).toBe('typescript');
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].file).toBe(fileA);
      expect(result.matches[0].excerpts.some((e) => /typescript/i.test(e))).toBe(
        true,
      );
    });

    it('returns matches from multiple files when pattern appears in both', async () => {
      const result = await service.grep('backend');

      expect(result.matches).toHaveLength(2);
      const files = result.matches.map((m) => m.file);
      expect(files).toContain(fileA);
      expect(files).toContain(fileB);
    });

    it('returns empty matches when pattern does not match any file', async () => {
      const result = await service.grep('xyzzy-does-not-exist');

      expect(result.matches).toEqual([]);
    });

    it('scopes search to the given path prefix', async () => {
      storage.listAllFiles.mockResolvedValue([fileA]);
      storage.readFile.mockResolvedValue(contentA);

      await service.grep('alice', 'people/');

      expect(storage.listAllFiles).toHaveBeenCalledWith('people/');
    });

    it('throws BadRequestException for an invalid regex pattern', async () => {
      await expect(service.grep('[invalid regex')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('includes the invalid pattern in the error message', async () => {
      await expect(service.grep('(unclosed')).rejects.toThrow('(unclosed');
    });

    it('includes surrounding context lines in excerpts', async () => {
      storage.listAllFiles.mockResolvedValue([fileA]);
      storage.readFile.mockResolvedValue(contentA);

      const result = await service.grep('backend');

      const excerpt = result.matches[0].excerpts[0];
      // line before "Works on the backend team." is "# Alice"
      expect(excerpt).toContain('Alice');
    });

    it('skips files that do not exist in storage', async () => {
      storage.listAllFiles.mockResolvedValue(['missing.md']);
      storage.readFile.mockResolvedValue(null);

      const result = await service.grep('anything');

      expect(result.matches).toEqual([]);
    });

    it('returns the pattern and path in the response envelope', async () => {
      storage.listAllFiles.mockResolvedValue([]);

      const result = await service.grep('test', 'topics/');

      expect(result.pattern).toBe('test');
      expect(result.path).toBe('topics/');
    });
  });
});
