import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const originMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/origin", () => ({ assertTrustedMutationOrigin: originMock }));

import { POST } from "@/app/api/v2/attachments/[id]/abort/route";

describe("attachment abort observability", () => {
  beforeEach(() => { originMock.mockReset(); vi.restoreAllMocks(); });

  it("records the safe failure stage without attachment data", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    originMock.mockImplementation(() => { throw Object.assign(new Error("private-name.pdf object/private-key"), { code: "ORIGIN_REJECTED" }); });
    const response = await POST(new NextRequest("https://app.example/api/v2/attachments/a/abort", { method: "POST" }), { params: Promise.resolve({ id: "a" }) });
    expect(response.status).toBe(500);
    const entries = output.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(entries).toHaveLength(1);
    expect(entries).toContainEqual(expect.objectContaining({ result: "abort_failed", stage: "origin_validation", errorCode: "ORIGIN_REJECTED" }));
    expect(JSON.stringify(entries)).not.toContain("private-name.pdf");
    expect(JSON.stringify(entries)).not.toContain("object/private-key");
  });
});
