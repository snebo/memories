-- Add pending value to TranscriptStatus enum
ALTER TYPE "TranscriptStatus" ADD VALUE 'pending';

-- Update default to pending
ALTER TABLE "Transcript" ALTER COLUMN "status" SET DEFAULT 'pending';

-- Add unique constraint on contentHash
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_contentHash_key" UNIQUE ("contentHash");
