/**
 * Advisory Council evidence calibration from trusted main-only GitHub readback.
 * This metric never supplies release authority; seven role/model attestations,
 * independent review, and owner signatures remain enforced by the release gate.
 * PR prose, including its length, is intentionally not an input.
 */
export function scoreCouncilEvidenceCoverage({
  isPr = false,
  securitySensitive = false,
  reviewEvidence = null,
  fileEvidence = null,
  sourceSha = '',
  prNumber = 0,
} = {}) {
  // Preserve the existing sensitive-path hold even with otherwise green CI.
  if (securitySensitive) return 0.35;
  // Non-PR planning does not use a PR check-run inventory.
  if (!isPr) return 0.9;

  // Both independently fetched inputs must refer to the same exact PR head.
  const exactHeadChecks = reviewEvidence?.verified === true &&
    reviewEvidence?.sourceSha === sourceSha &&
    reviewEvidence?.prNumber === prNumber &&
    reviewEvidence?.baseUpToDate === true;
  const fullFiles = fileEvidence?.complete === true &&
    fileEvidence?.sourceSha === sourceSha &&
    fileEvidence?.prNumber === prNumber &&
    Array.isArray(fileEvidence?.files) &&
    fileEvidence.files.length > 0 &&
    fileEvidence.files.every(file =>
      file && typeof file.filename === 'string' && file.filename.length > 0 &&
      typeof file.patch === 'string' && file.patch.length > 0
    );

  // Missing, stale, failed or partial inputs seek evidence; no prose fallback.
  return exactHeadChecks && fullFiles ? 0.9 : 0.45;
}
