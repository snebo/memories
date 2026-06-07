import { OpenAiLlmAdapter } from './openai-llm.adapter';

const mockOpenAi = () => ({
  chat: { completions: { create: jest.fn() } },
});

const makeResponse = (content: string | null) => ({
  choices: [{ message: { content } }],
});

describe('OpenAiLlmAdapter', () => {
  let adapter: OpenAiLlmAdapter;
  let openai: ReturnType<typeof mockOpenAi>;

  beforeEach(() => {
    openai = mockOpenAi();
    adapter = new OpenAiLlmAdapter(openai as never, 'gpt-4o');
  });

  it('calls the OpenAI chat completions API with the transcript and returns the JSON string', async () => {
    const json =
      '{"entities":{"people":[],"companies":[],"locations":[]},"topics":[],"facts":[],"sentiment":{"overall":"neutral","score":0,"notes":""},"timeline":[]}';
    openai.chat.completions.create.mockResolvedValue(makeResponse(json));

    const result = await adapter.complete(
      'Alice discussed the backend redesign.',
    );

    expect(openai.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
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
        temperature: 0,
      }),
    );
    expect(result).toBe(json);
  });

  it('throws "Empty response from LLM" when content is null', async () => {
    openai.chat.completions.create.mockResolvedValue(makeResponse(null));

    await expect(adapter.complete('test')).rejects.toThrow(
      'Empty response from LLM',
    );
  });

  it('throws "Empty response from LLM" when content is an empty string', async () => {
    openai.chat.completions.create.mockResolvedValue(makeResponse(''));

    await expect(adapter.complete('test')).rejects.toThrow(
      'Empty response from LLM',
    );
  });

  it('propagates API errors from OpenAI', async () => {
    openai.chat.completions.create.mockRejectedValue(
      new Error('429 quota exceeded'),
    );

    await expect(adapter.complete('test')).rejects.toThrow(
      '429 quota exceeded',
    );
  });
});
