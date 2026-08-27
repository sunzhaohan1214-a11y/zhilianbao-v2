import type { Prisma } from "@/generated/prisma/client";

export class AttachmentRecoveryService {
  async recoverStaleScan(tx: Prisma.TransactionClient, attachmentId: string): Promise<boolean> {
    const result = await tx.attachment.updateMany({
      where: { id: attachmentId, uploadStatus: "UPLOADED", scanStatus: "SCANNING" },
      data: { scanStatus: "FAILED", scanReason: "STALE_SCAN_RECOVERED" },
    });
    return result.count === 1;
  }
}
