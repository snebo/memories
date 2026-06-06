import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3_CLIENT, StorageEntry, StorageService } from './storage.service';

const mockS3Client = () => ({
  send: jest.fn(),
});

const mockConfigService = () => ({
  get: jest.fn().mockImplementation((key: string, def?: string) => {
    const values: Record<string, string> = {
      MINIO_BUCKET: 'memories',
    };
    return values[key] ?? def;
  }),
  getOrThrow: jest.fn().mockImplementation((key: string) => {
    const values: Record<string, string> = {
      MINIO_ENDPOINT: 'http://localhost:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin',
    };
    return values[key];
  }),
});

describe('StorageService', () => {
  let service: StorageService;
  let s3: ReturnType<typeof mockS3Client>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: S3_CLIENT, useFactory: mockS3Client },
        { provide: ConfigService, useFactory: mockConfigService },
      ],
    }).compile();

    service = module.get(StorageService);
    s3 = module.get(S3_CLIENT);
  });

  describe('readFile', () => {
    it('returns file content as a string when the file exists', async () => {
      const bodyMock = {
        transformToString: jest.fn().mockResolvedValue('file contents'),
      };
      (s3.send as jest.Mock).mockResolvedValue({ Body: bodyMock });

      const result = await service.readFile('people/john-doe.md');

      expect(s3.send).toHaveBeenCalled();
      expect(result).toBe('file contents');
    });

    it('returns null when the file does not exist (NoSuchKey)', async () => {
      const err = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      (s3.send as jest.Mock).mockRejectedValue(err);

      const result = await service.readFile('people/nobody.md');

      expect(result).toBeNull();
    });

    it('rethrows unexpected S3 errors', async () => {
      (s3.send as jest.Mock).mockRejectedValue(new Error('Access denied'));

      await expect(service.readFile('people/secret.md')).rejects.toThrow(
        'Access denied',
      );
    });
  });

  describe('writeFile', () => {
    it('sends a PutObjectCommand with the correct key and content', async () => {
      (s3.send as jest.Mock).mockResolvedValue({});

      await service.writeFile('topics/ml.md', '# Machine Learning');

      expect(s3.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: 'topics/ml.md',
            Body: '# Machine Learning',
            ContentType: 'text/markdown',
          }),
        }),
      );
    });
  });

  describe('listFiles', () => {
    it('returns directories and files at the root when no prefix given', async () => {
      (s3.send as jest.Mock).mockResolvedValue({
        CommonPrefixes: [{ Prefix: 'people/' }, { Prefix: 'topics/' }],
        Contents: [{ Key: 'README.md' }],
      });

      const result = await service.listFiles();

      expect(result).toEqual<StorageEntry[]>([
        { key: 'people/', type: 'directory' },
        { key: 'topics/', type: 'directory' },
        { key: 'README.md', type: 'file' },
      ]);
    });

    it('normalizes prefix without trailing slash', async () => {
      (s3.send as jest.Mock).mockResolvedValue({
        CommonPrefixes: [],
        Contents: [{ Key: 'people/alice.md' }],
      });

      await service.listFiles('people');

      expect(s3.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ Prefix: 'people/', Delimiter: '/' }),
        }),
      );
    });

    it('excludes the prefix key itself from file results', async () => {
      (s3.send as jest.Mock).mockResolvedValue({
        CommonPrefixes: [],
        Contents: [{ Key: 'people/' }, { Key: 'people/alice.md' }],
      });

      const result = await service.listFiles('people/');

      const keys = result.map((e) => e.key);
      expect(keys).toContain('people/alice.md');
      expect(keys).not.toContain('people/');
    });

    it('returns empty array when bucket is empty', async () => {
      (s3.send as jest.Mock).mockResolvedValue({
        CommonPrefixes: undefined,
        Contents: undefined,
      });

      const result = await service.listFiles();

      expect(result).toEqual([]);
    });
  });

  describe('listAllFiles', () => {
    it('returns all file keys under a prefix', async () => {
      (s3.send as jest.Mock).mockResolvedValue({
        Contents: [
          { Key: 'topics/backend.md' },
          { Key: 'topics/frontend.md' },
        ],
        IsTruncated: false,
      });

      const result = await service.listAllFiles('topics');

      expect(result).toEqual(['topics/backend.md', 'topics/frontend.md']);
    });

    it('paginates when the response is truncated', async () => {
      (s3.send as jest.Mock)
        .mockResolvedValueOnce({
          Contents: [{ Key: 'people/alice.md' }],
          IsTruncated: true,
          NextContinuationToken: 'token-abc',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'people/bob.md' }],
          IsTruncated: false,
        });

      const result = await service.listAllFiles('people');

      expect(result).toEqual(['people/alice.md', 'people/bob.md']);
      expect(s3.send).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no objects exist under the prefix', async () => {
      (s3.send as jest.Mock).mockResolvedValue({
        Contents: undefined,
        IsTruncated: false,
      });

      const result = await service.listAllFiles('nonexistent');

      expect(result).toEqual([]);
    });
  });
});
