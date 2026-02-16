import { createHash } from 'node:crypto';

export class SshService {
  /**
   * Validate an SSH public key format.
   * Supports ssh-rsa, ssh-ed25519, ecdsa-sha2-* formats.
   */
  validateKey(publicKey: string): { valid: boolean; error?: string } {
    const trimmed = publicKey.trim();
    const parts = trimmed.split(/\s+/);

    if (parts.length < 2) {
      return { valid: false, error: 'Invalid SSH key format: expected at least type and key data' };
    }

    const keyType = parts[0]!;
    const validTypes = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-dss'];

    if (!validTypes.includes(keyType)) {
      return { valid: false, error: `Unsupported key type: ${keyType}` };
    }

    const keyData = parts[1]!;
    try {
      const decoded = Buffer.from(keyData, 'base64');
      if (decoded.length < 16) {
        return { valid: false, error: 'Key data too short' };
      }
    } catch {
      return { valid: false, error: 'Invalid base64 key data' };
    }

    return { valid: true };
  }

  /**
   * Generate the SHA-256 fingerprint for an SSH public key.
   * Returns in the format: SHA256:base64hash
   */
  generateFingerprint(publicKey: string): string {
    const parts = publicKey.trim().split(/\s+/);
    const keyData = parts[1] ?? '';
    const decoded = Buffer.from(keyData, 'base64');
    const hash = createHash('sha256').update(decoded).digest('base64');
    // Remove trailing = padding to match ssh-keygen format
    return `SHA256:${hash.replace(/=+$/, '')}`;
  }

  /**
   * Check if an IP address matches an allowed CIDR range.
   */
  isIpAllowed(ip: string, allowedCidrs: string[]): boolean {
    if (allowedCidrs.length === 0) return true; // No restrictions = allow all

    for (const cidr of allowedCidrs) {
      if (this.matchCidr(ip, cidr)) return true;
    }

    return false;
  }

  private matchCidr(ip: string, cidr: string): boolean {
    // Handle exact IP match
    if (!cidr.includes('/')) {
      return ip === cidr;
    }

    const [network, prefixStr] = cidr.split('/');
    if (!network || !prefixStr) return false;
    const prefix = parseInt(prefixStr, 10);

    // IPv4 only for now
    const ipNum = this.ipToNumber(ip);
    const networkNum = this.ipToNumber(network);

    if (ipNum === null || networkNum === null) return false;

    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (networkNum & mask);
  }

  private ipToNumber(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;

    let num = 0;
    for (const part of parts) {
      const val = parseInt(part, 10);
      if (isNaN(val) || val < 0 || val > 255) return null;
      num = (num << 8) | val;
    }

    return num >>> 0;
  }
}

export const sshService = new SshService();
