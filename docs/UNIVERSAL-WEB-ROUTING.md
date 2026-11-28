# Universal web read routing (#559)

The first UWIF increment is a protocol-neutral **read-only selector** over the existing capability broker. The host registers verified provider bindings with exact origins, account identity and operation scopes. Selection order is OpenAPI, GraphQL, MCP, WebMCP, BiDi, CDP, Playwright, semantic UI. Only absence of an operation permits selecting the next candidate; an unavailable or non-ready binding, denied scope, foreign identity or origin, write operation or paid binding stops selection. No browser code, network traffic, credential minting or execution is performed by this selector. The trusted caller must still dispatch through the existing broker and existing authorization and durable receipt machinery. Selection is not production acceptance.

The host must supply the candidate inventory from trusted configuration, not from page text or tool results. Actual browser adapters, live session authorization, normalized data delivery, scheduler binding and cross-browser conformance remain future acceptance steps. Keep existing Chrome/OS organization policy and browser consent intact. No new runtime dependency or paid provider.

Primary references: https://www.w3.org/TR/webdriver-bidi/ ; https://developer.chrome.com/docs/devtools/agents/get-started/configuration/ ; https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy .

### Read result delivery
A trusted local composition can supply authorizeResult alongside authorizeRead.
Only a fresh completed read with independent provider observation, a JSON
payload at most 20,000 UTF-8 bytes, and current approval for disclosure returns
data marked untrusted-provider-data. The default remains receipt-only.
Replayed requests and durable receipts expose digests only; a lost response
does not permit redispatch or recover the original payload. Do not copy raw
webpage data into the shared Drive ledger or treat page text as instructions.
This is an in-process consumer contract, not a native messaging transport,
device pairing, or production scheduler binding.
