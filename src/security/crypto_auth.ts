/**
 * TypeScript-facing contract for the runnable Node ES module.
 * The repository executes .mjs directly (no TypeScript build toolchain).
 */
export interface ScopedApprovalPayload {
  toolName: string;
  targetResource: string;
  timestamp: number;
  nonce: string;
}

export interface AtomicNonceStore {
  consume(value: ScopedApprovalPayload): Promise<boolean>;
}

export {
  verifyCryptographicApproval,
  createSignedGitHubAuthority,
  createScopedInstallationTokenProvider,
} from './crypto_auth.mjs';
export {createPostgresApprovalNonceStore} from './crypto_auth.mjs';
