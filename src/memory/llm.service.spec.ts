import { Test, TestingModule } from '@nestjs/testing';
import { LlmService } from './llm.service';
import { LLM_CLIENT } from './llm-client.interface';
import { ExtractedMemories } from './types/extracted-memories.types';

const validExtractedMemories: ExtractedMemories = {
  entities: {
    people: [
      { name: 'Alice', role: 'Engineer', context: 'Led the backend redesign' },
    ],
    companies: [{ name: 'Acme Corp', context: 'Alice works here' }],
    locations: [{ name: 'Berlin', context: 'Office location' }],
  },
  topics: [
    {
      name: 'Backend Redesign',
      summary: 'Discussion about migrating to microservices',
      keyPoints: ['Use event-driven architecture', 'Start with auth service'],
    },
  ],
  facts: [
    {
      content: 'Migration is planned for Q3 2026',
      confidence: 'high',
      relatedEntities: ['Alice', 'Acme Corp'],
    },
  ],
  sentiment: { overall: 'positive', score: 0.7, notes: 'Team is aligned' },
  timeline: [
    {
      date: '2026-Q3',
      event: 'Microservices migration start',
      participants: ['Alice'],
    },
  ],
};

const mockLlmClient = () => ({ complete: jest.fn() });

describe('LlmService', () => {
  let service: LlmService;
  let client: ReturnType<typeof mockLlmClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: LLM_CLIENT, useFactory: mockLlmClient },
      ],
    }).compile();

    service = module.get(LlmService);
    client = module.get(LLM_CLIENT);
  });

  describe('parseExtractedMemories', () => {
    it('parses a fully populated valid JSON response', () => {
      const result = service.parseExtractedMemories(
        JSON.stringify(validExtractedMemories),
      );

      expect(result.entities.people).toHaveLength(1);
      expect(result.entities.people[0].name).toBe('Alice');
      expect(result.topics[0].name).toBe('Backend Redesign');
      expect(result.facts[0].confidence).toBe('high');
      expect(result.sentiment.overall).toBe('positive');
      expect(result.timeline[0].date).toBe('2026-Q3');
    });

    it('defaults missing arrays to empty', () => {
      const minimal = JSON.stringify({
        entities: {},
        topics: null,
        facts: undefined,
        sentiment: { overall: 'neutral', score: 0, notes: '' },
        timeline: null,
      });

      const result = service.parseExtractedMemories(minimal);

      expect(result.entities.people).toEqual([]);
      expect(result.entities.companies).toEqual([]);
      expect(result.entities.locations).toEqual([]);
      expect(result.topics).toEqual([]);
      expect(result.facts).toEqual([]);
      expect(result.timeline).toEqual([]);
    });

    it('defaults missing sentiment to neutral', () => {
      const noSentiment = JSON.stringify({
        entities: {},
        topics: [],
        facts: [],
        timeline: [],
      });

      const result = service.parseExtractedMemories(noSentiment);

      expect(result.sentiment.overall).toBe('neutral');
      expect(result.sentiment.score).toBe(0);
    });

    it('throws a descriptive error on malformed JSON', () => {
      expect(() => service.parseExtractedMemories('{ invalid json')).toThrow(
        /Failed to parse LLM response/,
      );
    });

    it('throws on a completely empty string', () => {
      expect(() => service.parseExtractedMemories('')).toThrow(
        /Failed to parse LLM response/,
      );
    });

    it('ignores unrecognised extra fields returned by the LLM', () => {
      const withExtras = JSON.stringify({
        ...validExtractedMemories,
        unknownField: 'should be ignored',
        nested: { also: 'ignored' },
      });

      expect(() => service.parseExtractedMemories(withExtras)).not.toThrow();
      const result = service.parseExtractedMemories(withExtras);
      expect(result.entities.people).toHaveLength(1);
    });

    it('defaults missing entities object to all-empty arrays', () => {
      const noEntities = JSON.stringify({
        topics: [],
        facts: [],
        sentiment: { overall: 'neutral', score: 0, notes: '' },
        timeline: [],
      });

      const result = service.parseExtractedMemories(noEntities);

      expect(result.entities.people).toEqual([]);
      expect(result.entities.companies).toEqual([]);
      expect(result.entities.locations).toEqual([]);
    });

    it('handles an empty transcript (no entities extracted)', () => {
      const empty = JSON.stringify({
        entities: { people: [], companies: [], locations: [] },
        topics: [],
        facts: [],
        sentiment: { overall: 'neutral', score: 0, notes: '' },
        timeline: [],
      });

      const result = service.parseExtractedMemories(empty);

      expect(result.entities.people).toHaveLength(0);
      expect(result.topics).toHaveLength(0);
    });
  });

  describe('extractMemories', () => {
    it('delegates to the client and returns parsed memories', async () => {
      client.complete.mockResolvedValue(JSON.stringify(validExtractedMemories));

      const result = await service.extractMemories(
        'Alice discussed the backend redesign.',
      );

      expect(client.complete).toHaveBeenCalledWith(
        'Alice discussed the backend redesign.',
      );
      expect(result.entities.people[0].name).toBe('Alice');
    });

    it('wraps an "Empty response" error from the client', async () => {
      client.complete.mockRejectedValue(new Error('Empty response from LLM'));

      await expect(service.extractMemories('test transcript')).rejects.toThrow(
        /LLM extraction failed: Empty response from LLM/,
      );
    });

    it('wraps API errors from the client with context', async () => {
      client.complete.mockRejectedValue(new Error('429 rate limit exceeded'));

      await expect(service.extractMemories('test')).rejects.toThrow(
        /LLM extraction failed/,
      );
    });

    it('rethrows parse errors without double-wrapping', async () => {
      client.complete.mockResolvedValue('{ not valid json');

      await expect(service.extractMemories('test')).rejects.toThrow(
        /Failed to parse LLM response/,
      );
    });
  });
});
