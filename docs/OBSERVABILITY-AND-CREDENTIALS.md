# Autonomy telemetry and provider authority

Ultron writes a bounded execution observation to GitHub Actions summaries and can optionally send it to Datadog Logs HTTP Intake. The live provider integration is opt-in and cannot be claimed until confirmed.

- Owner PR comments yield event kind 'pr-execution', intent, status, PR number, SHA and verification outcome.
- The existing hourly self-scan supplies 'ci-heartbeat' summaries from the latest current-main workflow runs; GitHub scheduled execution is best effort, not an always-on daemon.
- Model output, PR comment content, code, stack traces, credential values and authorization headers are not included.
- Datadog sending is disabled by default. Set the GitHub Actions secret ULTRON_DATADOG_API_KEY, Actions variable ULTRON_ENABLE_DATADOG=1, and optionally ULTRON_DATADOG_SITE (allowlisted).
- Provider readiness can be inspected using an owner PR comment: @ultron credentials datadog. Also supports github and huggingface.
- Datadog log ingestion, indexing, dashboard or alert delivery is not verified merely by a configured secret or passing unit test. Native GitHub evidence remains accessible with no Datadog connection.
- Datadog ingestion may consume a paid plan's allowances; do not enable without account and budget approval.

Actual third-party OAuth grants and API keys require authorization from the relevant account provider. Ultron can use approved scopes through runtime secrets; it cannot fabricate credentials or authorize an external account on its own.

Datadog API reference: https://docs.datadoghq.com/api/latest/logs/send-logs/
