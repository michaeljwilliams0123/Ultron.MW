-- Owner-only encrypted credential/session vault and council App registry.
-- Values are AES-256-GCM blobs sealed with the ULTRON_VAULT_KEY secret.
CREATE TABLE IF NOT EXISTS owner_vault (
  k TEXT PRIMARY KEY,
  blob TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
