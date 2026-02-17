import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer | null {
  const hex = process.env['ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns `iv:ciphertext:tag` in base64.
 * If no ENCRYPTION_KEY is set, returns the plaintext unchanged (dev mode).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
}

/**
 * Decrypt a string encrypted by `encrypt()`.
 * If the input doesn't look encrypted (no colons / not base64), returns it as-is.
 * This provides a transparent migration path for existing plaintext values.
 */
export function decrypt(encrypted: string): string {
  const key = getKey();
  if (!key) return encrypted;

  const parts = encrypted.split(':');
  if (parts.length !== 3) return encrypted;

  try {
    const iv = Buffer.from(parts[0]!, 'base64');
    const ciphertext = Buffer.from(parts[1]!, 'base64');
    const tag = Buffer.from(parts[2]!, 'base64');

    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) return encrypted;

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Not encrypted or corrupted — return as-is (migration path)
    return encrypted;
  }
}
