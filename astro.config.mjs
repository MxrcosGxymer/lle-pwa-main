// @ts-check
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

const isVercel =
  process.env.VERCEL === '1' ||
  process.env.VERCEL === 'true' ||
  process.env.DEPLOY_TARGET === 'vercel';

/** @returns {any} */
function vercelRuntimePlugin() {
  const source = fileURLToPath(new URL('./src/lib/runtime.ts', import.meta.url)).replace(/\\/g, '/');
  const target = fileURLToPath(new URL('./src/lib/runtime.vercel.ts', import.meta.url));
  return {
    name: 'lle-vercel-runtime',
    enforce: 'pre',
    /**
     * @param {string} id
     * @param {string | undefined} importer
     * @param {Record<string, unknown>} options
     */
    async resolveId(id, importer, options) {
      if (!importer) return null;
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
      if (resolved && resolved.id.replace(/\\/g, '/') === source) {
        return target;
      }
      return null;
    },
  };
}

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
    plugins: [tailwindcss(), ...(isVercel ? [vercelRuntimePlugin()] : [])],
    define: {
      __BUILD_SHA__: JSON.stringify(commitSha)
    }
  },

  security: {
    checkOrigin: true
  },

  integrations: [react()],

  adapter: isVercel ? vercel() : cloudflare()
});
