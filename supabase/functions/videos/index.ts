// Site "Vídeos para modelar" — API (Supabase Edge Function)
// Busca capas (TikTok, YouTube, Instagram, outros), guarda os vídeos no Postgres e as capas no Storage.
// A tela do site fica no GitHub Pages (pasta docs/), por isso a API libera CORS e protege tudo com PIN.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "modelar-thumbs";
const FN = "videos";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const FB_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook",
  kwai: "Kwai", pinterest: "Pinterest", x: "X", outro: "Outro",
};

// ---------- respostas ----------
// O site (HTML) fica hospedado em outro domínio (GitHub Pages), então a API libera CORS.
// Os dados continuam protegidos pelo PIN.
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type, x-pin, x-deploy-token",
  "access-control-max-age": "86400",
};
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}
function err(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

// ---------- util ----------
async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\\u0026/g, "&");
}
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function metaContent(htmlText: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const k = escapeRe(key);
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*?content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["']${k}["']`, "i");
    const m = htmlText.match(re1) || htmlText.match(re2);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return undefined;
}
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function fetchText(url: string, headers: Record<string, string> = {}, maxBytes = 1_500_000) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      ...headers,
    },
    redirect: "follow",
    signal: withTimeout(15000),
  });
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (received > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } break; }
    }
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(concatChunks(chunks));
  return { status: res.status, text, url: res.url || url };
}
async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json,*/*;q=0.8", ...headers },
    signal: withTimeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
// Facebook só entrega a página completa (com og:image) para o robô do próprio Facebook
function isFacebookHost(h: string): boolean {
  return /(^|\.)facebook\.com$/.test(h) || h === "fb.watch" || /(^|\.)fb\.com$/.test(h);
}
function uaFor(url: string): string {
  try { if (isFacebookHost(new URL(url).hostname.toLowerCase())) return FB_UA; } catch { /* ignore */ }
  return UA;
}
// Títulos que são página de erro/login, não o vídeo
const JUNK_TITLES = /^(error|erro|facebook|instagram|tiktok|youtube|log ?in|login|entrar|just a moment\.*|attention required!?|access denied|page not found|not found|página não encontrada|conteúdo indisponível|content unavailable|untitled|sem título)$/i;
function isJunkTitle(t?: string | null): boolean {
  if (!t) return true;
  const s = t.replace(/\s+/g, " ").trim();
  return s.length < 2 || JUNK_TITLES.test(s) || /^(log ?in|entrar|faça login|iniciar sessão)\b/i.test(s);
}

async function resolveRedirects(url: string): Promise<string> {
  let current = url;
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": uaFor(current), accept: "text/html,*/*;q=0.8", "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
        signal: withTimeout(12000),
      });
    } catch {
      return current;
    }
    const loc = res.headers.get("location");
    try { await res.body?.cancel(); } catch { /* ignore */ }
    if (res.status >= 300 && res.status < 400 && loc) {
      try { current = new URL(loc, current).toString(); } catch { return current; }
      continue;
    }
    return current;
  }
  return current;
}

function hostPlatform(host: string): string {
  const h = host.toLowerCase();
  if (/(^|\.)tiktok\.com$/.test(h)) return "tiktok";
  if (/(^|\.)youtube\.com$/.test(h) || h === "youtu.be") return "youtube";
  if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
  if (/(^|\.)facebook\.com$/.test(h) || h === "fb.watch") return "facebook";
  if (/kwai/.test(h)) return "kwai";
  if (/(^|\.)pinterest\./.test(h) || h === "pin.it") return "pinterest";
  if (h === "x.com" || /(^|\.)twitter\.com$/.test(h)) return "x";
  return "outro";
}
function youtubeId(u: URL): string | null {
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  const v = u.searchParams.get("v");
  if (v) return v;
  const m = u.pathname.match(/\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})/);
  return m ? m[2] : null;
}

// ---------- preview ----------
type Preview = {
  platform: string; finalUrl: string; title?: string; author?: string;
  imageUrl?: string; w?: number; h?: number; referer?: string;
};

async function previewYouTube(u: URL, p: Preview) {
  const id = youtubeId(u);
  if (!id) return;
  const isShort = u.pathname.includes("/shorts/");
  p.finalUrl = isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
  try {
    const o = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
    if (o.title) p.title = String(o.title);
    if (o.author_name) p.author = String(o.author_name);
  } catch { /* segue sem título */ }
  const candidates = isShort
    ? [["oardefault.jpg", 1080, 1920], ["maxresdefault.jpg", 1280, 720], ["hqdefault.jpg", 480, 360]]
    : [["maxresdefault.jpg", 1280, 720], ["hqdefault.jpg", 480, 360]];
  for (const [file, w, h] of candidates) {
    const url = `https://i.ytimg.com/vi/${id}/${file}`;
    try {
      const r = await fetch(url, { method: "HEAD", signal: withTimeout(8000) });
      if (r.ok) { p.imageUrl = url; p.w = Number(w); p.h = Number(h); break; }
    } catch { /* tenta o próximo */ }
  }
}

async function previewTikTok(u: URL, p: Preview) {
  const m = u.pathname.match(/\/@([^/]+)\/(video|photo)\/(\d+)/);
  if (m) p.finalUrl = `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}`;
  const o = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(p.finalUrl)}`);
  if (o.title) p.title = String(o.title);
  if (o.author_unique_id || o.author_name) p.author = "@" + String(o.author_unique_id || o.author_name);
  if (o.thumbnail_url) p.imageUrl = String(o.thumbnail_url);
  if (o.thumbnail_width && o.thumbnail_height) { p.w = Number(o.thumbnail_width); p.h = Number(o.thumbnail_height); }
}

async function previewInstagram(u: URL, p: Preview) {
  const m = u.pathname.match(/\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!m) return;
  const kind = m[1] === "reels" ? "reel" : m[1];
  const code = m[2];
  p.finalUrl = `https://www.instagram.com/${kind}/${code}/`;
  // 1) página de incorporação (costuma responder sem login)
  try {
    const r = await fetchText(`https://www.instagram.com/p/${code}/embed/captioned/`);
    const h = r.text;
    const img = h.match(/class="EmbeddedMediaImage"[^>]*?\ssrc="([^"]+)"/i) ||
      h.match(/<img[^>]+src="([^"]+)"[^>]*class="EmbeddedMediaImage"/i) ||
      h.match(/"display_url":"([^"]+)"/i);
    if (img) p.imageUrl = decodeEntities(img[1]);
    const user = h.match(/class="UsernameText"[^>]*>([^<]+)</i) || h.match(/"username":"([^"]+)"/i);
    if (user) p.author = "@" + user[1].trim();
    const cap = h.match(/class="Caption"[\s\S]*?<\/a>([\s\S]*?)<div class="CaptionComments"/i);
    if (cap) { const t = stripTags(cap[1]); if (t) p.title = t.slice(0, 140); }
  } catch { /* tenta a próxima */ }
  // 2) tags de compartilhamento da página principal
  if (!p.imageUrl) {
    try {
      const r = await fetchText(p.finalUrl, { "user-agent": FB_UA });
      p.imageUrl = metaContent(r.text, ["og:image"]);
      if (!p.title) p.title = metaContent(r.text, ["og:title"]);
    } catch { /* ignora */ }
  }
  // "Fulano no Instagram: "legenda"" -> autor + legenda curta
  if (p.title) {
    const mm = p.title.match(/^(.+?) (?:no|on|en|auf|sur) Instagram: ["“]([\s\S]*?)["”]?$/);
    if (mm) { if (!p.author) p.author = mm[1].trim(); p.title = mm[2]; }
    p.title = p.title.replace(/\s+/g, " ").trim().slice(0, 140);
  }
}

async function previewFacebook(u: URL, p: Preview) {
  const r = await fetchText(p.finalUrl || u.toString(), { "user-agent": FB_UA });
  const h = r.text;
  p.imageUrl = metaContent(h, ["og:image:secure_url", "og:image"]);
  let t = metaContent(h, ["og:title"]) ?? "";
  // "1,4 mi visualizações · 35 mil reações | legenda" -> "legenda"
  if (/^[^|]{0,90}(visualiza|views|rea[çc]|reactions|coment|·)[^|]{0,60}\|/i.test(t)) t = t.replace(/^[^|]*\|\s*/, "");
  if (t && !isJunkTitle(t)) p.title = t.replace(/\s+/g, " ").trim().slice(0, 140);
  const owner = h.match(/"owning_profile":\{[^{}]*?"name":"([^"]{1,80})"/) || h.match(/"page_name":"([^"]{1,80})"/) ||
    h.match(/"author_name":"([^"]{1,80})"/) || h.match(/"owner":\{[^{}]*?"name":"([^"]{1,80})"/);
  if (owner) p.author = decodeEntities(owner[1].replace(/\\u([0-9a-f]{4})/gi, (_, x) => String.fromCharCode(parseInt(x, 16))).replace(/\\\//g, "/"));
}

async function previewGeneric(u: URL, p: Preview) {
  const r = await fetchText(p.finalUrl || u.toString(), { "user-agent": uaFor(p.finalUrl || u.toString()) });
  const h = r.text;
  if (!p.imageUrl) p.imageUrl = metaContent(h, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);
  if (!p.title) {
    p.title = metaContent(h, ["og:title", "twitter:title"]);
    if (!p.title) { const t = h.match(/<title[^>]*>([^<]*)<\/title>/i); if (t) p.title = decodeEntities(t[1]).trim(); }
  }
  if (!p.author) p.author = metaContent(h, ["og:site_name", "author"]);
  if (p.imageUrl && !/^https?:/i.test(p.imageUrl)) {
    try { p.imageUrl = new URL(p.imageUrl, r.url).toString(); } catch { p.imageUrl = undefined; }
  }
}

async function buildPreview(input: string): Promise<Preview> {
  const finalUrl = await resolveRedirects(input);
  const u = new URL(finalUrl);
  const platform = hostPlatform(u.hostname);
  const p: Preview = { platform, finalUrl };
  try {
    if (platform === "youtube") await previewYouTube(u, p);
    else if (platform === "tiktok") await previewTikTok(u, p);
    else if (platform === "instagram") await previewInstagram(u, p);
    else if (platform === "facebook") await previewFacebook(u, p);
  } catch (e) {
    console.warn("preview", platform, String(e));
  }
  if (!p.imageUrl) {
    try { await previewGeneric(u, p); } catch (e) { console.warn("preview generic", String(e)); }
  }
  if (isJunkTitle(p.title)) p.title = defaultTitle(u, platform);
  return p;
}
function defaultTitle(u: URL, platform: string): string {
  return platform === "outro" ? `Vídeo de ${u.hostname.replace(/^www\./, "")}` : `Vídeo do ${PLATFORM_LABEL[platform]}`;
}
function isDefaultTitle(t?: string | null): boolean {
  return !t || isJunkTitle(t) || /^Vídeo d[oe] /.test(t);
}

// ---------- imagens ----------
function sniffType(buf: Uint8Array): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  if (buf.length > 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70 &&
    buf[8] === 0x61 && buf[9] === 0x76 && buf[10] === 0x69 && buf[11] === 0x66) return "image/avif";
  return null;
}
function imageSize(buf: Uint8Array, type: string): { w: number; h: number } | null {
  try {
    if (type === "image/png" && buf.length >= 24) {
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    if (type === "image/gif" && buf.length >= 10) {
      return { w: buf[6] | (buf[7] << 8), h: buf[8] | (buf[9] << 8) };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xff) { i++; continue; }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = (buf[i + 2] << 8) | buf[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
        }
        i += 2 + len;
      }
    }
    if (type === "image/webp" && buf.length >= 30) {
      const tag = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
      if (tag === "VP8 ") return { w: (buf[26] | (buf[27] << 8)) & 0x3fff, h: (buf[28] | (buf[29] << 8)) & 0x3fff };
      if (tag === "VP8L") {
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
        return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
      if (tag === "VP8X") return { w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    }
  } catch { /* sem tamanho */ }
  return null;
}
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
};

async function storeBytes(id: string, buf: Uint8Array, type: string) {
  const ext = EXT[type] ?? "jpg";
  const path = `${id}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, new Blob([buf as unknown as BlobPart], { type }), {
    contentType: type, upsert: true, cacheControl: "31536000",
  });
  if (error) throw new Error("storage: " + error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  const dims = imageSize(buf, type);
  return { path, url: data.publicUrl, w: dims?.w, h: dims?.h };
}
async function storeImageFromUrl(id: string, imageUrl: string, referer?: string) {
  const res = await fetch(imageUrl, {
    headers: { "user-agent": UA, accept: "image/avif,image/webp,image/*,*/*;q=0.8", ...(referer ? { referer } : {}) },
    signal: withTimeout(20000),
  });
  if (!res.ok) throw new Error(`imagem HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 200) throw new Error("imagem vazia");
  if (buf.byteLength > 9_000_000) throw new Error("imagem grande demais");
  const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const type = sniffType(buf) ?? (ct.startsWith("image/") ? ct : null);
  if (!type) throw new Error("o link não é uma imagem");
  return await storeBytes(id, buf, type);
}
async function removeThumbs(id: string, keep?: string) {
  try {
    const { data } = await sb.storage.from(BUCKET).list(id, { limit: 100 });
    const names = (data ?? []).map((o) => `${id}/${o.name}`).filter((n) => n !== keep);
    if (names.length) await sb.storage.from(BUCKET).remove(names);
  } catch { /* limpeza opcional */ }
}

// ---------- autenticação ----------
async function getSetting(key: string): Promise<string | null> {
  const { data } = await sb.from("modelar_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function requirePin(req: Request): Promise<Response | null> {
  const stored = await getSetting("pin_hash");
  if (!stored) return err("Crie um PIN primeiro.", 409, { code: "setup_required" });
  const given = req.headers.get("x-pin") ?? "";
  if (!given) return err("Digite o PIN para continuar.", 401);
  if ((await sha256(given)) !== stored) {
    await new Promise((r) => setTimeout(r, 400));
    return err("PIN incorreto.", 401);
  }
  return null;
}

async function getVideo(id: string) {
  const { data } = await sb.from("modelar_videos").select("*").eq("id", id).maybeSingle();
  return data;
}

// ---------- servidor ----------
Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const m = url.pathname.match(new RegExp(`/${FN}(?=/|$)`));
  const rel = m ? url.pathname.slice((m.index ?? 0) + m[0].length) : url.pathname;
  const method = req.method.toUpperCase();

  try {
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (method === "GET" && (rel === "" || rel === "/")) {
      return json({ ok: true, app: "Vídeos para modelar", site: "https://gaburelll.github.io/modelar/" });
    }
    if (method === "GET" && rel === "/api/status") return json({ setup: !!(await getSetting("pin_hash")) });

    // --- PIN ---
    if (rel === "/api/setup" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const pin = String(body?.pin ?? "");
      if (!/^\d{4,8}$/.test(pin)) return err("O PIN precisa ter de 4 a 8 números.");
      if (await getSetting("pin_hash")) return err("O PIN já foi criado. Digite o PIN existente.", 409);
      const { error } = await sb.from("modelar_settings").upsert({ key: "pin_hash", value: await sha256(pin) });
      if (error) return err("Não consegui salvar o PIN.", 500);
      return json({ ok: true });
    }
    if (rel === "/api/login" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const pin = String(body?.pin ?? "");
      const stored = await getSetting("pin_hash");
      if (!stored) return err("Crie um PIN primeiro.", 409, { code: "setup_required" });
      if ((await sha256(pin)) !== stored) { await new Promise((r) => setTimeout(r, 400)); return err("PIN incorreto.", 401); }
      return json({ ok: true });
    }

    // --- API protegida ---
    if (rel.startsWith("/api/")) {
      const denied = await requirePin(req);
      if (denied) return denied;

      if (rel === "/api/videos" && method === "GET") {
        const { data, error } = await sb.from("modelar_videos").select("*").order("created_at", { ascending: false }).limit(2000);
        if (error) return err("Não consegui carregar os vídeos.", 500);
        return json({ videos: data ?? [] });
      }

      if (rel === "/api/videos" && method === "POST") {
        const body = await req.json().catch(() => ({}));
        let input = String(body?.url ?? "").trim();
        if (!/^https?:\/\//i.test(input)) input = "https://" + input;
        let parsed: URL;
        try { parsed = new URL(input); } catch { return err("Esse link não parece válido."); }
        if (!parsed.hostname.includes(".")) return err("Esse link não parece válido.");

        const p = await buildPreview(input);
        // já existe?
        const dupA = await sb.from("modelar_videos").select("*").eq("final_url", p.finalUrl).limit(1);
        const dupB = dupA.data?.length ? dupA : await sb.from("modelar_videos").select("*").eq("url", input).limit(1);
        if (dupB.data?.length) return json({ video: dupB.data[0], duplicate: true });

        const id = crypto.randomUUID();
        let thumb: { path: string; url: string; w?: number; h?: number } | null = null;
        let previewError: string | null = null;
        if (p.imageUrl) {
          try { thumb = await storeImageFromUrl(id, p.imageUrl, p.referer); } catch (e) { previewError = String((e as Error)?.message ?? e); }
        } else previewError = "capa não encontrada";
        const row = {
          id, url: input, final_url: p.finalUrl, platform: p.platform,
          title: p.title ?? null, author: p.author ?? null,
          thumb_url: thumb?.url ?? null, thumb_path: thumb?.path ?? null,
          thumb_w: thumb?.w ?? p.w ?? null, thumb_h: thumb?.h ?? p.h ?? null,
        };
        const { data, error } = await sb.from("modelar_videos").insert(row).select().single();
        if (error) return err("Não consegui salvar o vídeo: " + error.message, 500);
        return json({ video: data, previewError });
      }

      const vm = rel.match(/^\/api\/videos\/([0-9a-f-]{36})(?:\/(refresh|cover))?$/);
      if (vm) {
        const id = vm[1];
        const action = vm[2];
        const video = await getVideo(id);
        if (!video) return err("Vídeo não encontrado.", 404);

        if (!action && method === "PATCH") {
          const body = await req.json().catch(() => ({}));
          const upd: Record<string, unknown> = {};
          if (typeof body.title === "string") upd.title = body.title.trim().slice(0, 300) || null;
          if (typeof body.author === "string") upd.author = body.author.trim().slice(0, 120) || null;
          if (body.status === "para_modelar" || body.status === "modelado") upd.status = body.status;
          if (Array.isArray(body.tags)) upd.tags = body.tags.map((t: unknown) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
          if (typeof body.notes === "string") upd.notes = body.notes.slice(0, 5000);
          if (!Object.keys(upd).length) return err("Nada para atualizar.");
          const { data, error } = await sb.from("modelar_videos").update(upd).eq("id", id).select().single();
          if (error) return err("Não consegui salvar: " + error.message, 500);
          return json({ video: data });
        }

        if (!action && method === "DELETE") {
          const { error } = await sb.from("modelar_videos").delete().eq("id", id);
          if (error) return err("Não consegui excluir: " + error.message, 500);
          await removeThumbs(id);
          return json({ ok: true });
        }

        if (action === "refresh" && method === "POST") {
          const p = await buildPreview(video.url);
          let thumb: { path: string; url: string; w?: number; h?: number } | null = null;
          let previewError: string | null = null;
          if (p.imageUrl) {
            try { thumb = await storeImageFromUrl(id, p.imageUrl, p.referer); } catch (e) { previewError = String((e as Error)?.message ?? e); }
          } else previewError = "capa não encontrada";
          const upd: Record<string, unknown> = { platform: p.platform, final_url: p.finalUrl };
          if (isDefaultTitle(video.title) && p.title && !isDefaultTitle(p.title)) upd.title = p.title;
          if (!video.author && p.author) upd.author = p.author;
          if (thumb) { upd.thumb_url = thumb.url; upd.thumb_path = thumb.path; upd.thumb_w = thumb.w ?? p.w ?? null; upd.thumb_h = thumb.h ?? p.h ?? null; }
          const { data, error } = await sb.from("modelar_videos").update(upd).eq("id", id).select().single();
          if (error) return err("Não consegui atualizar: " + error.message, 500);
          if (thumb) await removeThumbs(id, thumb.path);
          return json({ video: data, previewError });
        }

        if (action === "cover" && method === "POST") {
          const ct = req.headers.get("content-type") || "";
          let thumb: { path: string; url: string; w?: number; h?: number };
          if (ct.includes("multipart/form-data")) {
            const fd = await req.formData();
            const f = fd.get("file");
            if (!(f instanceof File)) return err("Envie uma imagem.");
            const buf = new Uint8Array(await f.arrayBuffer());
            if (buf.byteLength > 9_000_000) return err("A imagem é grande demais (máx. 9 MB).");
            const type = sniffType(buf) ?? (f.type.startsWith("image/") ? f.type : null);
            if (!type) return err("O arquivo precisa ser uma imagem.");
            thumb = await storeBytes(id, buf, type);
          } else {
            const body = await req.json().catch(() => ({}));
            const imageUrl = String(body?.imageUrl ?? "").trim();
            if (!/^https?:\/\//i.test(imageUrl)) return err("Cole um link de imagem começando com http.");
            thumb = await storeImageFromUrl(id, imageUrl);
          }
          const { data, error } = await sb.from("modelar_videos")
            .update({ thumb_url: thumb.url, thumb_path: thumb.path, thumb_w: thumb.w ?? null, thumb_h: thumb.h ?? null })
            .eq("id", id).select().single();
          if (error) return err("Não consegui salvar a capa: " + error.message, 500);
          await removeThumbs(id, thumb.path);
          return json({ video: data });
        }
      }
    }

    return err("Não encontrado.", 404);
  } catch (e) {
    console.error(e);
    return err("Erro interno: " + String((e as Error)?.message ?? e), 500);
  }
});
