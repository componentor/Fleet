// ---------------------------------------------------------------------------
// API Key types
// ---------------------------------------------------------------------------

export interface ApiKey {
  id: string;
  accountId: string;
  createdBy: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: Date;
}
