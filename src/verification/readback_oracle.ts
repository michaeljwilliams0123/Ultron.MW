/** TypeScript interface for the Node ESM oracle. The live runtime is .mjs. */
export interface StateAssertion {
  checkType: 'http_status' | 'dom_element_present' | 'github_api_readback' | 'database_readback';
  targetEndpointOrSelector: string;
  expectedValue: string | number | boolean;
  expectedField?: 'state' | 'merged' | 'sha' | 'head.sha' | 'object.sha' |
    'conclusion' | 'status' | 'id' | 'number';
  allowedOrigin?: string;
  correlationKey?: string;
}
export interface ExternalEffectObservation {
  ok: boolean;
  tier: 'transport-only' | 'dom-only' | 'provider-state' | 'unknown';
  reason: string;
}
export interface OracleServices {
  fetcher?: typeof fetch;
  allowedOrigins?: string[];
  githubToken?: string;
  domReadback?: (input: { selector: string; origin: string }) => Promise<{
    present: boolean; visible: boolean; origin: string; text?: string }>;
  databaseReadback?: (input: {resource: string; correlationKey: string}) => Promise<Record<string, unknown>>;
  signal?: AbortSignal;
}
export interface OracleReporter {
  write: (event: Record<string, unknown>) => Promise<{ok: boolean}>;
  read: (attemptId: string) => Promise<Record<string, unknown> | null>;
}
export {observeExternalEffect,verifyExternalEffect,verifyAndReportExternalEffect} from './readback_oracle.mjs';
