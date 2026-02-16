// ---------------------------------------------------------------------------
// SSH types
// ---------------------------------------------------------------------------

export interface SshKey {
  id: string;
  userId: string;
  name: string;
  publicKey: string;
  fingerprint: string;
}

export interface SshAccessRule {
  id: string;
  serviceId: string;
  allowedIps: string[];
  enabled: boolean;
}

export interface CreateSshKeyInput {
  name: string;
  publicKey: string;
}
