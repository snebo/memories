export const LLM_CLIENT = 'LLM_CLIENT';

export interface LlmClient {
  complete(transcript: string): Promise<string>;
}
