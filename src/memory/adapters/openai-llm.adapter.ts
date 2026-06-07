import OpenAI from 'openai';
import { MEMORY_EXTRACTION_SYSTEM_PROMPT } from '../llm.constants';
import type { LlmClient } from '../llm-client.interface';

const OPENAI_EXTRACTION_SCHEMA = {
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

export class OpenAiLlmAdapter implements LlmClient {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
  ) {}

  async complete(transcript: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: MEMORY_EXTRACTION_SYSTEM_PROMPT },
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
          schema: OPENAI_EXTRACTION_SCHEMA,
        },
      },
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content ?? '';
    if (!content) throw new Error('Empty response from LLM');
    return content;
  }
}
