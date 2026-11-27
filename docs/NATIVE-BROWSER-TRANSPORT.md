# Authenticated native browser transport (#559)

This is a bounded, one-request Chromium native messaging transport and
browser-side cryptographic peer. It composes the existing durable read worker;
it does not replace the existing desktop native-host admission prototype.

## Host and client

- Native messages are UTF-8 JSON with a native-endian 32-bit length prefix.
  Both directions use a 32 KiB limit and a 30-second frame-read deadline.
- Register exactly one extension origin in the generated Chromium host manifest.
  The browser-supplied caller origin is checked, but is not identity proof.
- Trusted local provisioning pins a host Ed25519 signing key and a distinct
  device public key. The client pins the host public key and uses a
  nonextractable Ed25519 device private CryptoKey. No key creation, transfer,
  enrollment, registry changes or persistence are performed by this module.
- Use a fresh native port for each request. The host emits a signed challenge;
  the browser-side client verifies it before separately authorizing and
  signing the exact read task. Both parties reconstruct fixed protocol field
  ordering; signatures are not dependent on JSON serializer property order.
- The host validates its challenge, identity, expiry, exact HTTPS origin,
  allowlisted path, actor, read operation, scope, idempotency key and $0 cost.
  A current owner authorization callback is required. One request consumes
  the port challenge; a fresh port requires a fresh challenge and signature.
- Dispatch goes through the supplied trusted durable web read worker. A host
  exception or unverifiable result is reconcile-required, not success. The
  signed response includes only bounded receipt metadata, not raw webpage
  data, cookies or credentials. No write operation, arbitrary JavaScript,
  shell action, network listener, or broad browser profile access is exposed.

## Local verification

Run node --test test/native-browser-transport.test.mjs. Tests cover forged
host or device messages, wrong extension, expiration, revocation, scope,
concurrent acceptance, malformed/fragmented frames, WebCrypto interoperability,
serializer reordering, durable worker recreation, and two actual Node host
subprocesses sharing an on-disk PGlite ledger. The subprocess test uses
ephemeral fixture keys, an isolated database, and a deterministic read adapter.
It verifies exactly one adapter dispatch and the same digest on the resumed
receipt. It is not a live browser or production PostgreSQL acceptance test.

## Remaining installation and production acceptance

An independently reviewed extension composition must call runtime.connectNative,
use approved site permissions, present exact owner consent, and securely
enroll nonextractable device keys. An owner-controlled native executable must
supply the trusted worker and policy, register its exact manifest, and
terminate after the exchange. No existing browser profile or registry has
been changed. Production needs revocable device enrollment, authenticated
outbound scheduler/task delivery, a scoped PostgreSQL service binding, real
browser access and independent effect evidence. PR #564 provides a separate
in-process result delivery proposal; this transport deliberately remains
receipt-only. Do not claim a production connection or enable unattended
browser execution until those steps are verified.

References:
https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging
