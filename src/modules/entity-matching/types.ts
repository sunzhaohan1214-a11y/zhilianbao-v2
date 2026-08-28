export type MatchIssue = {
  code: string;
  field?: string;
  severity: "ERROR" | "WARNING" | "REVIEW";
  message: string;
  candidateIds?: string[];
};

export type EntityMatchResult = {
  kind: "CREATE" | "EXACT" | "REVIEW" | "INVALID";
  matchedEntityId?: string;
  candidateIds: string[];
  issues: MatchIssue[];
};
