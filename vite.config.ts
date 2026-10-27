import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { handleApi } from './server/instagram';

/** Serves `/api/*` from the same handler the Cloudflare Worker uses, in `vite` and `vite preview`. */
function api(): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const response = await handleApi(new Request(new URL(req.url ?? '/', 'http://localhost')));
    if (!response) return next();
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: 'api',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  // Relative asset paths, so the build works from any subpath.
  base: './',
  plugins: [api()],
});
