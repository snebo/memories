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
      (storage.readFile as jest.Mock).mockResolvedValue(null);
      (storage.writeFile as jest.Mock).mockResolvedValue(undefined);

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
      (storage.readFile as jest.Mock).mockResolvedValue('# Existing content\n');
      (storage.writeFile as jest.Mock).mockResolvedValue(undefined);

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
