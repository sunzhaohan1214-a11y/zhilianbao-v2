import CvmRoleCredential from "tencentcloud-sdk-nodejs-common/tencentcloud/common/cvm_role_credential.js";
import { ssm } from "tencentcloud-sdk-nodejs-ssm";

const CvmRoleCredentialConstructor = (
  CvmRoleCredential as unknown as { default?: typeof CvmRoleCredential }
).default ?? CvmRoleCredential;

export const RUNTIME_SECRET_KEYS = [
  "DATABASE_URL",
  "AUTH_RATE_LIMIT_SECRET",
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
] as const;

type RuntimeSecretKey = (typeof RUNTIME_SECRET_KEYS)[number];
export type RuntimeSecretValues = Record<RuntimeSecretKey, string>;

type SsmReader = {
  GetSecretValue(input: { SecretName: string; VersionId: string }): Promise<{ SecretString?: string }>;
};

export function parseRuntimeSecret(secretString: string): RuntimeSecretValues {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    throw new Error("RUNTIME_SECRET_JSON_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("RUNTIME_SECRET_OBJECT_REQUIRED");
  }

  const values = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(values).filter((key) => !RUNTIME_SECRET_KEYS.includes(key as RuntimeSecretKey));
  if (unknownKeys.length > 0) throw new Error("RUNTIME_SECRET_UNKNOWN_KEY");
  for (const key of RUNTIME_SECRET_KEYS) {
    if (typeof values[key] !== "string" || values[key].trim().length === 0) {
      throw new Error(`RUNTIME_SECRET_${key}_REQUIRED`);
    }
  }
  return Object.fromEntries(RUNTIME_SECRET_KEYS.map((key) => [key, values[key]])) as RuntimeSecretValues;
}

export function applyRuntimeSecret(
  environment: NodeJS.ProcessEnv,
  values: RuntimeSecretValues,
): void {
  for (const key of RUNTIME_SECRET_KEYS) environment[key] = values[key];
}

export async function loadRuntimeSecret(
  environment: NodeJS.ProcessEnv = process.env,
  reader?: SsmReader,
): Promise<void> {
  const secretName = environment.ZLB_RUNTIME_SECRET_NAME?.trim();
  const region = environment.ZLB_RUNTIME_SECRET_REGION?.trim();
  const versionId = environment.ZLB_RUNTIME_SECRET_VERSION?.trim();
  if (!secretName) throw new Error("RUNTIME_SECRET_NAME_REQUIRED");
  if (!region) throw new Error("RUNTIME_SECRET_REGION_REQUIRED");
  if (!versionId) throw new Error("RUNTIME_SECRET_VERSION_REQUIRED");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(versionId)) {
    throw new Error("RUNTIME_SECRET_VERSION_INVALID");
  }

  const client = reader ?? new ssm.v20190923.Client({
    credential: new CvmRoleCredentialConstructor(),
    region,
    profile: { httpProfile: { reqMethod: "POST", reqTimeout: 10 } },
  });
  const response = await client.GetSecretValue({ SecretName: secretName, VersionId: versionId });
  if (!response.SecretString) throw new Error("RUNTIME_SECRET_VALUE_REQUIRED");
  applyRuntimeSecret(environment, parseRuntimeSecret(response.SecretString));
}
