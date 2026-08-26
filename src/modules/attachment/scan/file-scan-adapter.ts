export type FileScanResult = {
  clean: boolean;
  engine: string;
  signature?: string;
};

export interface FileScanAdapter {
  scan(input: { content: Buffer; filename: string; detectedMimeType: string }): Promise<FileScanResult>;
}

export class UnavailableFileScanAdapter implements FileScanAdapter {
  async scan(): Promise<FileScanResult> {
    throw new Error("FILE_SCANNER_UNAVAILABLE");
  }
}

export class FakeCleanScanner implements FileScanAdapter {
  async scan(): Promise<FileScanResult> {
    return { clean: true, engine: "fake-clean" };
  }
}

export class FakeMalwareScanner implements FileScanAdapter {
  constructor(private readonly signature = "TEST-MALWARE") {}

  async scan(): Promise<FileScanResult> {
    return { clean: false, engine: "fake-malware", signature: this.signature };
  }
}
