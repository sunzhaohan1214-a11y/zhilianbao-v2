export function formatShanghaiDateTime(value: Date | string | number) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}
