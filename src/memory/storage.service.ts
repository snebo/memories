import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export const S3_CLIENT = 'S3_CLIENT';

export interface StorageEntry {
  readonly key: string;
  readonly type: 'file' | 'directory';
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'memories');
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  async readFile(key: string): Promise<string | null> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return response.Body!.transformToString();
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }

  async writeFile(key: string, content: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: 'text/markdown',
      }),
    );
  }

  async listFiles(prefix?: string): Promise<StorageEntry[]> {
    const normalizedPrefix = this.normalizePrefix(prefix);

    const response = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: normalizedPrefix || undefined,
        Delimiter: '/',
      }),
    );

    const directories: StorageEntry[] = (response.CommonPrefixes ?? [])
      .filter((cp) => cp.Prefix != null)
      .map((cp) => ({ key: cp.Prefix!, type: 'directory' as const }));

    const files: StorageEntry[] = (response.Contents ?? [])
      .filter((obj) => obj.Key != null && obj.Key !== normalizedPrefix)
      .map((obj) => ({ key: obj.Key!, type: 'file' as const }));

    return [...directories, ...files];
  }

  async listAllFiles(prefix?: string): Promise<string[]> {
    const normalizedPrefix = this.normalizePrefix(prefix);
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: normalizedPrefix || undefined,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of response.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return keys;
  }

  private normalizePrefix(prefix?: string): string {
    if (!prefix) return '';
    return prefix.endsWith('/') ? prefix : `${prefix}/`;
  }

  private async ensureBucketExists(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created bucket: ${this.bucket}`);
    }
  }
}
