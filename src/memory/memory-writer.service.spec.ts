import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from './storage.service';
import { MemoryWriterService } from './memory-writer.service';
import { ExtractedMemories } from './types/extracted-memories.types';

const mockStorageService = () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
});

const makeMemories = (
  overrides: Partial<ExtractedMemories> = {},
): ExtractedMemories => ({
  entities: {
    people: [
      { name: 'Alice Johnson', role: 'Engineer', context: 'Led the redesign' },
    ],
    companies: [{ name: 'Acme Corp', context: 'Primary employer' }],
    locations: [{ name: 'Berlin', context: 'Office location' }],
  },
  topics: [
    {
      name: 'Backend Redesign',
      summary: 'Moving to microservices',
      keyPoints: ['Event-driven', 'Auth first'],
    },
  ],
  facts: [
    {
      content: 'Migration planned Q3 2026',
      confidence: 'high',
      relatedEntities: ['Alice Johnson'],
    },
  ],
  sentiment: { overall: 'positive', score: 0.7, notes: 'Aligned team' },
  timeline: [
    {
      date: '2026-Q3',
      event: 'Migration start',
      participants: ['Alice Johnson'],
    },
  ],
  ...overrides,
});

describe('MemoryWriterService', () => {
  let service: MemoryWriterService;
  let storage: ReturnType<typeof mockStorageService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryWriterService,
        { provide: StorageService, useFactory: mockStorageService },
      ],
    }).compile();

    service = module.get(MemoryWriterService);
    storage = module.get(StorageService);
  });

  describe('toSlug', () => {
    it('converts a name to kebab-case slug', () => {
      expect(service.toSlug('Alice Johnson')).toBe('alice-johnson');
      expect(service.toSlug('Acme Corp.')).toBe('acme-corp');
      expect(service.toSlug('New York City')).toBe('new-york-city');
    });

    it('removes special characters', () => {
      expect(service.toSlug("Dr. John O'Brien")).toBe('dr-john-o-brien');
    });
  });

  describe('buildPersonContent', () => {
    it('creates a new markdown file for a new person with no existing content', () => {
      const person = {
        name: 'Alice Johnson',
        role: 'Engineer',
        context: 'Led the redesign',
      };
      const content = service.buildPersonContent(null, person, '2026-06-06');

      expect(content).toContain('# Alice Johnson');
      expect(content).toContain('Engineer');
      expect(content).toContain('Led the redesign');
      expect(content).toContain('2026-06-06');
    });

    it('appends a new update block to an existing file', () => {
      const existing =
        '# Alice Johnson\n\n## Updates\n\n### 2026-01-01\n- First mention\n';
      const person = { name: 'Alice Johnson', context: 'New context' };
      const content = service.buildPersonContent(
        existing,
        person,
        '2026-06-06',
      );

      expect(content).toContain('### 2026-01-01');
      expect(content).toContain('### 2026-06-06');
      expect(content).toContain('New context');
    });

    it('does not duplicate an update for the same date', () => {
      const existing =
        '# Alice Johnson\n\n## Updates\n\n### 2026-06-06\n- Already here\n';
      const person = { name: 'Alice Johnson', context: 'Same day update' };
      const content = service.buildPersonContent(
        existing,
        person,
        '2026-06-06',
      );

      expect(content.match(/### 2026-06-06/g)).toHaveLength(1);
    });
  });

  describe('buildTopicContent', () => {
    const topic = {
      name: 'Backend Redesign',
      summary: 'Moving to microservices',
      keyPoints: ['Use event-driven architecture', 'Auth service first'],
    };

    it('creates a new markdown file for a new topic', () => {
      const content = service.buildTopicContent(null, topic, '2026-06-07');

      expect(content).toContain('# Backend Redesign');
      expect(content).toContain('Moving to microservices');
      expect(content).toContain('- Use event-driven architecture');
      expect(content).toContain('- Auth service first');
      expect(content).toContain('2026-06-07');
    });

    it('appends a new update block for a new date on an existing topic file', () => {
      const existing =
        '# Backend Redesign\n\n## Updates\n\n### 2026-01-01\n**Summary**: Initial plan\n';
      const content = service.buildTopicContent(existing, topic, '2026-06-07');

      expect(content).toContain('### 2026-01-01');
      expect(content).toContain('### 2026-06-07');
      expect(content).toContain('Moving to microservices');
    });

    it('does not duplicate an update block for the same date', () => {
      const existing =
        '# Backend Redesign\n\n## Updates\n\n### 2026-06-07\n**Summary**: Existing entry\n';
      const content = service.buildTopicContent(existing, topic, '2026-06-07');

      expect(content.match(/### 2026-06-07/g)).toHaveLength(1);
    });
  });

  describe('buildEntityContent', () => {
    const company = { name: 'Acme Corp', context: 'Primary employer of Alice' };
    const location = { name: 'Berlin', context: 'Office headquarters' };

    it('creates a new markdown file for a new company', () => {
      const content = service.buildEntityContent(null, company, '2026-06-07');

      expect(content).toContain('# Acme Corp');
      expect(content).toContain('Primary employer of Alice');
      expect(content).toContain('2026-06-07');
    });

    it('creates a new markdown file for a new location', () => {
      const content = service.buildEntityContent(null, location, '2026-06-07');

      expect(content).toContain('# Berlin');
      expect(content).toContain('Office headquarters');
    });

    it('appends to an existing company file without overwriting earlier entries', () => {
      const existing =
        '# Acme Corp\n\n## Updates\n\n### 2026-01-01\n- First mention\n';
      const content = service.buildEntityContent(
        existing,
        company,
        '2026-06-07',
      );

      expect(content).toContain('### 2026-01-01');
      expect(content).toContain('### 2026-06-07');
      expect(content).toContain('Primary employer of Alice');
    });

    it('does not duplicate a company update for the same date', () => {
      const existing =
        '# Acme Corp\n\n## Updates\n\n### 2026-06-07\n- Already here\n';
      const content = service.buildEntityContent(
        existing,
        company,
        '2026-06-07',
      );

      expect(content.match(/### 2026-06-07/g)).toHaveLength(1);
    });
  });

  describe('file path generation (writeMemories key structure)', () => {
    beforeEach(() => {
      storage.readFile.mockResolvedValue(null);
      storage.writeFile.mockResolvedValue(undefined);
    });

    it('writes people files under people/<slug>.md', async () => {
      await service.writeMemories(makeMemories(), '2026-06-07');

      expect(storage.writeFile).toHaveBeenCalledWith(
        'people/alice-johnson.md',
        expect.any(String),
      );
    });

    it('writes company files under entities/companies/<slug>.md', async () => {
      await service.writeMemories(makeMemories(), '2026-06-07');

      expect(storage.writeFile).toHaveBeenCalledWith(
        'entities/companies/acme-corp.md',
        expect.any(String),
      );
    });

    it('writes location files under entities/locations/<slug>.md', async () => {
      await service.writeMemories(makeMemories(), '2026-06-07');

      expect(storage.writeFile).toHaveBeenCalledWith(
        'entities/locations/berlin.md',
        expect.any(String),
      );
    });

    it('writes topic files under topics/<slug>.md', async () => {
      await service.writeMemories(makeMemories(), '2026-06-07');

      expect(storage.writeFile).toHaveBeenCalledWith(
        'topics/backend-redesign.md',
        expect.any(String),
      );
    });

    it('writes ISO date timeline entries under timeline/<year-month>/summary.md', async () => {
      const memories = makeMemories({
        timeline: [{ date: '2026-06-15', event: 'Kick-off', participants: [] }],
      });
      await service.writeMemories(memories, '2026-06-07');

      expect(storage.writeFile).toHaveBeenCalledWith(
        'timeline/2026-06/summary.md',
        expect.any(String),
      );
    });

    it('writes quarter-format timeline entries under timeline/<year-Qn>/summary.md', async () => {
      const memories = makeMemories({
        timeline: [
          { date: '2026-Q3', event: 'Migration start', participants: [] },
        ],
      });
      await service.writeMemories(memories, '2026-06-07');

      expect(storage.writeFile).toHaveBeenCalledWith(
        'timeline/2026-Q3/summary.md',
        expect.any(String),
      );
    });

    it('slugifies multi-word entity names with spaces', async () => {
      const memories = makeMemories({
        entities: {
          people: [
            {
              name: 'John van der Berg',
              role: 'CTO',
              context: 'Led architecture',
            },
          ],
          companies: [],
          locations: [],
        },
        topics: [],
        timeline: [],
      });
      await service.writeMemories(memories, '2026-06-07');

      expect(storage.writeFile).toHaveBeenCalledWith(
        'people/john-van-der-berg.md',
        expect.any(String),
      );
    });
  });

  describe('buildTimelineContent', () => {
    it('creates timeline file with the event', () => {
      const entry = {
        date: '2026-06-15',
        event: 'Migration start',
        participants: ['Alice'],
      };
      const content = service.buildTimelineContent(null, entry);

      expect(content).toContain('# 2026-06');
      expect(content).toContain('2026-06-15');
      expect(content).toContain('Migration start');
      expect(content).toContain('Alice');
    });

    it('appends a new event to an existing timeline file', () => {
      const existing = '# 2026-06\n\n## Events\n\n- 2026-06-01: First event\n';
      const entry = {
        date: '2026-06-15',
        event: 'Second event',
        participants: [],
      };
      const content = service.buildTimelineContent(existing, entry);

      expect(content).toContain('2026-06-01: First event');
      expect(content).toContain('2026-06-15: Second event');
    });
  });

  describe('writeMemories', () => {
    it('writes one file per entity type, topic, and timeline entry', async () => {
      storage.readFile.mockResolvedValue(null);
      storage.writeFile.mockResolvedValue(undefined);

      const memories = makeMemories();
      await service.writeMemories(memories, '2026-06-06');

      // 1 person + 1 company + 1 location + 1 topic + 1 timeline = 5 writes
      expect(storage.writeFile).toHaveBeenCalledTimes(5);
      expect(storage.writeFile).toHaveBeenCalledWith(
        'people/alice-johnson.md',
        expect.stringContaining('# Alice Johnson'),
      );
      expect(storage.writeFile).toHaveBeenCalledWith(
        'topics/backend-redesign.md',
        expect.stringContaining('# Backend Redesign'),
      );
      expect(storage.writeFile).toHaveBeenCalledWith(
        'timeline/2026-Q3/summary.md',
        expect.stringContaining('Migration start'),
      );
    });

    it('reads existing files before writing (merge, not overwrite)', async () => {
      storage.readFile.mockResolvedValue('# Existing content\n');
      storage.writeFile.mockResolvedValue(undefined);

      await service.writeMemories(makeMemories(), '2026-06-06');

      expect(storage.readFile).toHaveBeenCalledTimes(5);
    });

    it('handles empty extracted memories without writing any files', async () => {
      const empty = makeMemories({
        entities: { people: [], companies: [], locations: [] },
        topics: [],
        timeline: [],
      });

      await service.writeMemories(empty, '2026-06-06');

      expect(storage.writeFile).not.toHaveBeenCalled();
    });
  });
});
