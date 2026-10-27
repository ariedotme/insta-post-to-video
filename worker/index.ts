import { handleApi } from '../server/instagram';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await handleApi(request)) ?? env.ASSETS.fetch(request);
  },
};
