import { z } from "zod";
import { LEGACY_ENTITY_TYPES, type LegacyEntityType, type LegacyRecord, type MigrationPreviewIssue } from "./types";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceId = z.string().trim().min(1).max(191);
const dateTime = z.iso.datetime({ offset: true });

export const REFERENCE_PACKAGE_SCHEMA_VERSION = "v1-package-reference-1" as const;
export const REFERENCE_PACKAGE_ADAPTER = "V1_REFERENCE_PACKAGE" as const;
export const REFERENCE_EXPORT_CLASSIFICATION = "REFERENCE_EXPORT_NOT_FINAL" as const;
export const SNAPSHOT_SOURCE_CLASSIFICATIONS = [
  "CONTROLLED_FULL_SNAPSHOT",
  "SANITIZED_FIXTURE",
  "CONTROLLED_EXPORT",
  REFERENCE_EXPORT_CLASSIFICATION,
] as const;
export type SnapshotSourceClassification = typeof SNAPSHOT_SOURCE_CLASSIFICATIONS[number];

const governanceIssuesSchema = z.object({
  path: z.literal("governance/manual-review.ndjson"),
  count: z.number().int().nonnegative(),
  sha256,
}).strict();

export const snapshotManifestSchema = z.object({
  sourceSystem: z.literal("ZHILIANBAO_V1"),
  schemaVersion: z.string().trim().min(1).max(100),
  snapshotId: z.string().trim().min(1).max(191),
  snapshotAt: dateTime,
  exportedAt: dateTime,
  isSanitized: z.boolean(),
  snapshotKind: z.enum(["SAMPLE", "FULL"]),
  mappingVersion: z.string().trim().min(1).max(100),
  sourceAdapter: z.enum(["STANDARD_SNAPSHOT", REFERENCE_PACKAGE_ADAPTER]).optional(),
  sourceClassification: z.enum(SNAPSHOT_SOURCE_CLASSIFICATIONS).optional(),
  applyEligible: z.boolean().optional(),
  fullRehearsalEligible: z.boolean().optional(),
  governanceIssues: governanceIssuesSchema.optional(),
  files: z.record(z.string(), z.object({ count: z.number().int().nonnegative(), sha256 }).strict()),
  entities: z.record(z.enum(LEGACY_ENTITY_TYPES), z.number().int().nonnegative()),
}).strict().superRefine((manifest, context) => {
  const referenceMarked = manifest.schemaVersion === REFERENCE_PACKAGE_SCHEMA_VERSION
    || manifest.sourceAdapter === REFERENCE_PACKAGE_ADAPTER
    || manifest.sourceClassification === REFERENCE_EXPORT_CLASSIFICATION;

  if (referenceMarked) {
    if (manifest.schemaVersion !== REFERENCE_PACKAGE_SCHEMA_VERSION) {
      context.addIssue({ code: "custom", path: ["schemaVersion"], message: "reference adapter schema version is immutable" });
    }
    if (manifest.sourceAdapter !== REFERENCE_PACKAGE_ADAPTER) {
      context.addIssue({ code: "custom", path: ["sourceAdapter"], message: "reference adapter identity is required" });
    }
    if (manifest.sourceClassification !== REFERENCE_EXPORT_CLASSIFICATION) {
      context.addIssue({ code: "custom", path: ["sourceClassification"], message: "reference export classification is required" });
    }
    if (manifest.applyEligible !== false) {
      context.addIssue({ code: "custom", path: ["applyEligible"], message: "reference export is not authorized for apply" });
    }
    if (manifest.fullRehearsalEligible !== false) {
      context.addIssue({ code: "custom", path: ["fullRehearsalEligible"], message: "reference export is not eligible for FULL rehearsal" });
    }
    if (manifest.snapshotKind !== "SAMPLE") {
      context.addIssue({ code: "custom", path: ["snapshotKind"], message: "reference export cannot be upgraded to FULL" });
    }
    if (!manifest.governanceIssues) {
      context.addIssue({ code: "custom", path: ["governanceIssues"], message: "reference export governance issues are required" });
    }
  }

  if (manifest.snapshotKind === "FULL" && manifest.fullRehearsalEligible === false) {
    context.addIssue({ code: "custom", path: ["fullRehearsalEligible"], message: "FULL snapshot must be explicitly eligible" });
  }
  if (manifest.governanceIssues) {
    const file = manifest.files[manifest.governanceIssues.path];
    if (!file || file.count !== manifest.governanceIssues.count || file.sha256 !== manifest.governanceIssues.sha256) {
      context.addIssue({ code: "custom", path: ["governanceIssues"], message: "governance issue pointer must match the verified file manifest" });
    }
  }
});

export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;

export function isReferencePackageManifest(manifest: SnapshotManifest): boolean {
  return manifest.schemaVersion === REFERENCE_PACKAGE_SCHEMA_VERSION
    || manifest.sourceAdapter === REFERENCE_PACKAGE_ADAPTER
    || manifest.sourceClassification === REFENCE_EXPORT_CLASSIFICATION;
}

export function isReferenceOnlySnapshot(
  manifest: Pick<SnapshotManifest, "schemaVersion" | "sourceAdapter" | "sourceClassification">,
): boolean {
  return manifest.schemaVersion === REFERENCE_PACKAGE_SCHEMA_VERSION
    || manifest.sourceAdapter === REFERENCE_PACKAGE_ADAPTER
    || manifest.sourceClassification === REFENCE_EXPORT_CLASSIFICATION;
}

export function manifestAllowsApply(manifest: SnapshotManifest): boolean {
  return !isReferencePackageManifest(manifest) && manifest.applyEligible !== false;
}

export function manifestAllowsFullRehearsal(manifest: SnapshotManifest): boolean {
  return manifest.snapshotKind === "FULL"
    && !isReferencePackageManifest(manifest)
    && manifest.fullRehearsalEligible !== false;
}
6öç7B&6RÒ²6÷W&6T–BÂ6÷W&6UWFFVDC¢FFUF–ÖRæ÷F–öæÂ‚’Ó°¦6öç7B66†VÖ2Ò°¢õ$tä•¤D”ôã¢¢æö&¦V7B‡²ââæ&6RÂæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’Â÷&væ—¦F–öåG—S¢¢æVçVÒ…²%Dõtå4„•"Â$DU%DÔTåB"Â$D•5D4…õTä•B"Â%õ5EõTä•B%Ò’Â7FGW3¢¢æVçVÒ…²$5D•dR"Â$”ä5D•dR%Ò’æFVfVÇB‚$5D•dR"’Ò’ç7G&–7B‚’À¢U%4ôã¢¢æö&¦V7B‡²ââæ&6RÂæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒƒ’Â†öæS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ3’æ÷F–öæÂ‚’ÂÖVÖ&W$¶–æC¢¢æVçVÒ…²$5U%$TåB"Â$ÅTÔä•õÄDdõ$Ò"Â$ÅTÔä•ô„•5Dõ$”4Â"Â$”åDU$äÅõ5Ddb"Â$eUEU$UôÔTÔ$U%ô4äD”DDR%Ò’Â7W'&VçDV×Æ÷–ÖVçD6öæf—&ÖVC¢¢æ&ööÆVâ‚’æFVfVÇB†fÇ6R’Â66÷VçDVÆ–v–&ÆS¢¢æ&ööÆVâ‚’æFVfVÇB†fÇ6R’Â&F6„æÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ’æ÷F–öæÂ‚’Â7F'DFFS¢¢æ—6òæFFR‚’æ÷F–öæÂ‚’ÂVæDFFS¢¢æ—6òæFFR‚’æ÷F–öæÂ‚’Ò’ç7G&–7B‚’À¢TåDU%$•4S¢¢æö&¦V7B‡²ââæ&6RÂæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’Â&W7öç6–&ÆT&VæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’ÂFG&W73¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒS’Â7&VF—D6öFS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ3"’æ÷F–öæÂ‚’ÂÆVvÅ&W&W6VçFF—fS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒƒ’æ÷F–öæÂ‚’Â–çG&öGV7F–öã¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒS’æ÷F–öæÂ‚’ÂÖ–å&öGV7G3¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒS’ÂVÆ–f–6F–öç4†öæ÷'3¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒS’æ÷F–öæÂ‚’ÂÆF—GVFS¢¢æçVÖ&W"‚’æÖ–â‚Ó“’æÖ‚ƒ“’æ÷F–öæÂ‚’ÂÆöæv—GVFS¢¢æçVÖ&W"‚’æÖ–â‚Óƒ’æÖ‚ƒƒ’æ÷F–öæÂ‚’Â6öçF7DæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒƒ’æ÷F–öæÂ‚’Â6öçF7E†öæS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ3’æ÷F–öæÂ‚’Â&–Ö'”6öçF7D6öæf—&ÖVC¢¢æ&ööÆVâ‚’æFVfVÇB†fÇ6R’ÂÆVv7•FtæÖW3¢¢æ'&’‡¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ’’æÖ‚ƒ’æ÷F–öæÂ‚’Ò’ç7G&–7B‚’À¢DÄTåC¢¢æö&¦V7B‡²ââæ&6RÂæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒƒ’Â÷&væ—¦F–öäæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’Â&öfW76–öæÄF—&V7F–öã¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ’ÂF—FÆS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’Â66÷UG—S¢¢æVçVÒ…²$DôÔU5D”2"Â$õdU%4T2%Ò’æFVfVÇB‚$DôÔU5D”2"’Â&V6öÖÖVæFW%6÷W&6T–C¢6÷W&6T–Bæ÷F–öæÂ‚’Â&W7VÖUFW‡D6öçF7DFWFV7FVC¢¢æ&ööÆVâ‚’æFVfVÇB†fÇ6R’Ò’ç7G&–7B‚’À¢ôÄ”5“¢¢æö&¦V7B‡²ââæ&6RÂF—FÆS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ3’ÂV&Æ—6†–ætFW'FÖVçC¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’ÂV&Æ—6†VDFFS¢¢æ—6òæFFR‚’Â&–Ö'”f–ÆU6†#Sc¢6†#SbÂ7FGW3¢¢æVçVÒ…²$5D•dR"Â%t•D„E$tâ"Â%$UÄ4TB%Ò’æFVfVÇB‚$5D•dR"’Ò’ç7G&–7B‚’À¢DTÔäC¢¢æö&¦V7B‡²ââæ&6RÂF—FÆS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ3’ÂFW67&—F–öã¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’ÂVçFW'&—6U6÷W&6T–C¢6÷W&6T–BÂ6öçF7DæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒƒ’æ÷F–öæÂ‚’Â6öçF7E†öæS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ3’æ÷F–öæÂ‚’ÂÆVv7•7FGW3¢¢æVçVÒ…².[è^ZûhêR"Â.[{.ZûhêR"Â.[{.Šz>Xk2%Ò’ÂÆVv7•G—S¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ’æ÷F–öæÂ‚’Â÷væW%W'6öå6÷W&6T–C¢6÷W&6T–Bæ÷F–öæÂ‚’Â&öw&W73¢¢æ'&’‡¢æö&¦V7B‡²6÷W&6T–BÂ6öçFVçC¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒS’Âö67W'&VDC¢FFUF–ÖRÂ7F÷%W'6öå6÷W&6T–C¢6÷W&6T–Bæ÷F–öæÂ‚’Ò’ç7G&–7B‚’’æFVfVÇB…µÒ’Ò’ç7G&–7B‚’À¢$U4Tä4S¢¢æö&¦V7B‡²ââæ&6RÂW'6öå6÷W&6T–C¢6÷W&6T–BÂ'&—fVDC¢FFUF–ÖRÂFW'FVDC¢FFUF–ÖRæ÷F–öæÂ‚’Âæ÷FS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ’æ÷F–öæÂ‚’Ò’ç7G&–7B‚’À¢E$•¢¢æö&¦V7B‡²ââæ&6RÂF—FÆS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ3’Âö67W'&VDC¢FFUF–ÖRÂ'F–6—çE6÷W&6T–G3¢¢æ'&’‡6÷W&6T–B’æÖ–âƒ’Â7F&ÆUc$æöFW3¢¢æ&ööÆVâ‚’æFVfVÇB†fÇ6R’Â†—7F÷&–6Å7VÖÖ'“¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒS’æ÷F–öæÂ‚’Ò’ç7G&–7B‚’À¢d•4•C¢¢æö&¦V7B‡²ââæ&6RÂVçFW'&—6U6÷W&6T–C¢6÷W&6T–BÂö67W'&VDC¢FFUF–ÖRÂ7VÖÖ'“¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒS’Ò’ç7G&–7B‚’À¢$T”Ô%U%4TÔTåC¢¢æö&¦V7B‡²ââæ&6RÂÆ–6çEW'6öå6÷W&6T–C¢6÷W&6T–BÂG—S¢¢æVçVÒ…²%E$dTÂ"Â$5D•d•E’%Ò’Â&V6öã¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’ÂÆVv7•7FGW3¢¢æVçVÒ…².ZêjKŠÒ"Â.[{.˜Y¹â"Â.[{.˜	®‹ør%Ò’ÂF÷FÄÖ÷VçC¢¢ç7G&–ær‚’ç&VvW‚‚õåÆB²ƒó¥ÂåÆG³Ã'Ò“òBò’Ò’ç7G&–7B‚’À¢„TÅ¢¢æö&¦V7B‡²ââæ&6RÂ7V&Ö—GFW%W'6öå6÷W&6T–C¢6÷W&6T–BÂF—FÆS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’ÂFW67&—F–öã¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’ÂÆVv7”6FVv÷'“¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ’Â7FGW3¢¢æVçVÒ…².[è^Xù~yb"Â.ZHNynKŠÒ"Â.[{.X©î{¹2%Ò’æFVfVÇB‚.[è^Xù~yb"’Â&W7VÇC¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒS’æ÷F–öæÂ‚’Ò’ç7G&–7B‚’À¢ääõTä4TÔTåC¢¢æö&¦V7B‡²ââæ&6RÂF—FÆS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ3’Â&öG“¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒS’ÂV&Æ—6†VDC¢FFUF–ÖRæ÷F–öæÂ‚’Â†5&VÆ–&ÆT6öæf—&ÖF–öç3¢¢æ&ööÆVâ‚’æFVfVÇB†fÇ6R’Ò’ç7G&–7B‚’À¢$ôÄS¢¢æö&¦V7B‡²ââæ&6RÂW'6öå6÷W&6T–C¢6÷W&6T–BÂ&öÆT6öFS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ’ÂWf–FVæ6S¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ’æ÷F–öæÂ‚’ÂW‡Æ–6—FÇ”VF—F&ÆS¢¢æ&ööÆVâ‚’æFVfVÇB†fÇ6R’Ò’ç7G&–7B‚’À§Ò26öç7B6F—6f–W2&V6÷&CÄÆVv7”VçF—G•G—RÂ¢å¦öEG—Sã° ¦W‡÷'BG—RÆVv7•–ÆöCÅBW‡FVæG2ÆVv7”VçF—G•G—RÒÆVv7”VçF—G•G—SâÒ¢æ–æfW#Â‡G—Vöb66†VÖ2•µEÓã° ¦W‡÷'BgVæ7F–öâfÆ–FFTÆVv7•–ÆöB†VçF—G•G—S¢ÆVv7”VçF—G•G—RÂfÇVS¢Væ¶æ÷vâ“¢²&V6÷&Có¢ÆVv7•&V6÷&C²—77VW3¢Ö–w&F–öå&Wf–Wt—77VUµÒÒ°¢6öç7B'6VBÒ66†VÖ5¶VçF—G•G—UÒç6fU'6R‡fÇVR“°¢–b‡'6VBç7V66W72’&WGW&â²&V6÷&C¢²6÷W&6T–C¢‡'6VBæFF2²6÷W&6T–C¢7G&–ærÒ’ç6÷W&6T–BÂVçF—G•G—RÂ–ÆöC¢'6VBæFF2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâÒÂ—77VW3¢µÒÓ°¢6öç7BfÆÆ&6´–BÒG—VöbfÇVRÓÓÒ&ö&¦V7B"bbfÇVRbb'6÷W&6T–B"–âfÇVRò7G&–ær‚‡fÇVR2²6÷W&6T–C¢Væ¶æ÷vâÒ’ç6÷W&6T–B’¢%Tä´äõtâ#°¢6öç7B—77VW3¢Ö–w&F–öå&Wf–Wt—77VUµÒÒ'6VBæW'&÷"æ—77VW2æÖ‚‡fÆ–FF–öä—77VR’Óâ‡°¢6÷W&6TVçF—G“¢VçF—G•G—RÀ¢6÷W&6T–C¢fÆÆ&6´–BÀ¢6öFS¢fÆ–FF–öä—77VRæ6öFRÓÓÒ'Vç&V6övæ—¦VEö¶W—2"ò%TäÔTEõ4õU$4Uôd”TÄB"¢$Ô”u$D”ôåõ4õU$4Uô”ådÄ”B"À¢6WfW&—G“¢fÆ–FF–öä—77VRæ6öFRÓÓÒ'Vç&V6övæ—¦VEö¶W—2"ò%$Ud”Ur"¢$$Äô4´U""À¢f–VÆC¢fÆ–FF–öä—77VRçF‚æ¦ö–â‚"â"’ÇÂVæFVf–æVBÀ¢ÖW76vS¢fÆ–FF–öä—77VRæÖW76vRÀ¢6÷W&6U6æ6†÷C¢G—VöbfÇVRÓÓÒ&ö&¦V7B"bbfÇVRòfÇVR2&V6÷&CÇ7G&–ærÂVæ¶æ÷vãâ¢VæFVf–æVBÀ¢Ò’“°¢&WGW&â²—77VW2Ó°§Ğ ¦W‡÷'B6öç7BÖ–w&F–öå6÷W&6T—77VU66†VÖÒ¢æö&¦V7B‡°¢6÷W&6TVçF—G“¢¢çVæ–öâ…·¢æVçVÒ„ÄTt5•ôTåD•E•õE•U2’Â¢æÆ—FW&Â‚$ED4„ÔTåB"’Â¢æÆ—FW&Â‚%4ä4„õB"•Ò’À¢6÷W&6T–BÀ¢6öFS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ“’À¢6WfW&—G“¢¢æVçVÒ…²%t$ä”är"Â%$Ud”Ur"Â$$Äô4´U"%Ò’À¢f–VÆC¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒS’æ÷F–öæÂ‚’À¢ÖW76vS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#’À¢6æF–FFW3¢¢æ'&’‡¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ“’’æÖ‚ƒ’æ÷F–öæÂ‚’À§Ò’ç7G&–7B‚“° ¦W‡÷'B6öç7BÖ–w&F–öäv÷fW&ææ6T—77VU66†VÖÒÖ–w&F–öå6÷W&6T—77VU66†VÖ°¦W‡÷'BG—RÖ–w&F–öäv÷fW&ææ6T—77VRÒ¢æ–æfW#ÇG—VöbÖ–w&F–öå6÷W&6T—77VU66†VÖã° ¦W‡÷'B6öç7BGF6†ÖVçDÖæ–fW7E&V6÷&E66†VÖÒ¢æö&¦V7B‡°¢6÷W&6TGF6†ÖVçD–C¢6÷W&6T–BÀ¢6÷W&6TVçF—G“¢¢æVçVÒ„ÄTt5•ôTåD•E•õE•U2’À¢6÷W&6T–BÀ¢&VÆF—fUFƒ¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒS’À¢6†#SbÀ¢6—¦S¢¢æçVÖ&W"‚’æ–çB‚’ææöææVvF—fR‚’À¢÷&–v–æÄf–ÆVæÖS¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ#SR’À¢FV6Æ&VDÖ–ÖUG—S¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ“’À§Ò’ç7G&–7B‚“° ¦W‡÷'BG—RÆVv7”GF6†ÖVçDÖæ–fW7E&V6÷&BÒ¢æ–æfW#ÇG—VöbGF6†ÖVçDÖæ–fW7E&V6÷&E66†VÖã° ¦W‡÷'B6öç7BÖ–w&F–öå&W6öÇWF–öäf–ÆU66†VÖÒ¢æö&¦V7B‡°¢fW'6–öã¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ’À¢&W6öÇWF–öç3¢¢æ'&’‡¢æö&¦V7B‡°¢6÷W&6TVçF—G“¢¢æVçVÒ„ÄTt5•ôTåD•E•õE•U2’Â6÷W&6T–BÂ7F–öã¢¢æVçVÒ…²$Ä”ä²"Â$5$TDR"Â%4´•"Â%t•dR%Ò’À¢F&vWDVçF—G“¢¢ç7G&–ær‚’çG&–Ò‚’æÖ‚ƒ’æ÷F–öæÂ‚’ÂF&vWD–C¢¢çWV–B‚’æ÷F–öæÂ‚’Â&V6öã¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒS’Â÷W&F÷#¢¢ç7G&–ær‚’çG&–Ò‚’æÖ–âƒ’æÖ‚ƒ’À¢Ò’ç7G&–7B‚’’À§Ò’ç7G&–7B‚“°