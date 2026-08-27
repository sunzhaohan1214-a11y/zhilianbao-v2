import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { AttachmentError } from "./attachment-errors";

export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENT_FILENAME_LENGTH = 255;

const DECLARED_MIME_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  pdf: ["application/pdf"],
  doc: ["application/msword", "application/octet-stream"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  heic: ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence", "application/octet-stream"],
  heif: ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence", "application/octet-stream"],
};

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "ps1", "sh", "apk", "msi", "jar", "html", "htm", "js", "mjs", "cjs",
]);

export type NormalizedFileInput = {
  originalFilename: string;
  extension: string;
  declaredMimeType: string;
  expectedSizeBytes: number;
};

export type DetectedAttachmentType = {
  extension: "pdf" | "doc" | "docx" | "xls" | "xlsx" | "jpg" | "png" | "heic" | "heif";
  mimeType: string;
};

export function normalizeFilename(value: string): string {
  const leaf = value.normalize("NFKC").split(/[\\/]/).at(-1)?.trim() ?? "";
  const normalized = leaf.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new AttachmentError("ATTACHMENT_INVALID_INPUT", "文件名不正确");
  }
  if (normalized.length > MAX_ATTACHMENT_FILENAME_LENGTH) {
    throw new AttachmentError("ATTACHMENT_INVALID_INPUT", "文件名过长");
  }
  return normalized;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 || dot === filename.length - 1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function normalizeDeclaredMimeType(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

export function validateIntentFile(input: {
  filename: string;
  declaredMimeType: string;
  expectedSizeBytes: number;
}): NormalizedFileInput {
  const originalFilename = normalizeFilename(input.filename);
  const extension = extensionOf(originalFilename);
  if (BLOCKED_EXTENSIONS.has(extension) || !DECLARED_MIME_BY_EXTENSION[extension]) {
    throw new AttachmentError("ATTACHMENT_TYPE_UNSUPPORTED", "不支持此文件类型");
  }
  const declaredMimeType = normalizeDeclaredMimeType(input.declaredMimeType);
  if (!DECLARED_MIME_BY_EXTENSION[extension].includes(declaredMimeType)) {
    throw new AttachmentError("ATTACHMENT_TYPE_UNSUPPORTED", "文件扩展名与声明类型不匹配");
  }
  if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes < 1) {
    throw new AttachmentError("ATTACHMENT_INVALID_INPUT", "文件大小必须大于 0");
  }
  if (input.expectedSizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new AttachmentError("ATTACHMENT_TOO_LARGE", "单个附件不能超过 50MB");
  }
  return { originalFilename, extension, declaredMimeType, expectedSizeBytes: input.expectedSizeBytes };
}

function containsUtf16DirectoryName(buffer: Uint8Array, name: string): boolean {
  return Buffer.from(buffer).includes(Buffer.from(`${name}\u0000`, "utf16le"));
}

function detectLegacyOffice(buffer: Uint8Array): DetectedAttachmentType | null {
  const signature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (!Buffer.from(buffer.subarray(0, signature.length)).equals(signature)) return null;
  if (containsUtf16DirectoryName(buffer, "WordDocument")) {
    return { extension: "doc", mimeType: "application/msword" };
  }
  if (containsUtf16DirectoryName(buffer, "Workbook") || containsUtf16DirectoryName(buffer, "Book")) {
    return { extension: "xls", mimeType: "application/vnd.ms-excel" };
  }
  return null;
}

export function hasExecutableSignature(buffer: Uint8Array): boolean {
  const prefix = Buffer.from(buffer.subarray(0, 512));
  if (prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a) return true;
  if (prefix.length >= 4 && prefix[0] === 0x7f && prefix.subarray(1, 4).toString("ascii") === "ELF") return true;
  const text = prefix.toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return text.startsWith("#!")
    || text.startsWith("<html")
    || text.startsWith("<!doctype html")
    || text.startsWith("<script")
    || text.startsWith("javascript:");
}

export async function detectAttachmentType(buffer: Uint8Array): Promise<DetectedAttachmentType | null> {
  if (hasExecutableSignature(buffer)) return null;
  const legacy = detectLegacyOffice(buffer);
  if (legacy) return legacy;
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return null;
  if (detected.ext === "jpeg" || detected.ext === "jpg") return { extension: "jpg", mimeType: "image/jpeg" };
  if (detected.ext === "png") return { extension: "png", mimeType: "image/png" };
  if (detected.ext === "pdf") return { extension: "pdf", mimeType: "application/pdf" };
  if (detected.ext === "docx") return { extension: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  if (detected.ext === "xlsx") return { extension: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (detected.ext === "heic") return { extension: "heic", mimeType: detected.mime };
  return null;
}

function extensionMatches(declared: string, detected: string): boolean {
  if ((declared === "jpg" || declared === "jpeg") && detected === "jpg") return true;
  if ((declared === "heic" || declared === "heif") && (detected === "heic" || detected === "heif")) return true;
  return declared === detected;
}

export async function inspectAttachmentContent(input: {
  buffer: Uint8Array;
  extension: string;
  declaredMimeType: string;
}): Promise<DetectedAttachmentType> {
  if (hasExecutableSignature(input.buffer)) {
    throw new AttachmentError("ATTACHMENT_TYPE_UNSUPPORTED", "文件未通过安全检查");
  }
  const detected = await detectAttachmentType(input.buffer);
  if (!detected || !extensionMatches(input.extension, detected.extension)) {
    throw new AttachmentError("ATTACHMENT_TYPE_UNSUPPORTED", "文件未通过安全检查");
  }
  const allowedDeclared = DECLARED_MIME_BY_EXTENSION[input.extension] ?? [];
  if (!allowedDeclared.includes(normalizeDeclaredMimeType(input.declaredMimeType))) {
    throw new AttachmentError("ATTACHMENT_TYPE_UNSUPPORTED", "文件未通过安全检查");
  }
  return detected;
}

export function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}
