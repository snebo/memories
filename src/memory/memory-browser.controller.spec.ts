import {
  BadRequestException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { MemoryBrowserController } from './memory-browser.controller';
import {
  GrepResponse,
  ListMemoriesResponse,
  MemoryBrowserService,
} from './memory-browser.service';

const mockMemoryBrowserService = () => ({
  list: jest.fn(),
  cat: jest.fn(),
  grep: jest.fn(),
});

describe('MemoryBrowserController (integration)', () => {
  let app: INestApplication;
  let service: ReturnType<typeof mockMemoryBrowserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryBrowserController],
      providers: [
        {
          provide: MemoryBrowserService,
          useFactory: mockMemoryBrowserService,
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    service = module.get(MemoryBrowserService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /memories', () => {
    const listResponse: ListMemoriesResponse = {
      path: '',
      entries: [
        { key: 'people/', type: 'directory' },
        { key: 'topics/', type: 'directory' },
      ],
    };

    it('returns 200 with entries when no path is given', async () => {
      service.list.mockResolvedValue(listResponse);

      const { body } = await request(app.getHttpServer())
        .get('/memories')
        .expect(200);

      expect(body).toEqual(listResponse);
      expect(service.list).toHaveBeenCalledWith(undefined);
    });

    it('returns 200 with entries for the given path', async () => {
      const pathResponse: ListMemoriesResponse = {
        path: 'people/',
        entries: [{ key: 'people/alice.md', type: 'file' }],
      };
      service.list.mockResolvedValue(pathResponse);

      const { body } = await request(app.getHttpServer())
        .get('/memories')
        .query({ path: 'people/' })
        .expect(200);

      expect(body).toEqual(pathResponse);
      expect(service.list).toHaveBeenCalledWith('people/');
    });

    it('returns 200 with empty entries when path does not exist', async () => {
      service.list.mockResolvedValue({ path: 'ghost/', entries: [] });

      const { body } = await request(app.getHttpServer())
        .get('/memories')
        .query({ path: 'ghost/' })
        .expect(200);

      expect(body.entries).toEqual([]);
    });

    it('returns 400 when an unknown query param is sent', async () => {
      await request(app.getHttpServer())
        .get('/memories')
        .query({ path: 'people/', unknown: 'x' })
        .expect(400);
    });
  });

  describe('GET /memories/cat', () => {
    it('returns 200 with file content when path exists', async () => {
      service.cat.mockResolvedValue({
        path: 'people/alice.md',
        content: '# Alice\n\nContent here.',
      });

      const { body } = await request(app.getHttpServer())
        .get('/memories/cat')
        .query({ path: 'people/alice.md' })
        .expect(200);

      expect(body).toEqual({
        path: 'people/alice.md',
        content: '# Alice\n\nContent here.',
      });
      expect(service.cat).toHaveBeenCalledWith('people/alice.md');
    });

    it('returns 404 when the file does not exist', async () => {
      service.cat.mockRejectedValue(
        new NotFoundException('File not found: people/ghost.md'),
      );

      await request(app.getHttpServer())
        .get('/memories/cat')
        .query({ path: 'people/ghost.md' })
        .expect(404);
    });

    it('returns 400 when path is missing', async () => {
      await request(app.getHttpServer()).get('/memories/cat').expect(400);
    });

    it('returns 400 when path is an empty string', async () => {
      await request(app.getHttpServer())
        .get('/memories/cat')
        .query({ path: '' })
        .expect(400);
    });

    it('returns 400 when an unknown query param is sent', async () => {
      await request(app.getHttpServer())
        .get('/memories/cat')
        .query({ path: 'people/alice.md', extra: 'x' })
        .expect(400);
    });
  });

  describe('GET /memories/grep', () => {
    const grepResponse: GrepResponse = {
      pattern: 'backend',
      path: '',
      matches: [
        {
          file: 'people/alice.md',
          excerpts: ['# Alice\n\nWorks on the backend team.'],
        },
      ],
    };

    it('returns 200 with matching files and excerpts', async () => {
      service.grep.mockResolvedValue(grepResponse);

      const { body } = await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'backend' })
        .expect(200);

      expect(body).toEqual(grepResponse);
      expect(service.grep).toHaveBeenCalledWith('backend', undefined);
    });

    it('passes the optional path prefix to the service', async () => {
      service.grep.mockResolvedValue({ ...grepResponse, path: 'people/' });

      await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'backend', path: 'people/' })
        .expect(200);

      expect(service.grep).toHaveBeenCalledWith('backend', 'people/');
    });

    it('returns 200 with empty matches when nothing matches', async () => {
      service.grep.mockResolvedValue({
        pattern: 'xyzzy',
        path: '',
        matches: [],
      });

      const { body } = await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'xyzzy' })
        .expect(200);

      expect(body.matches).toEqual([]);
    });

    it('returns 400 when pattern is missing', async () => {
      await request(app.getHttpServer()).get('/memories/grep').expect(400);
    });

    it('returns 400 when pattern is an empty string', async () => {
      await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: '' })
        .expect(400);
    });

    it('returns 400 when an invalid regex is passed', async () => {
      service.grep.mockRejectedValue(
        new BadRequestException('Invalid regex pattern: [bad'),
      );

      await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: '[bad' })
        .expect(400);
    });

    it('returns 400 when an unknown query param is sent', async () => {
      await request(app.getHttpServer())
        .get('/memories/grep')
        .query({ pattern: 'test', unknown: 'x' })
        .expect(400);
    });
  });
});
