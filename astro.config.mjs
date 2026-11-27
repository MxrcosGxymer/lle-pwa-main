// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

let commitSha = 'unknown';
try {
  commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // Not a git checkout (e.g. a source archive) — fall back to a generic label.
}

// https://astro.build/config
export default defineConfig({
  output: 'server',

  vite: {
    plugins: [tailwindcss()],
    define: {
      __BUILD_SHA__: JSON.stringify(commitSha)
    }
  },

  security: {
    checkOrigin: true
  },

  integrations: [react()],

  adapter: cloudflare()
});
