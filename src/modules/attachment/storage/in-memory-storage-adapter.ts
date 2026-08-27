import type { StorageAdapter, StoredObjectHead, UploadAuthorization } from "./storage-adapter";

export class InMemoryStorageAdapter implements StorageAdapter {
  readonly bucket: string;
  readonly region: string;
  private readonly objects = new Map<string, Buffer>();

  constructor(input: { bucket?: string; region?: string } = {}) {
    this.bucket = input.bucket ?? "test-private-bucket-1250000000";
    this.region = input.region ?? "ap-test";
  }

  async createUploadAuthorization(input: { objectKey: string; expiresInSeconds: number }): Promise<UploadAuthorization> {
    const startTime = Math.floor(Date.now() / 1000);
    return {
      type: "TEST_MEMORY",
      credentials: {
        tmpSecretId: `test:${input.objectKey}`,
        tmpSecretKey: "test-only",
        sessionToken: "test-only",
        startTime,
        expiredTime: startTime + input.expiresInSeconds,
      },
    };
  }

  async headObject(objectKey: string): Promise<StoredObjectHead> {
    const body = this.objects.get(objectKey);
    return { exists: Boolean(body), sizeBytes: body?.byteLength ?? 0 };
  }

  async promoteObject(stagingObjectKey: string, finalObjectKey: string): Promise<StoredObjectHead> {
    const existing = this.objects.get(finalObjectKey);
    if (existing) {
      this.objects.delete(stagingObjectKey);
      return { exists: true, sizeBytes: existing.byteLength };
    }
    const staging = this.objects.get(stagingObjectKey);
    if (!staging) return { exists: false, sizeBytes: 0 };
    this.objects.set(finalObjectKey, Buffer.from(staging));
    this.objects.delete(stagingObjectKey);
    return { exists: true, sizeBytes: staging.byteLength };
  }

  async deleteObject(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  async readObject(objectKey: string): Promise<Buffer> {
    const body = this.objects.get(objectKey);
    if (!body) throw new Error("OBJECT_NOT_FOUND");
    return Buffer.from(body);
  }

  async createSignedGetUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(objectKey)) throw new Error("OBJECT_NOT_FOUND");
    return `https://memory.invalid/${encodeURIComponent(objectKey)}?expires=${expiresInSeconds}`;
  }

  putObjectForTest(objectKey: string, body: Uint8Array): void {
    this.objects.set(objectKey, Buffer.from(body));
  }

  getObjectForTest(objectKey: string): Buffer | undefined {
    const body = this.objects.get(objectKey);
    return body ? Buffer.from(body) : undefined;
  }

  clear(): void {
    this.objects.clear();
  }
}
