/**
 * Resolves a public Instagram post into its images and author.
 *
 * Written against the standard Fetch API only, so the same code runs in the Vite dev server (Node)
 * and in the Cloudflare Worker.
 */

export interface PostImage {
  url: string;
  width: number | null;
  height: number | null;
  /** The item is a video; `url` is its cover frame. */
  video: boolean;
}

export interface Post {
  shortcode: string;
  username: string;
  avatar: string | null;
  images: PostImage[];
}

export class PostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Accepts post, reel and tv links (with or without the username segment), or a bare shortcode. */
export function parseShortcode(input: string): string | null {
  const text = input.trim();
  const fromUrl = text.match(/(?:instagram\.com|instagr\.am)\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]{5,})/i);
  if (fromUrl) return fromUrl[1];
  return /^[\w-]{5,}$/.test(text) ? text : null;
}

// Instagram serves the post's data in the page itself to search crawlers;
// regular browsers get an empty shell that loads it with a logged-in API.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html',
};

export async function fetchPost(shortcode: string): Promise<Post> {
  let response: Response;
  try {
    response = await fetch(`https://www.instagram.com/p/${shortcode}/`, { headers: HEADERS, redirect: 'follow' });
  } catch {
    throw new PostError('Could not reach Instagram. Try again in a moment.', 502);
  }
  if (response.status === 404) throw new PostError('This post does not exist or was removed.', 404);
  if (response.status === 429 || response.status === 401) {
    throw new PostError('Instagram is limiting requests right now. Try again in a few minutes.', 429);
  }
  if (!response.ok) throw new PostError(`Instagram answered with an error (${response.status}).`, 502);

  const media = findMedia(await response.text(), shortcode);
  if (!media) {
    throw new PostError(
      'Could not read this post. It may be private or age-restricted. You can still add the images manually.',
      422,
    );
  }

  const items: Media[] = media.carousel_media?.length ? media.carousel_media : [media];
  const images = items.flatMap((item): PostImage[] => {
    const best = bestCandidate(item.image_versions2?.candidates ?? []);
    if (!best) return [];
    return [
      {
        url: best.url,
        width: best.width ?? item.original_width ?? null,
        height: best.height ?? item.original_height ?? null,
        video: item.media_type === 2,
      },
    ];
  });
  if (!images.length) throw new PostError('This post has no images.', 422);

  const user = media.user!;
  return {
    shortcode,
    username: user.username,
    avatar: user.hd_profile_pic_url_info?.url ?? user.profile_pic_url ?? null,
    images,
  };
}

interface Candidate {
  url: string;
  width?: number;
  height?: number;
}

interface Media {
  code?: string;
  media_type?: number;
  original_width?: number;
  original_height?: number;
  image_versions2?: { candidates?: Candidate[] };
  carousel_media?: Media[];
  user?: { username: string; profile_pic_url?: string; hd_profile_pic_url_info?: { url: string } };
}

/** The page embeds dozens of JSON blobs (including related posts); find the one for this post. */
function findMedia(html: string, shortcode: string): Media | null {
  const scripts = html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g);
  for (const [, json] of scripts) {
    if (!json.includes(`"${shortcode}"`)) continue;
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      continue;
    }
    const found = walk(data, shortcode);
    if (found) return found;
  }
  return null;
}

function walk(value: unknown, shortcode: string): Media | null {
  if (!value || typeof value !== 'object') return null;
  const media = value as Media;
  if (media.code === shortcode && media.user?.username && (media.carousel_media || media.image_versions2)) {
    return media;
  }
  for (const child of Object.values(value)) {
    const found = walk(child, shortcode);
    if (found) return found;
  }
  return null;
}

/** Candidates usually come largest first, but sizes are sometimes missing, so prefer explicit widths. */
function bestCandidate(candidates: Candidate[]): Candidate | undefined {
  return candidates.reduce<Candidate | undefined>(
    (best, c) => (!best || (c.width ?? 0) > (best.width ?? 0) ? c : best),
    undefined,
  );
}

// Short-lived per-instance cache, so retries and repeated loads don't hit Instagram again.
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map<string, { post: Post; expires: number }>();

/** Handles `/api/*` requests; returns `null` for anything else. */
export async function handleApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (url.pathname !== '/api/post') return json({ error: 'Not found.' }, 404);

  const shortcode = parseShortcode(url.searchParams.get('url') ?? '');
  if (!shortcode) return json({ error: 'That doesn’t look like an Instagram post link.' }, 400);

  const hit = cache.get(shortcode);
  if (hit && hit.expires > Date.now()) return json(hit.post, 200);

  try {
    const post = await fetchPost(shortcode);
    cache.set(shortcode, { post, expires: Date.now() + CACHE_TTL });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return json(post, 200);
  } catch (error) {
    if (error instanceof PostError) return json({ error: error.message }, error.status);
    return json({ error: 'Something went wrong while reading the post.' }, 500);
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'private, max-age=600' : 'no-store',
    },
  });
}
