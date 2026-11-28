# Windows Native Browser Host Packaging & Enrollment

This package provides the Windows native messaging executable wrapper, Chromium host manifest (`com.ultron.browser.json`), and explicit device enrollment flow for PR #565 (`native-browser-transport.mjs`) and PR #566 (`browser-extension/ultron-native/`).

## Packaging (No Registry or Browser Side Effects)

```sh
node scripts/package-native-browser-host.mjs package <new-absolute-directory> chrome-extension://<32-char-id>/
```

Outputs in `<new-absolute-directory>`:
- `ultron-native-host.cmd`: Windows stdio wrapper invoking Node with `ultron-native-host.mjs` and `"%~1"` (the extension origin passed by Chromium).
- `ultron-native-host.mjs`: Loads `host-config.json`, `host-private.pem`, and `enrollments.json`, enforces `callerOrigin === config.extensionOrigin` and active enrollment, and runs `serveNativeBrowserPort` backed by `createDurableWebReadWorker`.
- `com.ultron.browser.json`: Chromium native messaging manifest with `type: "stdio"`, `path` pointing to `ultron-native-host.cmd`, and `allowed_origins: [extensionOrigin]`.
- `pairing-info.json`: Public pairing metadata (`hostId`, `extensionOrigin`, `hostPublicKey`, `fingerprint`) for pasting into the PR #566 extension popup.
- `host-private.pem`: Owner-local Ed25519 private key (never exported or shared).
- `enrollments.json`: Initially `[]`; devices must be explicitly enrolled.

## Device Enrollment

1. Load the PR #566 extension (`scripts/package-native-browser-extension.mjs`) and paste `pairing-info.json` values into the popup to generate a nonextractable device key and public enrollment JSON.
2. Save the public enrollment JSON and enroll it on the trusted host:

```sh
node scripts/package-native-browser-host.mjs enroll <pkg-dir> <enrollment.json>
```

## Manual Windows Registry Registration (Owner-Triggered Only)

Packaging never modifies the Windows Registry or Chrome/Edge profiles. After reviewing `com.ultron.browser.json`, an owner can register it for the current user with:

```powershell
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ultron.browser" /ve /t REG_SZ /d "<manifestPath>" /f
```

## Verification

Run isolated packaging, enrollment, and `.cmd` stdio round-trip tests (using PGlite and an isolated test adapter):

```sh
node --test test/native-browser-host-package.test.mjs
```
