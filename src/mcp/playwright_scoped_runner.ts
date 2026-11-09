/**
 * Typed entrypoint for the repository's Node-native, node:test-covered runner.
 * The repository intentionally uses .mjs runtime modules and has no TS build
 * pipeline; keep the executable security implementation in the sibling .mjs.
 */
import {runScopedBrowserTask as run, validateScopedBrowserInput as validate,
  parseOriginBoundStorageState as parseState} from './playwright_scoped_runner.mjs';

export interface BrowserExecutionParams {
  targetUrl: string;
  /** Canonical HTTPS origin; HTTP permitted only on loopback for tests. */
  allowedOrigin: string;
  /** Accessible role+exact name, e.g. role=button[name="Save"], or label=Email. */
  actionSelector: string;
  actionType: 'click' | 'fill';
  fillValue?: string;
}
export interface BrowserExecutionResult {
  /** UI interaction dispatched; NOT proof of persisted provider state. */
  success: boolean;
  finalUrl: string;
}
export interface ScopedBrowserHost {
  /** Must be backed by a trusted owner-issued action-specific grant. */
  authorizeAction(metadata: Readonly<Omit<BrowserExecutionParams,'fillValue'>> & {origin:string}): Promise<boolean>;
  validateSession?(page: unknown, origin:string): Promise<boolean>;
  revokeSession?(origin:string): Promise<void>;
  persistSession?(origin:string, state:unknown): Promise<void>;
  /** Host-injected browser for trusted workers or tests. */
  chromium?: unknown;
}
export const validateScopedBrowserInput: (params:BrowserExecutionParams)=>unknown=validate;
export const parseOriginBoundStorageState: (json:string|undefined,origin:string)=>unknown=parseState;
export async function runScopedBrowserTask(
  params:BrowserExecutionParams,
  storageStateJson?:string,
  host?:ScopedBrowserHost,
):Promise<BrowserExecutionResult> {
  return run(params,storageStateJson,host);
}
