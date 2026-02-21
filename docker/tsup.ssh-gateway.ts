import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/ssh-gateway.ts'],
  format: ['esm'],
  noExternal: ['@fleet/db', '@fleet/types'],
  external: ['@aws-sdk/client-s3', '@google-cloud/storage'],
});
