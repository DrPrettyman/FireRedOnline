// Starts one Vite dev server for the whole e2e run (the hooks in src/dev/testHooks.ts are dev-only).
// Set E2E_BASE_URL to reuse a server you already have running (e.g. `npm run dev`).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const root = resolve(__dirname, '../..');
  if (!existsSync(resolve(root, 'public/gen/constants.json'))) throw new Error('public/gen is missing: run `npm run extract` first.');

  const external = process.env.E2E_BASE_URL;
  if (external) {
    project.provide('baseUrl', external.replace(/\/$/, ''));
    return async () => {};
  }

  // No HMR or file watching: editing a source file mid-run must not reload the pages under test.
  const server: ViteDevServer = await createServer({
    root,
    configFile: false,
    logLevel: 'warn',
    server: { port: 5190, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite did not report a URL');
  project.provide('baseUrl', url.replace(/\/$/, ''));
  return async () => {
    await server.close();
  };
}
