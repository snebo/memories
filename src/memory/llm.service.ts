import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ExtractedMemories } from './types/extracted-memories.types';

export const OPENAI_CLIENT = 'OPENAI_CLIENT';

const MEMORY_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              context: { type: 'string' },
            },
            required: ['name', 'context'],
            additionalProperties: false,
          },
        },
        companies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              context: { type: 'string' },
            },
            required: ['name', 'context'],
            additionalProperties: false,
          },
        },
        locations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              context: { type: 'string' },
            },
            required: ['name', 'context'],
            additionalProperties: false,
          },
        },
      },
      required: ['people', 'companies', 'locations'],
      additionalProperties: false,
    },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          keyPoints: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'summary', 'keyPoints'],
        additionalProperties: false,
      },
    },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          relatedEntities: { type: 'array', items: { type: 'string' } },
        },
        required: ['content', 'confidence', 'relatedEntities'],
        additionalProperties: false,
      },
    },
    sentiment: {
      type: 'object',
      properties: {
        overall: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
        score: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['overall', 'score', 'notes'],
      additionalProperties: false,
    },
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          event: { type: 'string' },
          participants: { type: 'array', items: { type: 'string' } },
        },
        required: ['date', 'event', 'participants'],
        additionalProperties: false,
      },
    },
  },
  required: ['entities', 'topics', 'facts', 'sentiment', 'timeline'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a memory extraction assistant. Analyze the transcript and extract structured information for a persistent memory system.

Extract exactly:
1. Entities — people (name, optional role, context), companies, locations
2. Topics — subjects discussed with a concise summary and key points
3. Facts — specific claims rated high (explicitly stated), medium (implied), or low (inferred)
4. Sentiment — overall tone as positive/negative/neutral with a score (-1.0 to 1.0) and brief notes
5. Timeline — date-referenced events (use ISO dates when possible, e.g. "2026-06", "2026-Q3")

Rules:
- Only extract what is present. Do not infer or hallucinate.
- Return empty arrays when nothing is found for a category.
- relatedEntities lists entity names referenced by a fact.
- participants lists names of people involved in a timeline event.`;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openai: OpenAI,
    private readonly config: ConfigService,
  ) {}

  parseExtractedMemories(json: string): ExtractedMemories {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(json) as Record<string, unknown>;
    } catch {
      throw new Error(`Failed to parse LLM response: invalid JSON`);
    }

    const entities = (raw.entities as Record<string, unknown>) ?? {};

    return {
      entities: {
        people: Array.isArray(entities.people) ? entities.people : [],
        companies: Array.isArray(entities.companies) ? entities.companies : [],
        locations: Array.isArray(entities.locations) ? entities.locations : [],
      },
      topics: Array.isArray(raw.topics) ? raw.topics : [],
      facts: Array.isArray(raw.facts) ? raw.facts : [],
      sentiment: (raw.sentiment as ExtractedMemories['sentiment']) ?? {
        overall: 'neutral',
        score: 0,
        notes: '',
      },
      timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
    };
  }

  async extractMemories(transcript: string): Promise<ExtractedMemories> {
    const model = this.config.get<string>('OPENAI_MODEL', 'gpt-4o');

    let raw: string;
    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Extract memories from the following transcript:\n\n${transcript}`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'extracted_memories',
            strict: true,
            schema: MEMORY_EXTRACTION_SCHEMA,
          },
        },
        temperature: 0,
      });

      raw = response.choices[0]?.message?.content ?? '';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LLM extraction failed: ${message}`);
    }

    if (!raw) {
      throw new Error('Empty response from LLM');
    }

    return this.parseExtractedMemories(raw);
  }
}
