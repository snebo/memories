export const TRANSCRIPT_QUEUE = 'transcript' as const;

export interface TranscriptJobPayload {
  readonly transcriptId: string;
}
