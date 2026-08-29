import { z } from "zod";

export const settingPreviewSchema = z.object({ value: z.unknown(), expectedVersion: z.number().int().min(0), reason: z.string().trim().min(1).max(500) }).strict();
export const settingConfirmSchema = settingPreviewSchema.extend({ previewToken: z.string().length(64), confirm: z.literal(true) }).strict();
export const calendarPreviewSchema = z.object({ dayType: z.enum(["WORKDAY", "HOLIDAY"]), name: z.string().trim().max(100).nullable().optional(), expectedVersion: z.number().int().min(0), reason: z.string().trim().min(1).max(500) }).strict();
export const calendarConfirmSchema = calendarPreviewSchema.extend({ previewToken: z.string().length(64), confirm: z.literal(true) }).strict();
export const manualBackupSchema = z.object({ reason: z.string().trim().min(1).max(500), confirm: z.literal(true) }).strict();
export const restorePreviewSchema = z.object({ backupRecordId: z.uuid(), reason: z.string().trim().min(1).max(500) }).strict();
export const restoreConfirmSchema = z.object({ restoreRequestId: z.uuid(), expectedPreviewVersion: z.number().int().positive(), typedConfirmation: z.string().max(100), confirm: z.literal(true) }).strict();
export const restoreCompleteSchema = z.object({ manualCheckConfirmed: z.literal(true), reason: z.string().trim().min(1).max(500), confirm: z.literal(true) }).strict();
export const aiConfigSchema = z.object({ capability: z.string().trim().min(1).max(100), provider: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(100), retentionPolicy: z.enum(["NONE", "MINIMAL", "PROVIDER_DEFAULT"]), maxRetentionDays: z.number().int().min(0).max(3650).nullable().optional(), trainingOptOut: z.boolean(), secretRef: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,190}$/).nullable().optional(), expectedVersion: z.number().int().min(0), reason: z.string().trim().min(1).max(500) }).strict();
export const aiActivateSchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(500), confirm: z.literal(true) }).strict();
