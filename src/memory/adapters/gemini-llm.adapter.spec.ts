import { GeminiLlmAdapter } from './gemini-llm.adapter';

const SAMPLE_JSON = '{"entities":{"people":[],"companies":[],"locations":[]},"topics":[],"facts":[],"sentiment":{"overall":"neutral","score":0,"notes":""},"timeline":[]}';

const mockModel = () => ({
  generateContent: jest.fn(),
});

const mockGeminiClient = (model: ReturnType<typeof mockModel>) => ({
  getGenerativeModel: jest.fn().mockReturnValue(model),
});

describe('GeminiLlmAdapter', () => {
  let adapter: GeminiLlmAdapter;
  let model: ReturnType<typeof mockModel>;
  let client: ReturnType<typeof mockGeminiClient>;

  beforeEach(() => {
    model = mockModel();
    client = mockGeminiClient(model);
    adapter = new GeminiLlmAdapter(client as never, 'gemini-2.0-flash');
  });

  it('calls getGenerativeModel with the correct model name and JSON response config', async () => {
    model.generateContent.mockResolvedValue({ response: { text: () => SAMPLE_JSON } });

    await adapter.complete('Priya proposed chunking documents before embedding.');

    expect(client.getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.0-flash',
        systemInstruction: expect.any(String),
        generationConfig: expect.objectContaining({
          responseMimeType: 'application/json',
          temperature: 0,
        }),
      }),
    );
  });

  it('passes the transcript to generateContent and returns the JSON string', async () => {
    model.generateContent.mockResolvedValue({ response: { text: () => SAMPLE_JSON } });

    const result = await adapter.complete('Priya proposed chunking documents before embedding.');

    expect(model.generateContent).toHaveBeenCalledWith(
      expect.stringContaining('Priya proposed chunking documents before embedding.'),
    );
    expect(result).toBe(SAMPLE_JSON);
  });

  it('throws "Empty response from LLM" when response text is empty', async () => {
    model.generateContent.mockResolvedValue({ response: { text: () => '' } });

    await expect(adapter.complete('test')).rejects.toThrow('Empty response from LLM');
  });

  it('propagates API errors from Gemini', async () => {
    model.generateContent.mockRejectedValue(new Error('503 Service Unavailable'));

    await expect(adapter.complete('test')).rejects.toThrow('503 Service Unavailable');
  });

  it('creates a fresh model instance per call (stateless)', async () => {
    model.generateContent.mockResolvedValue({ response: { text: () => SAMPLE_JSON } });

    await adapter.complete('first');
    await adapter.complete('second');

    expect(client.getGenerativeModel).toHaveBeenCalledTimes(2);
  });
});
