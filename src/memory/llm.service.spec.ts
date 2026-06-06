import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService, OPENAI_CLIENT } from './llm.service';
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

const mockOpenAiClient = () => ({
  chat: {
    completions: {
      create: jest.fn(),
    },
  },
});

describe('LlmService', () => {
  let service: LlmService;
  let openai: ReturnType<typeof mockOpenAiClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: OPENAI_CLIENT, useFactory: mockOpenAiClient },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('gpt-4o') },
        },
      ],
    }).compile();

    service = module.get(LlmService);
    openai = module.get(OPENAI_CLIENT);
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
    it('calls OpenAI with the transcript content and returns parsed memories', async () => {
      (openai.chat.completions.create as jest.Mock).mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(validExtractedMemories),
            },
          },
        ],
      });

      const result = await service.extractMemories(
        'Alice discussed the backend redesign.',
      );

      expect(openai.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.any(String),
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(
                'Alice discussed the backend redesign.',
              ),
            }),
          ]),
          response_format: expect.objectContaining({ type: 'json_schema' }),
        }),
      );
      expect(result.entities.people[0].name).toBe('Alice');
    });

    it('throws when OpenAI returns an empty response', async () => {
      (openai.chat.completions.create as jest.Mock).mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      await expect(service.extractMemories('test transcript')).rejects.toThrow(
        /Empty response from LLM/,
      );
    });

    it('propagates OpenAI API errors with context', async () => {
      (openai.chat.completions.create as jest.Mock).mockRejectedValue(
        new Error('rate limit exceeded'),
      );

      await expect(service.extractMemories('test')).rejects.toThrow(
        /LLM extraction failed/,
      );
    });
  });
});
