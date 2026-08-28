export type UploadAuthorization = {
  type: "COS_STS" | "TEST_MEMORY";
  credentials: {
    tmpSecretId: string;
    tmpSecretKey: string;
    sessionToken: string;
    startTime: number;
    expiredTime: number;
  };
};

export type StoredObjectHead = {
  exists: boolean;
  sizeBytes: number;
};

export interface StorageAdapter {
  readonly bucket: string;
  readonly region: string;
  createUploadAuthorization(input: { objectKey: string; expiresInSeconds: number }): Promise<UploadAuthorization>;
  headObject(objectKey: string): Promise<StoredObjectHead>;
  promoteObject(stagingObjectKey: string, finalObjectKey: string): Promise<StoredObjectHead>;
  deleteObject(objectKey: string): Promise<void>;
  readObject(objectKey: string): Promise<Buffer>;
  writeObject(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  createSignedGetUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
}
