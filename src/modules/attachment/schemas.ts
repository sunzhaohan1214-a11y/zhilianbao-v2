import { z } from "zod";
import { MAX_ATTACHMENT_FILENAME_LENGTH, MAX_ATTACHMENT_SIZE_BYTES } from "./file-policy";

export const uploadIntentSchema = z.object({
  filename: z.string().min(1).max(MAX_ATTACHMENT_FILENAME_LENGTH),
  declaredMimeType: z.string().min(1).max(191),
  expectedSizeBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict();

export const accessActionSchema = z.enum(["preview", "download"]);

export const testUploadSchema = z.object({
  base64: z.string().min(1).max(Math.ceil(MAX_ATTACHMENT_SIZE_BYTES * 4 / 3) + 16),
}).strict();
