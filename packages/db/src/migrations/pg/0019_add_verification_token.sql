-- Add verification_token column to dns_zones for persistent DNS verification instructions
ALTER TABLE dns_zones ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255);
