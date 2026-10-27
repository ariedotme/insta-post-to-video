import { parseShortcode, type Post } from '../server/instagram';
import { decodeImage, makeAvatar, makeBackdrop } from './media';
import { H, W, buildScene, drawFrame, slideAt, slideStart, type Scene, type Slide } from './scene';
import { DEFAULTS, loadSettings, normalizeHandle, sanitize, saveSettings, type Settings } from './settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  phone: $('phone'),
  preview: $<HTMLCanvasElement>('preview'),
  empty: $('empty'),
  play: $<HTMLButtonElement>('play'),
  scrub: $<HTMLInputElement>('scrub'),
  time: $('time'),
  showSafe: $<HTMLInputElement>('show-safe'),
  panel: $('panel'),
  postForm: $<HTMLFormElement>('post-form'),
  postUrl: $<HTMLInputElement>('post-url'),
  postLoad: $<HTMLButtonElement>('post-load'),
  slides: $<HTMLOListElement>('slides'),
  fileInput: $<HTMLInputElement>('file-input'),
  clear: $<HTMLButtonElement>('clear'),
  avatarInput: $<HTMLInputElement>('avatar-input'),
  avatarImg: $<HTMLImageElement>('avatar-img'),
  avatarRemove: $<HTMLButtonElement>('avatar-remove'),
  reset: $<HTMLButtonElement>('reset'),
  summary: $('summary'),
  warn: $('warn'),
  export: $<HTMLButtonElement>('export'),
  result: $('result'),
  download: $<HTMLAnchorElement>('download'),
  share: $<HTMLButtonElement>('share'),
  status: $('status'),
};
const settingInputs = [...document.querySelectorAll<HTMLInputElement>('[data-setting]')];

const settings: Settings = loadSettings();
let slides: Slide[] = [];
let avatar: { canvas: HTMLCanvasElement; url: string } | null = null;
let post: Post | null = null;
let scene: Scene = buildScene(slides, settings, null);

// ---------------------------------------------------------------------------
// Preview

const previewCtx = ui.preview.getContext('2d')!;
let time = 0;
let playing = false;
let lastTick = 0;
let drawQueued = false;

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(frame);
}

function frame(now: number) {
  drawQueued = false;
  if (playing) {
    time += Math.min(0.1, (now - lastTick) / 1000);
    if (time >= scene.total) time = 0;
    lastTick = now;
    requestDraw();
  }
  const { width, height } = ui.preview;
  previewCtx.setTransform(width / W, 0, 0, height / H, 0, 0);
  previewCtx.imageSmoothingQuality = 'high';
  drawFrame(previewCtx, scene, time);
  markCurrent(scene.slides.length ? slideAt(scene, time) : -1);
  ui.scrub.value = String(scene.total ? time / scene.total : 0);
  ui.time.textContent = `${formatTime(time)} / ${formatTime(scene.total)}`;
}

function setPlaying(value: boolean) {
  playing = value && scene.slides.length > 0;
  ui.play.classList.toggle('playing', playing);
  ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  lastTick = performance.now();
  requestDraw();
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

new ResizeObserver(([entry]) => {
  const box = entry.devicePixelContentBoxSize?.[0];
  const dpr = devicePixelRatio || 1;
  ui.preview.width = Math.min(W, box ? box.inlineSize : Math.round(entry.contentRect.width * dpr));
  ui.preview.height = Math.min(H, box ? box.blockSize : Math.round(entry.contentRect.height * dpr));
  requestDraw();
}).observe(ui.preview);

ui.play.addEventListener('click', () => setPlaying(!playing));
ui.scrub.addEventListener('input', () => {
  setPlaying(false);
  time = parseFloat(ui.scrub.value) * scene.total;
  requestDraw();
});
ui.showSafe.addEventListener('change', () => ui.phone.classList.toggle('show-safe', ui.showSafe.checked));
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (event.code !== 'Space' || target.closest('input, button, a, [role="button"], [contenteditable]')) return;
  event.preventDefault();
  setPlaying(!playing);
});

// ---------------------------------------------------------------------------
// Scene

/** Call after anything that affects the output. */
function update() {
  scene = buildScene(slides, settings, avatar?.canvas ?? null);
  time = Math.min(time, scene.total);
  if (!slides.length) setPlaying(false);

  const count = slides.length;
  ui.empty.hidden = count > 0;
  ui.clear.hidden = count === 0;
  ui.export.disabled = count === 0 || exporting !== null;
  ui.summary.textContent = count
    ? `${count} image${count > 1 ? 's' : ''} · ${scene.total.toFixed(1)} s · 1080×1920 · 30 fps`
    : 'Add at least one image to create a video.';
  ui.warn.hidden = scene.total <= 60;
  ui.warn.textContent = 'Stories longer than 60 s get split into several parts by Instagram.';

  clearResult();
  requestDraw();
}

// ---------------------------------------------------------------------------
// Settings

function syncInputs() {
  for (const input of settingInputs) {
    const value = settings[input.dataset.setting as keyof Settings];
    if (input.type === 'radio') input.checked = input.value === value;
    else if (input.type === 'checkbox') input.checked = value as boolean;
    else if (document.activeElement !== input) input.value = String(value);
  }
  for (const output of document.querySelectorAll<HTMLOutputElement>('output[data-for]')) {
    output.value = `${settings[output.dataset.for as keyof Settings]} ${output.dataset.unit}`;
  }
  // Hide controls that don't apply to the current choices.
  const visible: Record<string, boolean> = {
    'transition-on': settings.transition !== 'none',
    contain: settings.fit === 'contain',
    color: settings.background === 'color',
  };
  for (const el of document.querySelectorAll<HTMLElement>('[data-when]')) {
    el.hidden = !visible[el.dataset.when!];
  }
  for (const input of ui.slides.querySelectorAll('input')) input.placeholder = String(settings.slideDuration);
}

function setSetting<K extends keyof Settings>(key: K, raw: unknown) {
  settings[key] = sanitize(key, raw);
  saveSettings(settings);
  syncInputs();
  update();
}

for (const input of settingInputs) {
  const key = input.dataset.setting as keyof Settings;
  input.addEventListener('input', () => {
    if (input.type === 'radio' && !input.checked) return;
    if (input.type === 'number' && input.value === '') return; // mid-edit
    if (key === 'handle' && input.value.startsWith('@')) input.value = input.value.replace(/^@+/, ''); // "@" is shown as a prefix
    setSetting(key, input.type === 'checkbox' ? input.checked : input.value);
  });
  // Normalize the field (e.g. clamp numbers) once the user is done with it.
  input.addEventListener('change', () => {
    if (input.type === 'number' || input.type === 'text') input.value = String(settings[key]);
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-step]')) {
  button.addEventListener('click', () => {
    const input = button.parentElement!.querySelector('input')!;
    const key = input.dataset.setting as keyof Settings;
    setSetting(key, (settings[key] as number) + parseFloat(button.dataset.step!));
    input.value = String(settings[key]);
  });
}

ui.reset.addEventListener('click', () => {
  const handle = settings.handle; // Keep the identity; reset only the look.
  Object.assign(settings, DEFAULTS, { handle });
  saveSettings(settings);
  syncInputs();
  update();
});

// ---------------------------------------------------------------------------
// Avatar

async function setAvatar(source: Blob | null) {
  if (source === null) {
    avatar = null;
  } else {
    const image = await decodeImage(source);
    const canvas = makeAvatar(image);
    image.close();
    avatar = { canvas, url: canvas.toDataURL('image/jpeg', 0.9) };
  }
  ui.avatarImg.hidden = !avatar;
  ui.avatarRemove.hidden = !avatar;
  if (avatar) ui.avatarImg.src = avatar.url;
  update();
}

ui.avatarInput.addEventListener('change', async () => {
  const file = ui.avatarInput.files?.[0];
  ui.avatarInput.value = '';
  if (!file) return;
  try {
    await setAvatar(file);
  } catch {
    toast(`Couldn't read “${file.name}”.`);
  }
});

ui.avatarRemove.addEventListener('click', () => void setAvatar(null));

// ---------------------------------------------------------------------------
// Slides

let nextId = 1;

async function makeSlide(image: Blob, name: string): Promise<Slide> {
  const bitmap = await decodeImage(image);
  return {
    id: String(nextId++),
    name,
    thumb: URL.createObjectURL(image),
    bitmap,
    backdrop: makeBackdrop(bitmap, W, H),
    duration: null,
  };
}

async function addFiles(files: Iterable<File>) {
  const images = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|avif|webp)$/i.test(f.name));
  if (!images.length) return;
  ui.status.textContent = 'Loading images…';

  const results = await Promise.allSettled(images.map((file) => makeSlide(file, file.name)));
  ui.status.textContent = '';

  const failed: string[] = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? slides.push(r.value) : failed.push(images[i].name)));
  if (failed.length) toast(`Couldn't read ${failed.map((n) => `“${n}”`).join(', ')}. Try JPG, PNG or WebP.`);
  renderSlides();
  update();
}

function removeSlide(slide: Slide) {
  URL.revokeObjectURL(slide.thumb);
  slide.bitmap.close();
  slides = slides.filter((s) => s !== slide);
}

function moveSlide(from: number, to: number) {
  if (to < 0 || to >= slides.length || from === to) return;
  const [slide] = slides.splice(from, 1);
  slides.splice(to, 0, slide);
}

function renderSlides() {
  const items = slides.map((slide, i) => {
    const li = document.createElement('li');
    li.className = 'slide';
    li.draggable = true;
    li.dataset.index = String(i);
    li.innerHTML = `
      <div class="thumb">
        <img alt="" draggable="false" />
        <div class="seek" role="button" tabindex="0" data-act="seek" aria-label="Go to image ${i + 1}"></div>
        <span class="idx">${i + 1}</span>
        <button type="button" class="x" data-act="remove" aria-label="Remove image ${i + 1}">×</button>
      </div>
      <div class="slide-foot">
        <button type="button" data-act="left" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>‹</button>
        <label class="dur" title="Seconds for this image">
          <input type="number" min="0.5" max="30" step="0.5" inputmode="decimal" aria-label="Seconds for image ${i + 1}" />
          <span>s</span>
        </label>
        <button type="button" data-act="right" aria-label="Move later" ${i === slides.length - 1 ? 'disabled' : ''}>›</button>
      </div>`;
    li.querySelector('img')!.src = slide.thumb;
    const dur = li.querySelector('input')!;
    dur.placeholder = String(settings.slideDuration);
    if (slide.duration !== null) dur.value = String(slide.duration);
    return li;
  });

  const add = document.createElement('li');
  add.className = 'slide add';
  add.innerHTML = `<label for="file-input" class="thumb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Add</span></label>`;
  ui.slides.replaceChildren(...items, add);
  current = -1;
  requestDraw();
}

/** Highlights the thumbnail of the image on screen. */
let current = -1;
function markCurrent(index: number) {
  if (index === current) return;
  current = index;
  for (const li of ui.slides.children) {
    const on = slideIndex(li) === index;
    li.classList.toggle('current', on);
    li.querySelector('.seek')?.toggleAttribute('aria-current', on);
  }
}

/** Jumps to the moment an image is fully on screen and pauses there. */
function seekToSlide(index: number) {
  setPlaying(false);
  time = slideStart(scene, index);
  requestDraw();
}

const slideIndex = (el: EventTarget | null) =>
  parseInt((el as HTMLElement | null)?.closest<HTMLElement>('.slide')?.dataset.index ?? '-1', 10);

ui.slides.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!button || (button as HTMLButtonElement).disabled) return;
  const i = slideIndex(button);
  const act = button.dataset.act;
  if (act === 'seek') return seekToSlide(i);
  if (act === 'remove') removeSlide(slides[i]);
  else moveSlide(i, act === 'left' ? i - 1 : i + 1);
  renderSlides();
  update();
  // Keep keyboard focus on the same control after re-rendering.
  const target = act === 'remove' ? null : i + (act === 'left' ? -1 : 1);
  if (target !== null) ui.slides.children[target]?.querySelector<HTMLElement>(`[data-act="${act}"]:not(:disabled)`)?.focus();
});

ui.slides.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (target.dataset.act !== 'seek' || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  seekToSlide(slideIndex(target));
});

ui.slides.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  const slide = slides[slideIndex(input)];
  if (!slide) return;
  const value = parseFloat(input.value);
  slide.duration = Number.isFinite(value) ? sanitize('slideDuration', value) : null;
  update();
});

ui.slides.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const slide = slides[slideIndex(input)];
  if (slide) input.value = slide.duration === null ? '' : String(slide.duration);
});

// Reordering by drag (desktop). Touch devices use the arrow buttons.
let dragFrom = -1;
ui.slides.addEventListener('dragstart', (event) => {
  dragFrom = slideIndex(event.target);
  if (dragFrom < 0) return;
  event.dataTransfer!.effectAllowed = 'move';
  event.dataTransfer!.setData('text/plain', String(dragFrom));
  (event.target as HTMLElement).classList.add('dragging');
});
ui.slides.addEventListener('dragover', (event) => {
  if (dragFrom < 0) return;
  event.preventDefault();
  const over = slideIndex(event.target);
  for (const li of ui.slides.children) li.classList.toggle('drop-target', slideIndex(li) === over && over !== dragFrom);
});
ui.slides.addEventListener('drop', (event) => {
  if (dragFrom < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const to = slideIndex(event.target);
  if (to >= 0) moveSlide(dragFrom, to);
  dragFrom = -1;
  renderSlides();
  update();
});
ui.slides.addEventListener('dragend', () => {
  dragFrom = -1;
  for (const li of ui.slides.children) li.classList.remove('dragging', 'drop-target');
});

ui.fileInput.addEventListener('change', () => {
  const files = [...(ui.fileInput.files ?? [])];
  ui.fileInput.value = '';
  void addFiles(files);
});

function clearSlides() {
  for (const slide of [...slides]) removeSlide(slide);
  post = null;
}

ui.clear.addEventListener('click', () => {
  clearSlides();
  renderSlides();
  update();
});

// ---------------------------------------------------------------------------
// Loading a post from its link

let loadingPost = false;

async function loadPost(link: string) {
  if (loadingPost) return;
  if (!parseShortcode(link)) {
    toast('Paste the link of an Instagram post, like instagram.com/p/…');
    return;
  }
  loadingPost = true;
  ui.postLoad.disabled = true;
  ui.postLoad.textContent = 'Loading…';
  ui.status.textContent = 'Reading the post…';

  try {
    const response = await fetch(`api/post?url=${encodeURIComponent(link)}`);
    const data = await response.json().catch(() => ({ error: 'The server sent an unexpected answer.' }));
    if (!response.ok) throw new Error(data.error);
    const loaded = data as Post;

    let done = 0;
    const total = loaded.images.length;
    ui.status.textContent = `Downloading images 0/${total}…`;
    const [images, picture] = await Promise.all([
      Promise.all(
        loaded.images.map(async (image, i) => {
          const blob = await download(image.url);
          ui.status.textContent = `Downloading images ${++done}/${total}…`;
          return makeSlide(blob, `${loaded.shortcode}-${i + 1}`);
        }),
      ),
      loaded.avatar ? download(loaded.avatar).catch(() => null) : null,
    ]);

    clearSlides();
    slides = images;
    post = loaded;
    settings.handle = loaded.username;
    syncInputs();
    renderSlides();
    await setAvatar(picture).catch(() => setAvatar(null));
    time = 0;
    update();
    setPlaying(true);
    if (loaded.images.some((image) => image.video)) toast('Videos in this post appear as their cover image.');
    ui.status.textContent = `Loaded ${total} image${total > 1 ? 's' : ''} from @${loaded.username}.`;
  } catch (error) {
    ui.status.textContent = '';
    toast((error as Error).message || 'Could not load this post.');
  } finally {
    loadingPost = false;
    ui.postLoad.disabled = false;
    ui.postLoad.textContent = 'Load';
  }
}

async function download(url: string): Promise<Blob> {
  const response = await fetch(url, { referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Could not download the images. Try loading the post again.');
  return response.blob();
}

ui.postForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void loadPost(ui.postUrl.value);
});

// Pasting a link loads it right away.
ui.postUrl.addEventListener('paste', () => setTimeout(() => void loadPost(ui.postUrl.value)));

// Files dropped anywhere on the page, or pasted.
let dragDepth = 0;
const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  dragDepth++;
  document.body.classList.add('dropping');
});
window.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  if (--dragDepth <= 0) document.body.classList.remove('dropping');
});
window.addEventListener('dragover', (event) => {
  if (hasFiles(event)) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dropping');
  void addFiles(event.dataTransfer!.files);
});
window.addEventListener('paste', (event) => {
  if (event.target === ui.postUrl) return;
  const files = event.clipboardData?.files;
  if (files?.length) {
    void addFiles(files);
    return;
  }
  // A post link pasted anywhere outside a text field.
  const text = event.clipboardData?.getData('text') ?? '';
  const editing = (event.target as HTMLElement).closest('input, textarea, [contenteditable]');
  if (!editing && /instagr(\.am|am\.com)\//i.test(text)) {
    ui.postUrl.value = text.trim();
    void loadPost(text);
  }
});

// ---------------------------------------------------------------------------
// Export

let exporting: AbortController | null = null;
let result: { blob: Blob; url: string; name: string } | null = null;

function clearResult() {
  if (!result) return;
  URL.revokeObjectURL(result.url);
  result = null;
  ui.result.hidden = true;
  ui.status.textContent = '';
}

function setExportProgress(fraction: number | null) {
  ui.export.classList.toggle('busy', fraction !== null);
  ui.export.style.setProperty('--progress', String(fraction ?? 0));
  ui.export.querySelector('.label')!.textContent =
    fraction === null ? 'Create video' : `Rendering ${Math.floor(fraction * 100)}% · Cancel`;
}

ui.export.addEventListener('click', async () => {
  if (exporting) {
    exporting.abort();
    return;
  }
  if (typeof VideoEncoder === 'undefined') {
    toast('Your browser can’t encode video. Try a recent Chrome, Edge, Safari or Firefox.');
    return;
  }
  clearResult();
  setPlaying(false);
  exporting = new AbortController();
  ui.panel.inert = true;
  setExportProgress(0);
  const started = performance.now();

  try {
    // The encoder is loaded on demand so the page itself stays light.
    const { exportVideo } = await import('./export');
    const blob = await exportVideo(scene, setExportProgress, exporting.signal);
    const handle = normalizeHandle(settings.handle);
    const name = `story-${[handle, post?.shortcode].filter(Boolean).join('-') || 'carousel'}.mp4`;
    result = { blob, url: URL.createObjectURL(blob), name };
    ui.download.href = result.url;
    ui.download.download = name;
    ui.share.hidden = !canShareFile(new File([blob], name, { type: 'video/mp4' }));
    ui.result.hidden = false;
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    ui.status.textContent = `Ready: ${(blob.size / 1e6).toFixed(1)} MB, rendered in ${seconds} s.`;
  } catch (error) {
    if ((error as Error).name === 'AbortError') ui.status.textContent = 'Cancelled.';
    else {
      console.error(error);
      toast((error as Error).message || 'Something went wrong while creating the video.');
    }
  } finally {
    exporting = null;
    ui.panel.inert = false;
    setExportProgress(null);
    ui.export.disabled = slides.length === 0;
  }
});

function canShareFile(file: File) {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

ui.share.addEventListener('click', async () => {
  if (!result) return;
  try {
    await navigator.share({ files: [new File([result.blob], result.name, { type: 'video/mp4' })] });
  } catch (error) {
    if ((error as Error).name !== 'AbortError') toast('Sharing failed. Use Download instead.');
  }
});

// ---------------------------------------------------------------------------
// Toast

let toastTimer = 0;
function toast(message: string) {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'alert');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 5000);
}

// ---------------------------------------------------------------------------
// Boot

syncInputs();
renderSlides();
update();
// Links like ?url=https://www.instagram.com/p/… open with that post loaded.
const linked = new URLSearchParams(location.search).get('url');
if (linked) {
  ui.postUrl.value = linked;
  void loadPost(linked);
}
