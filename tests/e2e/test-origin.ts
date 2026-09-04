const port = process.env.E2E_PORT?.trim() || "3000";
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
  throw new Error("E2E_PORT_INVALID");
}

export const e2eOrigin = `http://127.0.0.1:${port}`;
