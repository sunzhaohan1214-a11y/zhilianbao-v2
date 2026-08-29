type AttachmentScanState = { scanStatus: string };

export async function waitForAttachmentScan(
  readState: () => Promise<AttachmentScanState>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const state = await readState();
    if (state.scanStatus === "PASSED") return;
    if (["REJECTED", "FAILED"].includes(state.scanStatus)) {
      throw new Error("文件安全扫描未通过");
    }
    if (Date.now() >= deadline) throw new Error("文件安全扫描尚未完成，请稍后重试");
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(deadline - Date.now(), 0))));
  }
}
