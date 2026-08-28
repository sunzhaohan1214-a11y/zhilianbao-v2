const MAINLAND_MOBILE = /^1\d{10}$/;
const CREDIT_CODE = /^[0-9A-Z]{15,32}$/;

export function normalizeComparableText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

export function normalizeEnterpriseName(value: string): string {
  return normalizeComparableText(value).replace(/[（）()]/g, "").replace(/\s+/g, "");
}

export function normalizeImportPhone(value: string): string {
  return value.trim();
}

export function isValidMainlandPhone(value: string): boolean {
  return MAINLAND_MOBILE.test(value);
}

export function normalizeCreditCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidCreditCode(value: string): boolean {
  return CREDIT_CODE.test(value);
}
