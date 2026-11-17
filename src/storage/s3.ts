import crypto from "node:crypto";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ArtifactStat,
  PresignedUrlOptions,
  StorageBackend,
  StoragePruneResult,
  StoragePutResult,
} from "./types.js";

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export class S3Storage implements StorageBackend {
  readonly name = "s3" as const;
  readonly supportsPresignedUrls = true;
  private client: S3Client;
  private bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;

    const credentials =
      options.accessKeyId && options.secretAccessKey
        ? {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
          }
        : undefined;

    this.client = new S3Client({
      region: options.region || "us-east-1",
      endpoint: options.endpoint,
      credentials,
      forcePathStyle: options.forcePathStyle ?? !!options.endpoint,
    });
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err: unknown) {
      if (
        (err as { name?: string }).name === "NotFound" ||
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw err;
    }
  }

  async get(key: string): Promise<Readable | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      if (!response.Body) return null;
      return response.Body as unknown as Readable;
    } catch (err: unknown) {
      if (
        (err as { name?: string }).name === "NoSuchKey" ||
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const stream = await this.get(key);
    if (!stream) return null;

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async put(key: string, data: Readable | Buffer, _sizeBytes?: number): Promise<StoragePutResult> {
    let bodyBuffer: Buffer;
    if (Buffer.isBuffer(data)) {
      bodyBuffer = data;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      bodyBuffer = Buffer.concat(chunks);
    }

    const sha256 = crypto.createHash("sha256").update(bodyBuffer).digest("hex");

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bodyBuffer,
        ContentLength: bodyBuffer.length,
        ContentType: "application/octet-stream",
      }),
    );

    return {
      sizeBytes: bodyBuffer.length,
      sha256,
    };
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string): Promise<ArtifactStat> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return {
        exists: true,
        sizeBytes: res.ContentLength,
        lastModified: res.LastModified,
        etag: res.ETag,
      };
    } catch {
      return { exists: false };
    }
  }

  async listKeys(prefix = ""): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      if (res.Contents) {
        for (const item of res.Contents) {
          if (item.Key) keys.push(item.Key);
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  async prune(beforeDate: Date): Promise<StoragePruneResult> {
    let deletedCount = 0;
    let freedBytes = 0;
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          ContinuationToken: continuationToken,
        }),
      );

      if (res.Contents) {
        for (const item of res.Contents) {
          if (item.Key && item.LastModified && item.LastModified < beforeDate) {
            await this.delete(item.Key);
            deletedCount++;
            freedBytes += item.Size || 0;
          }
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    return { deletedCount, freedBytes };
  }

  async getPresignedGetUrl(key: string, options?: PresignedUrlOptions): Promise<string | null> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await getSignedUrl(this.client, command, {
      expiresIn: options?.expiresInSeconds || 900,
    });
  }

  async getPresignedPutUrl(key: string, options?: PresignedUrlOptions): Promise<string | null> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options?.contentType || "application/octet-stream",
      ContentLength: options?.sizeBytes,
    });
    return await getSignedUrl(this.client, command, {
      expiresIn: options?.expiresInSeconds || 900,
    });
  }
}
