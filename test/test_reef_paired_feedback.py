import unittest
from scripts.reef_paired_feedback import validate_pairs, build_receipt_report

A = "a" * 40
B = "b" * 40
DIGEST = "1" * 64

def fixture():
    rows = []
    for i in range(8):
        rows.append({
            "id": f"case-{i}", "split": "development" if i < 2 else "heldout",
            "critical": i >= 2,
            "baseline": {"score": 1, "status": "succeeded", "invariantsPassed": True},
            "candidate": {"score": 1, "status": "succeeded", "invariantsPassed": True},
        })
    return {
        "schema": "ultron.reef-paired-policy-benchmark.v1",
        "baseSha": A, "candidateSha": B,
        "baselineArtifactSha256": DIGEST, "candidateArtifactSha256": DIGEST,
        "caseManifestSha256": DIGEST, "caseResults": rows,
    }

def receipts(rows):
    return [{"caseId": row["id"], "variant": side,
             "inferenceReceipt": f"reef-infer-{row['id']}-{side}",
             "feedbackReceipt": f"reef-feed-{row['id']}-{side}"}
            for row in rows for side in ("baseline", "candidate")]

class PairedFeedbackEvidenceTest(unittest.TestCase):
    def test_complete_feedback_is_still_not_model_training_or_merge_approval(self):
        raw = fixture()
        result = build_receipt_report(raw, base_sha=A, head_sha=B,
            reef_version="0.1.3", receipts=receipts(raw["caseResults"]),
            trusted_evaluator=True, release_count=1)
        self.assertTrue(result["reefRuntimeVerified"])
        self.assertTrue(result["reefFeedbackVerified"])
        self.assertEqual(result["receiptCount"], 16)
        self.assertFalse(result["reefHarnessOptimized"])
        self.assertFalse(result["independentHeldoutCertified"])
        self.assertFalse(result["eligibleForMerge"])

    def test_missing_or_duplicate_receipts_never_complete_evaluation(self):
        raw = fixture()
        full = receipts(raw["caseResults"])
        for damaged in (full[:-1], full + [full[0]], full[1:] + [full[1]]):
            with self.assertRaises(ValueError):
                build_receipt_report(raw, base_sha=A, head_sha=B,
                    reef_version="0.1.3", receipts=damaged,
                    trusted_evaluator=True, release_count=1)

    def test_wrong_source_sha_or_incomplete_case_split_is_rejected(self):
        raw = fixture()
        with self.assertRaises(ValueError):
            validate_pairs(raw, A, "c" * 40)
        raw["caseResults"][0]["split"] = "heldout"
        raw["caseResults"][1]["split"] = "heldout"
        with self.assertRaises(ValueError):
            validate_pairs(raw, A, B)

    def test_failed_invariant_cannot_be_mislabeled_passed(self):
        raw = fixture()
        raw["caseResults"][2]["candidate"]["invariantsPassed"] = False
        with self.assertRaises(ValueError):
            validate_pairs(raw, A, B)

if __name__ == "__main__":
    unittest.main()
