import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Schema } from '@google/generative-ai';
import { MEMORY_EXTRACTION_SYSTEM_PROMPT } from '../llm.constants';
import type { LlmClient } from '../llm-client.interface';

// Gemini's Schema type does not support additionalProperties — stripped from the OpenAI schema.
const GEMINI_EXTRACTION_SCHEMA = {
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
          },
        },
      },
      required: ['people', 'companies', 'locations'],
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
      },
    },
  },
  required: ['entities', 'topics', 'facts', 'sentiment', 'timeline'],
};

export class GeminiLlmAdapter implements LlmClient {
  constructor(
    private readonly client: GoogleGenerativeAI,
    private readonly modelName: string,
  ) {}

  async complete(transcript: string): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: MEMORY_EXTRACTION_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_EXTRACTION_SCHEMA as unknown as Schema,
        temperature: 0,
      },
    });

    const result = await model.generateContent(
      `Extract memories from the following transcript:\n\n${transcript}`,
    );

    const text = result.response.text();
    if (!text) throw new Error('Empty response from LLM');
    return text;
  }
}
