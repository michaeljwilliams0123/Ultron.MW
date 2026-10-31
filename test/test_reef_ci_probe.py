import unittest
from scripts.reef_ci_probe import build_report, validate_upstream_response

SHA = "a" * 40

class ReefProbeContractTests(unittest.TestCase):
    def test_verified_runtime_receipt_never_grants_merge_permission(self):
        report = build_report(
            source_sha=SHA, reef_version="0.1.3",
            inference_receipt="0123456789abcdef0123456789abcdef",
            feedback_receipt="abcdef0123456789abcdef0123456789",
            release_count=1,
        )
        self.assertEqual(report["schema"], "ultron.reef-runtime-probe.v1")
        self.assertTrue(report["runtimeVerified"])
        self.assertTrue(report["feedbackVerified"])
        self.assertFalse(report["candidateEvaluated"])
        self.assertFalse(report["eligibleForMerge"])
        self.assertEqual(report["sourceSha"], SHA)
        self.assertNotIn("credential", str(report).lower())
        self.assertNotIn("token", str(report).lower())

    def test_missing_receipt_or_release_does_not_pass(self):
        valid = dict(
            source_sha=SHA, reef_version="0.1.3",
            inference_receipt="record-12345678",
            feedback_receipt="record-23456789", release_count=1,
        )
        for key, value in [
            ("source_sha", "main"), ("reef_version", ""),
            ("inference_receipt", ""), ("feedback_receipt", None),
            ("release_count", 0),
        ]:
            with self.subTest(key=key):
                invalid = {**valid, key: value}
                with self.assertRaises(ValueError):
                    build_report(**invalid)

    def test_upstream_must_return_exact_fixture_marker(self):
        response = {
            "choices": [{"message": {"role": "assistant", "content": "REEF_CI_FIXTURE_OK"}}]
        }
        self.assertTrue(validate_upstream_response(response))
        with self.assertRaises(ValueError):
            validate_upstream_response({"choices": [{"message": {"content": "wrong"}}]})
        with self.assertRaises(ValueError):
            validate_upstream_response({})

if __name__ == "__main__":
    unittest.main()
