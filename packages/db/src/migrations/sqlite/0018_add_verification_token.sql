-- Add verification_token column to dns_zones for persistent DNS verification instructions
ALTER TABLE dns_zones ADD COLUMN verification_token TEXT;
