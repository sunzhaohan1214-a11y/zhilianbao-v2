export class MapError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly details?: Record<string, unknown>) { super(message); this.name = "MapError"; }
}
export function isMapError(error: unknown): error is MapError { return error instanceof MapError; }
