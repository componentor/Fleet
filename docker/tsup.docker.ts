import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  noExternal: ['@fleet/db', '@fleet/types'],
  external: ['@aws-sdk/client-s3', '@google-cloud/storage'],
});
