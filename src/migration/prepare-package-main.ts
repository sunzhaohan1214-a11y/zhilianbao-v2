import path from "node:path";
import { prepareV1DataPackage } from "@/modules/migration/v1-package-adapter";

function parseArgs(argv: string[]): { source: string; output: string } {
  let source: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value !== "--source" && value !== "--output") throw new Error(`V1_PACKAGE_ARGUMENT_UNKNOWN:${value}`);
    const next = argv[index + 1];
    if (!next) throw new Error(`V1_PACKAGE_ARGUMENT_MISSING:${value}`);
    index += 1;
    if (value === "--source") source = next;
    else output = next;
  }
  if (!source || !output) throw new Error("V1_PACKAGE_ARGUMENTS_INVALID");
  return { source: path.resolve(source), output: path.resolve(output) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await prepareV1DataPackage({ sourceRoot: options.source, outputRoot: options.output });
  console.info(JSON.stringify({
    status: "PREPARED_REFERENCE_BUNDLE",
    sourceClassification: result.sourceClassification,
    checksumVerifiedFileCount: result.checksumVerifiedFileCount,
    entities: result.entities,
    attachmentCount: result.attachmentCount,
    manualReviewCount: result.manualReviewCount,
    mapCandidateCount: result.mapCandidateCount,
    dispatchLocationCandidateCount: result.dispatchLocationCandidateCount,
    dispatchLocationMatchPreviewCount: result.dispatchLocationMatchPreviewCount,
    outputRoot: result.outputRoot,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ errorCode: error instanceof Error ? error.message.split(":")[0] : "V1_PACKAGE_PREPARATION_FAILED" }));
  process.exitCode = 1;
});
