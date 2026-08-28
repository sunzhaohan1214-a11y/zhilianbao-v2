import type { ImportType } from "@/generated/prisma/client";
import type { MatchIssue } from "@/modules/entity-matching";

export type ImportFieldDefinition = {
  field: string;
  label: string;
  required: boolean;
  identity?: boolean;
  aliases: readonly string[];
  example: string;
  normalize?: (value: string) => string;
};

export type ImportColumnMapping = {
  sourceColumn: number;
  sourceHeader: string;
  targetField: string | null;
};

export type ImportMapping = {
  importType: ImportType;
  columns: ImportColumnMapping[];
  parameters?: Record<string, string>;
};

export type ParsedImportRow = {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: Record<string, string>;
  formulaFields: string[];
  issues: MatchIssue[];
};
