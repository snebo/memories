import { Inject, Injectable } from '@nestjs/common';
import { ExtractedMemories } from './types/extracted-memories.types';
import { LLM_CLIENT } from './llm-client.interface';
import type { LlmClient } from './llm-client.interface';

@Injectable()
export class LlmService {
  constructor(@Inject(LLM_CLIENT) private readonly client: LlmClient) {}

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
    try {
      const raw = await this.client.complete(transcript);
      return this.parseExtractedMemories(raw);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('Failed to parse')) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LLM extraction failed: ${message}`);
    }
  }
}
