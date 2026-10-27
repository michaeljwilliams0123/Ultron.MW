import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateUploadFile, MAX_BROWSER_FILE_BYTES } from './file-transfer.mjs';

const SAFE_FIELD = /^[a-z0-9_.-]{1,80}$/i;
const MAX_WIRE_BYTES = MAX_BROWSER_FILE_BYTES + 32 * 1024;

/**
 * Rebuild ONLY one explicitly selected, owner-approved file in Chromium's
 * redacted multipart postDataBuffer. Playwright's route.fetch otherwise
 * transmits an empty file. route.continue is forbidden because redirects
 * bypass subsequent route allowlist interception.
 *
 * The bridge is one-use, memory-only and scoped to an approved browser Page.
 * No file bytes are persisted to checkpoints or logged.
 */
export function createBoundedMultipartBridge() {
  const approved = new WeakMap();
  const active = new Set();
  const knownPages = new WeakSet();
  return Object.freeze({
    registerPage(page) {
      if (!page || typeof page !== 'object') throw Error('Known browser page required');
      knownPages.add(page);
    },
    mustBlockRequest(page, request) {
      if (!active.size) return false;
      // Only preallocated trusted pages may make unarmed requests. Popups and
      // unknown frames stay blocked when any approved file remains readable.
      if (!page || !knownPages.has(page)) return true;
      const state = approved.get(page);
      if (!state) return false;
      if (!state.submitApproved || state.consumed) return true;
      let target;
      try { target = new URL(request.url()); } catch { return true; }
      const type = String(request.headers?.()['content-type'] || '').toLowerCase();
      return target.origin !== state.destinationOrigin ||
        request.method?.() !== 'POST' || !request.isNavigationRequest?.() ||
        !type.startsWith('multipart/form-data');
    },
    arm(page, file, root, fieldName) {
      if (!page || !file || !SAFE_FIELD.test(fieldName || '') ||
          !file.path || !file.sha256 || !file.name)
        throw Error('Approved upload must bind a named file input and SHA-256');
      if (!knownPages.has(page)) throw Error('Upload page must be preallocated');
      approved.set(page, { file, root, fieldName, submitApproved: false });
      active.add(page);
    },
    approveSubmit(page, destinationOrigin = null) {
      const state = approved.get(page);
      if (state) {
        const expected = destinationOrigin || new URL(page.url()).origin;
        const target = new URL(expected);
        if (!['https:','http:'].includes(target.protocol) ||
            target.origin !== expected)
          throw Error('File upload recipient origin must be explicit');
        state.destinationOrigin = target.origin;
        state.submitApproved = true;
      }
    },
    async rehydrate(request) {
      const page = request.frame().page();
      const state = approved.get(page);
      // Only one send is admitted. Keep the selected-file page fenced after
      // the POST until the isolated browser context is closed.
      if (!state || state.consumed) throw Error('Approved multipart upload already consumed');
      state.consumed = true;
      if (!state.submitApproved ||
          new URL(request.url()).origin !== state.destinationOrigin ||
          request.method() !== 'POST' || !request.isNavigationRequest())
        throw Error('Multipart form not bound to an owner-approved submit');
      const fresh = await validateUploadFile(state.file.path, state.root);
      if (fresh.sha256 !== state.file.sha256 || fresh.name !== state.file.name ||
          fresh.bytes !== state.file.bytes)
        throw Error('Approved file changed after selection');
      const contentType = String(request.headers()['content-type'] || '');
      const m = /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
      if (!m) throw Error('Multipart boundary is invalid');
      const boundary = m[1] || m[2];
      if (!/^[\w'+().,_-]{10,80}$/.test(boundary))
        throw Error('Multipart boundary outside known format');
      const original = request.postDataBuffer();
      if (!Buffer.isBuffer(original) || original.length < 1 ||
          original.length > 32768)
        throw Error('Unexpected file-backed multipart metadata');
      const source = original.toString('latin1');
      const filenames = [...source.matchAll(/filename="([^"\r\n]+)"/g)];
      if (filenames.length !== 1 || filenames[0][1] !== fresh.name)
        throw Error('Expected exactly one approved filename in multipart form');
      const start = source.lastIndexOf('--' + boundary, filenames[0].index);
      const headerIndex = source.indexOf('\r\n\r\n', filenames[0].index);
      if (start < 0 || headerIndex < 0 || headerIndex - filenames[0].index > 512)
        throw Error('Multipart field header structure invalid');
      const partHeaders = source.slice(start, headerIndex);
      if (!partHeaders.includes('name="' + state.fieldName + '"'))
        throw Error('Upload field identity does not match approved input');
      const dataStart = headerIndex + 4;
      // Chromium Playwright omits file bytes from its captured postDataBuffer.
      // Do not silently replace a non-empty or ambiguous part.
      if (!source.startsWith('\r\n--' + boundary, dataStart))
        throw Error('Browser multipart part is not an empty file placeholder');
      const contents = await readFile(fresh.path);
      if (contents.length !== fresh.bytes) throw Error('Approved file size drift');
      if (createHash('sha256').update(contents).digest('hex') !== fresh.sha256)
        throw Error('Approved file contents changed after selection');
      const outbound = Buffer.concat([
        original.subarray(0, dataStart), contents, original.subarray(dataStart),
      ]);
      if (outbound.length > MAX_WIRE_BYTES)
        throw Error('Upload exceeds bounded wire size');
      return outbound;
    },
  });
}
