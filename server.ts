import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config({ path: '.env.local', override: true });
dotenv.config({ override: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IMAGE_CACHE_DIR = path.join(os.tmpdir(), 'naskah-studio-images');
fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });

interface CachedImageEntry {
  buffer: Buffer;
  mimeType: string;
  ext: string;
}

const imageMemoryCache = new Map<string, CachedImageEntry>();

interface IncomingMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  messages: IncomingMessage[];
  documentContent: string;
  documentTitle?: string;
  referenceFile?: {
    name: string;
    content: string;
  } | null;
  attachedImage?: {
    name: string;
    url: string;
    mimeType?: string;
  } | null;
}

interface GeneratedImageMeta {
  url: string;
  title: string;
  engine: string;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi pada environment server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientAiError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : 0;
  return (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    status === 429 ||
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('502') ||
    lower.includes('504') ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset')
  );
}

function formatServerError(err: unknown): { status: number; message: string; retryable: boolean } {
  const raw = err instanceof Error ? err.message : String(err ?? 'Terjadi kesalahan pada server AI.');
  const lower = raw.toLowerCase();

  if (
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded')
  ) {
    return {
      status: 503,
      message: 'Server AI sedang mengalami kepadatan permintaan (503). Silakan klik "Coba Lagi" beberapa saat lagi.',
      retryable: true,
    };
  }

  if (lower.includes('429') || lower.includes('resource_exhausted')) {
    return {
      status: 429,
      message: 'Batas permintaan sementara API tercapai (429). Silakan tunggu beberapa detik lalu coba lagi.',
      retryable: true,
    };
  }

  // Strip nested JSON error payloads if present
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: number } };
    if (parsed?.error?.message) {
      return {
        status: Number(parsed.error.code) || 500,
        message: parsed.error.message,
        retryable: isTransientAiError(raw),
      };
    }
  } catch {
    // Not raw JSON
  }

  return {
    status: 500,
    message: raw,
    retryable: isTransientAiError(err),
  };
}

function sanitizeSvgMarkup(rawSvg: string): string {
  let svg = rawSvg.trim();
  const match = svg.match(/<svg[\s\S]*<\/svg>/i);
  if (match) {
    svg = match[0];
  }
  if (!svg.toLowerCase().startsWith('<svg')) {
    throw new Error('Output SVG dari Groq tidak valid.');
  }
  // Remove any script tags or inline event handlers for safe rendering
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');

  if (!/xmlns\s*=/i.test(svg)) {
    svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/viewBox\s*=/i.test(svg)) {
    svg = svg.replace(/^<svg/i, '<svg viewBox="0 0 800 500"');
  }
  return svg;
}

function saveGeneratedImageBuffer(
  buffer: Buffer,
  ext: 'svg' | 'png' | 'jpg' | 'webp',
  mimeType: string
): string {
  const id = `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  imageMemoryCache.set(id, { buffer, mimeType, ext });
  if (imageMemoryCache.size > 150) {
    const oldestKey = imageMemoryCache.keys().next().value;
    if (oldestKey) imageMemoryCache.delete(oldestKey);
  }
  const filePath = path.join(IMAGE_CACHE_DIR, `${id}.${ext}`);
  fs.writeFileSync(filePath, buffer);
  return `/api/images/${id}.${ext}`;
}

function saveGeneratedSvg(svgMarkup: string): string {
  return saveGeneratedImageBuffer(
    Buffer.from(svgMarkup, 'utf8'),
    'svg',
    'image/svg+xml; charset=utf-8'
  );
}

async function generateImageWithGroq(
  prompt: string,
  title: string
): Promise<GeneratedImageMeta> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    throw new Error('GROQ_API_KEY belum dikonfigurasi di server.');
  }

  const groqSystemPrompt = `Anda adalah desainer grafis vektor & ilustrator SVG profesional.
Tugas Anda adalah membuat kode SVG yang sangat detail, estetis, berwarna kaya, bersih, dan siap tampil di dokumen A4 maupun chat.

Aturan ketat:
1. Kembalikan JSON valid dengan dua properti:
   - "title": Judul singkat gambar (Bahasa Indonesia).
   - "svg": Kode SVG lengkap dimulai dari "<svg viewBox='0 0 800 500' xmlns='http://www.w3.org/2000/svg'>" dan diakhiri "</svg>".
2. Gunakan <defs> berisi linearGradient/radialGradient, lapisan latar belakang, elemen bentuk yang halus, ikon/simbol jelas, bayangan lembut, dan tipografi bersih (font-family="Plus Jakarta Sans, Arial, sans-serif") bila gambar berupa diagram, bagan alur, infografis, atau poster.
3. Pastikan seluruh elemen berada rapi di dalam koordinat viewBox="0 0 800 500" tanpa terpotong di tepi, kontras teks terbaca jelas, dan tidak menggunakan <script> atau gambar eksternal.`;

  const modelsToTry = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];
  let lastError = 'Gagal menghubungi Groq API.';

  for (const model of modelsToTry) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: groqSystemPrompt },
            {
              role: 'user',
              content: `Judul: ${title}\nDeskripsi visual yang diminta: ${prompt}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.6,
          max_tokens: 4500,
        }),
      });

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (!res.ok) {
        lastError = data?.error?.message || `Groq HTTP ${res.status}`;
        continue;
      }

      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        lastError = 'Groq tidak mengembalikan konten gambar.';
        continue;
      }

      let parsed: { title?: unknown; svg?: unknown };
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          lastError = 'Format JSON gambar dari Groq tidak valid.';
          continue;
        }
        parsed = JSON.parse(jsonMatch[0]);
      }

      if (typeof parsed.svg !== 'string' || !parsed.svg.trim()) {
        lastError = 'Groq tidak mengembalikan markup SVG.';
        continue;
      }

      const cleanSvg = sanitizeSvgMarkup(parsed.svg);
      const url = saveGeneratedSvg(cleanSvg);
      const finalTitle =
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim()
          : title || 'Ilustrasi Dokumen';

      return {
        url,
        title: finalTitle,
        engine: `Groq (${model})`,
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError);
}

async function generateImageWithRewind(
  prompt: string,
  title: string
): Promise<GeneratedImageMeta> {
  const rewindKey = process.env.REWIND_API_KEY;
  if (!rewindKey) {
    throw new Error('REWIND_API_KEY belum dikonfigurasi di server.');
  }

  const modelsToTry = ['black-forest-labs/flux.2-klein-4b', 'flux2-klein-4b-fp8'];
  let lastError = 'Gagal menghubungi Rewind AI Image API.';

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch('https://api.rewind.ai/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${rewindKey}`,
          },
          body: JSON.stringify({
            model,
            prompt,
            n: 1,
          }),
        });

        const rawText = await res.text();
        let data: {
          data?: Array<{ url?: string; b64_json?: string }>;
          error?: { message?: string; code?: string };
        } = {};
        try {
          data = JSON.parse(rawText);
        } catch {
          data = {};
        }

        if (!res.ok) {
          lastError = data?.error?.message || `Rewind AI HTTP ${res.status}`;
          const code = String(data?.error?.code || '').toUpperCase();
          if (code === 'INSUFFICIENT_TOKENS') {
            break;
          }
          if ((res.status === 503 || res.status === 502 || res.status === 504 || res.status === 429) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1100));
            continue;
          }
          break;
        }

        const first = data?.data?.[0];
        if (!first) {
          lastError = 'Rewind AI tidak mengembalikan data gambar.';
          break;
        }

        let finalUrl = '';
        if (typeof first.b64_json === 'string' && first.b64_json.trim()) {
          const buffer = Buffer.from(first.b64_json, 'base64');
          finalUrl = saveGeneratedImageBuffer(buffer, 'png', 'image/png');
        } else if (typeof first.url === 'string' && first.url.trim()) {
          finalUrl = first.url.trim();
          try {
            const imgRes = await fetch(finalUrl);
            if (imgRes.ok) {
              const contentType = (imgRes.headers.get('content-type') || 'image/png')
                .split(';')[0]
                .trim()
                .toLowerCase();
              const ext: 'png' | 'jpg' | 'webp' =
                contentType.includes('jpeg') || contentType.includes('jpg')
                  ? 'jpg'
                  : contentType.includes('webp')
                    ? 'webp'
                    : 'png';
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              if (buffer.byteLength > 0) {
                finalUrl = saveGeneratedImageBuffer(
                  buffer,
                  ext,
                  ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
                );
              }
            }
          } catch {
            // Keep remote Rewind URL if local caching fails
          }
        }

        if (!finalUrl) {
          lastError = 'URL gambar dari Rewind AI kosong.';
          break;
        }

        return {
          url: finalUrl,
          title: title.trim() || 'Ilustrasi Dokumen',
          engine: `Rewind AI (${model})`,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  }

  throw new Error(lastError);
}

const SYSTEM_INSTRUCTION = `Kamu adalah Asisten Pembuat dan Editor Dokumen Profesional yang terintegrasi dengan generator gambar Server AI (Rewind AI / Groq). Tugas utamamu adalah membantu pengguna menyusun dokumen baru, merangkum, menerjemahkan, merevisi dokumen, serta menangani permintaan pembuatan gambar/ilustrasi/diagram.

Aturan Kerja:
1. Selalu periksa konteks "Dokumen Saat Ini" yang dikirimkan bersama pesan pengguna.
2. EKSEKUSI LANGSUNG DALAM SEKALI PERINTAH: Jika pengguna meminta membuat dokumen baru (seperti surat, proposal, artikel, laporan, kontrak, naskah, atau teks Arab), LANGSUNG buatkan dokumen lengkapnya pada respons pertama ini ke dalam "documentContent". JANGAN pernah menunda dengan bertanya balik meminta kelengkapan data terlebih dahulu. Jika ada detail spesifik yang belum disebutkan pengguna, gunakan placeholder rapi seperti [Nama Lengkap], [Tanggal], atau [Nama Instansi].
3. PERINTAH MEMBUAT GAMBAR (SERVER AI):
   - Jika pengguna meminta membuat gambar, ilustrasi, diagram, bagan alur, grafik, poster, ikon, atau logo (misal: "buatkan gambar...", "buat ilustrasi...", "gambarlah...", "tambahkan diagram alur..."), setel "needsImageGeneration" = true, isi "imageTitle" dengan judul gambar singkat, dan isi "imagePrompt" dengan deskripsi visual yang sangat jelas, detail, warna, komposisi, serta teks/label yang harus muncul di gambar.
   - Letakkan token persis \`{{GENERATED_IMAGE}}\` di dalam "documentContent" pada posisi gambar tersebut seharusnya tampil.
   - Jika pengguna HANYA meminta membuat gambar saat dokumen masih kosong atau meminta gambar tersendiri, buatlah judul singkat \`# [Judul Gambar]\` diikuti \`{{GENERATED_IMAGE}}\` dan keterangan singkat di bawahnya pada "documentContent" (atau sisipkan \`{{GENERATED_IMAGE}}\` pada bagian relevan jika pengguna meminta menambah gambar ke dokumen yang sudah ada).
4. PEMBUATAN BARU VS PENGEDITAN:
   - Jika pengguna meminta membuat dokumen baru yang berbeda jenis/topik dari "Dokumen Saat Ini", langsung ganti seluruh "documentContent" dengan dokumen baru tersebut dan perbarui "documentTitle" dengan judul yang sesuai.
   - Jika pengguna meminta mengedit, menambah, atau memperbaiki dokumen yang sedang aktif, lakukan perubahan HANYA pada bagian yang diminta sambil mempertahankan struktur dan isi bagian lainnya agar tidak hilang.
5. ANALISIS BENTUK & TULISAN YANG BENAR: Jika pengguna meminta menganalisis, memeriksa, mengoreksi ejaan/typo, atau mengevaluasi bentuk dan struktur dokumen, periksa hierarki heading, format tabel/daftar Markdown, tata bahasa baku (EYD V/PUEBI), tanda baca, dan penulisan Arab (bila ada). Sajikan hasil evaluasi di "reply", dan perbaiki "documentContent" jika diminta mengoreksi.
6. Gunakan format Markdown standar yang bersih (Heading \`#\`, \`##\`, \`###\`, bullet points \`-\`, penomoran \`1.\`, cetak tebal \`**\`, cetak miring \`*\`, dan tabel bila diperlukan).
7. Jangan pernah memasukkan basa-basi percakapan (seperti "Tentu, ini drafnya:") ke dalam isi dokumen. Pisahkan dengan tegas antara balasan chat ("reply") dan isi dokumen ("documentContent").
8. ANALISIS GAMBAR MULTIMODAL: Jika pengguna melampirkan gambar untuk dianalisis, amati objek, teks (OCR), komposisi, dan konteks gambar secara teliti. Jawab dalam bahasa yang sama dengan pertanyaan pengguna (default Bahasa Indonesia). Jika pengguna hanya bertanya tentang isi gambar tanpa meminta mengubah/membuat dokumen, sajikan analisis lengkap di "reply" dan kembalikan "documentContent" serta "documentTitle" persis sama dengan Dokumen Saat Ini. Jika pengguna meminta membuat/memperbarui dokumen berdasarkan gambar, tuliskan hasilnya ke "documentContent".
9. Selalu kembalikan JSON valid sesuai schema. Jika pengguna hanya mengobrol atau bertanya tanpa meminta pembuatan/pengeditan dokumen maupun gambar, jawab di "reply", setel "needsImageGeneration" = false, dan kembalikan "documentContent" serta "documentTitle" persis sama dengan Dokumen Saat Ini.`;

async function resolveServerImagePart(
  imageUrl: string
): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;

  const dataMatch = trimmed.match(
    /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i
  );
  if (dataMatch) {
    const rawMime = dataMatch[1].toLowerCase();
    const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    return {
      inlineData: {
        mimeType,
        data: dataMatch[2],
      },
    };
  }

  const localMatch = trimmed.match(
    /^\/api\/images\/(img-\d+-[a-f0-9]+)\.(png|jpe?g|webp)$/i
  );
  if (localMatch) {
    const id = localMatch[1];
    const ext = localMatch[2].toLowerCase() === 'jpeg' ? 'jpg' : localMatch[2].toLowerCase();
    let entry = imageMemoryCache.get(id);
    if (!entry) {
      const filePath = path.join(IMAGE_CACHE_DIR, `${id}.${ext}`);
      if (fs.existsSync(filePath)) {
        const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        entry = {
          buffer: fs.readFileSync(filePath),
          mimeType,
          ext,
        };
        imageMemoryCache.set(id, entry);
      }
    }
    if (entry && !entry.mimeType.includes('svg')) {
      return {
        inlineData: {
          mimeType: entry.mimeType,
          data: entry.buffer.toString('base64'),
        },
      };
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(trimmed, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Gagal mengunduh gambar dari URL (HTTP ${res.status}).`);
      }
      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/') || contentType.includes('svg')) {
        throw new Error('URL tidak mengarah ke gambar raster (PNG/JPEG/WebP/GIF) yang valid.');
      }
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength > 10 * 1024 * 1024) {
        throw new Error('Ukuran gambar dari URL melebihi batas 10 MB.');
      }
      return {
        inlineData: {
          mimeType: contentType === 'image/jpg' ? 'image/jpeg' : contentType,
          data: Buffer.from(arrayBuf).toString('base64'),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

async function generateChatWithRewind(
  textPrompt: string,
  imagePart: { inlineData: { mimeType: string; data: string } } | null
): Promise<string> {
  const rewindKey = process.env.REWIND_API_KEY;
  if (!rewindKey) {
    throw new Error('REWIND_API_KEY belum dikonfigurasi di server.');
  }

  const rewindJsonSystemPrompt = `${SYSTEM_INSTRUCTION}

FORMAT OUTPUT WAJIB:
Kembalikan HANYA objek JSON valid dengan tepat 6 properti berikut:
{
  "reply": "string (balasan singkat di kolom chat)",
  "documentTitle": "string (judul dokumen ringkas)",
  "documentContent": "string (isi lengkap dokumen Markdown, atau sama persis dengan dokumen saat ini jika tidak berubah)",
  "needsImageGeneration": false,
  "imageTitle": "string (judul gambar jika needsImageGeneration true, selain itu kosong)",
  "imagePrompt": "string (deskripsi visual gambar dalam bahasa Inggris jika needsImageGeneration true, selain itu kosong)"
}`;

  const userContent = imagePart
    ? [
        {
          type: 'image_url',
          image_url: {
            url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
          },
        },
        { type: 'text', text: textPrompt },
      ]
    : textPrompt;

  const modelsToTry = imagePart
    ? [
        'google/gemini-3.1-flash-lite',
        'google/gemma-4-26b-a4b-it:free',
        'qwen/qwen2.5-vl-72b-instruct',
      ]
    : [
        'google/gemini-3.1-flash-lite',
        'deepseek/deepseek-v4-flash-0731',
        'qwen/qwen3-30b-a3b-instruct-2507',
      ];

  let lastError = 'Gagal menghubungi Rewind AI Chat API.';

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch('https://api.rewind.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${rewindKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: rewindJsonSystemPrompt },
              { role: 'user', content: userContent },
            ],
            response_format: { type: 'json_object' },
          }),
        });

        const rawText = await res.text();
        let data: {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string; code?: string };
        } = {};
        try {
          data = JSON.parse(rawText);
        } catch {
          data = {};
        }

        if (!res.ok) {
          lastError = data?.error?.message || `Rewind AI HTTP ${res.status}`;
          const code = String(data?.error?.code || '').toUpperCase();
          if (code === 'INSUFFICIENT_TOKENS') {
            break;
          }
          if (
            (res.status === 503 || res.status === 502 || res.status === 504 || res.status === 429) &&
            attempt < 2
          ) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }
          break;
        }

        const content = data?.choices?.[0]?.message?.content?.trim();
        if (content) {
          return content;
        }
        lastError = `Rewind AI (${model}) tidak mengembalikan konten.`;
        break;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      }
    }
  }

  throw new Error(lastError);
}

async function generateChatWithEdenAi(
  textPrompt: string,
  imagePart: { inlineData: { mimeType: string; data: string } } | null
): Promise<string> {
  const edenKey = process.env.EDENAI_API_KEY;
  if (!edenKey) {
    throw new Error('EDENAI_API_KEY belum dikonfigurasi di server.');
  }

  const edenJsonSystemPrompt = `${SYSTEM_INSTRUCTION}

FORMAT OUTPUT WAJIB:
Kembalikan HANYA objek JSON valid dengan tepat 6 properti berikut:
{
  "reply": "string (balasan singkat di kolom chat)",
  "documentTitle": "string (judul dokumen ringkas)",
  "documentContent": "string (isi lengkap dokumen Markdown dalam Bahasa Indonesia yang murni, baku, dan rapi tanpa mencampur bahasa atau aksara asing yang tidak diminta, atau sama persis dengan dokumen saat ini jika tidak berubah)",
  "needsImageGeneration": false,
  "imageTitle": "string (judul gambar jika needsImageGeneration true, selain itu kosong)",
  "imagePrompt": "string (deskripsi visual gambar dalam bahasa Inggris jika needsImageGeneration true, selain itu kosong)"
}`;

  const userContent = imagePart
    ? [
        {
          type: 'image_url',
          image_url: {
            url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
          },
        },
        { type: 'text', text: textPrompt },
      ]
    : textPrompt;

  const modelsToTry = imagePart
    ? [
        'google/gemini-3.1-flash-lite',
        'google/gemma-4-31b-it',
        'google/gemma-4-26b-a4b-it',
      ]
    : [
        'google/gemini-3.1-flash-lite',
        'openai/gpt-4o-mini',
        'google/gemma-4-31b-it',
        'google/gemma-4-26b-a4b-it',
        'together_ai/Prism-ML/Ternary-Bonsai-27B',
      ];

  let lastError = 'Gagal menghubungi Eden AI v3 API.';

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch('https://api.edenai.run/v3/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${edenKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: imagePart ? 2048 : 4096,
            messages: [
              { role: 'system', content: edenJsonSystemPrompt },
              { role: 'user', content: userContent },
            ],
            response_format: { type: 'json_object' },
          }),
        });

        const rawText = await res.text();
        let data: {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string; code?: string };
        } = {};
        try {
          data = JSON.parse(rawText);
        } catch {
          data = {};
        }

        if (!res.ok) {
          lastError = data?.error?.message || `Eden AI HTTP ${res.status}`;
          const code = String(data?.error?.code || '').toLowerCase();
          if (res.status === 402 || code === 'insufficient_quota') {
            break;
          }
          if (
            (res.status === 503 || res.status === 502 || res.status === 504 || res.status === 429) &&
            attempt < 2
          ) {
            await new Promise((resolve) => setTimeout(resolve, 900));
            continue;
          }
          break;
        }

        const content = data?.choices?.[0]?.message?.content?.trim();
        if (content) {
          return content;
        }
        lastError = `Eden AI (${model}) tidak mengembalikan konten.`;
        break;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }
  }

  throw new Error(lastError);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/images/:filename', (req: Request, res: Response) => {
    const rawName = String(req.params.filename || '');
    const match = rawName.match(/^(img-\d+-[a-f0-9]+)\.(svg|png|jpe?g|webp)$/i);
    if (!match) {
      res.status(400).send('Invalid image identifier');
      return;
    }

    const id = match[1];
    const rawExt = match[2].toLowerCase();
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
    const mimeByExt: Record<string, string> = {
      svg: 'image/svg+xml; charset=utf-8',
      png: 'image/png',
      jpg: 'image/jpeg',
      webp: 'image/webp',
    };

    let entry = imageMemoryCache.get(id);
    if (!entry) {
      const candidateExts = [ext, 'svg', 'png', 'jpg', 'webp'];
      for (const candidateExt of candidateExts) {
        const filePath = path.join(IMAGE_CACHE_DIR, `${id}.${candidateExt}`);
        if (fs.existsSync(filePath)) {
          entry = {
            buffer: fs.readFileSync(filePath),
            mimeType: mimeByExt[candidateExt] || 'application/octet-stream',
            ext: candidateExt,
          };
          imageMemoryCache.set(id, entry);
          break;
        }
      }
    }

    if (!entry) {
      res.status(404).send('Image not found');
      return;
    }

    res.setHeader('Content-Type', entry.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(entry.buffer);
  });

  app.post('/api/images/upload', (req: Request, res: Response) => {
    try {
      const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl.trim() : '';
      const match = dataUrl.match(
        /^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/i
      );
      if (!match) {
        res.status(400).json({ error: 'Format gambar tidak didukung.' });
        return;
      }

      const rawMime = match[1].toLowerCase();
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.byteLength === 0 || buffer.byteLength > 5 * 1024 * 1024) {
        res.status(400).json({ error: 'Ukuran gambar maksimal 5 MB.' });
        return;
      }

      if (rawMime === 'image/svg+xml') {
        const cleanSvg = sanitizeSvgMarkup(buffer.toString('utf8'));
        const url = saveGeneratedSvg(cleanSvg);
        res.json({ url });
        return;
      }

      const ext =
        rawMime === 'image/png' ? 'png' : rawMime === 'image/webp' ? 'webp' : 'jpg';
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const url = saveGeneratedImageBuffer(buffer, ext, mime);
      res.json({ url });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Gagal menyimpan gambar.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/generate-image', async (req: Request, res: Response) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const title =
        typeof req.body?.title === 'string' && req.body.title.trim()
          ? req.body.title.trim()
          : 'Ilustrasi Gambar';
      if (!prompt) {
        res.status(400).json({ error: 'Prompt gambar tidak boleh kosong.' });
        return;
      }

      let lastErr: unknown = null;
      if (process.env.REWIND_API_KEY) {
        try {
          const generated = await generateImageWithRewind(prompt, title);
          res.json(generated);
          return;
        } catch (rewindErr: unknown) {
          lastErr = rewindErr;
          console.warn('[/api/generate-image] Rewind AI failed, trying Groq if configured:', rewindErr);
        }
      }

      if (process.env.GROQ_API_KEY) {
        const generated = await generateImageWithGroq(prompt, title);
        res.json(generated);
        return;
      }

      throw lastErr || new Error('REWIND_API_KEY atau GROQ_API_KEY belum dikonfigurasi di server.');
    } catch (error: unknown) {
      const formatted = formatServerError(error);
      console.error('[/api/generate-image] Error:', error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/compose-text', async (req: Request, res: Response) => {
    try {
      const instruction =
        typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
      const currentDoc =
        typeof req.body?.documentContent === 'string' ? req.body.documentContent : '';
      const docTitle =
        typeof req.body?.documentTitle === 'string' && req.body.documentTitle.trim()
          ? req.body.documentTitle.trim()
          : 'Dokumen Baru';

      if (!instruction && !currentDoc.trim()) {
        res.status(400).json({ error: 'Instruksi atau teks dokumen tidak boleh kosong.' });
        return;
      }

      const composePrompt = [
        `=== JUDUL DOKUMEN SAAT INI ===\n${docTitle}`,
        `=== DOKUMEN SAAT INI (MARKDOWN) ===\n${currentDoc.trim() || '(Dokumen masih kosong)'}`,
        `=== TUGAS PENYUSUNAN TEKS ===\n${
          instruction ||
          'Susun ulang, rapikan struktur Markdown, dan sempurnakan teks di atas menjadi naskah yang jelas dan profesional.'
        }`,
      ].join('\n\n');

      let rawText = '';
      let lastErr: unknown = null;

      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = getGeminiClient();
          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: composePrompt,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
            },
          });
          rawText = (response?.text ?? '').trim();
        } catch (geminiErr) {
          lastErr = geminiErr;
        }
      }

      if (!rawText && process.env.REWIND_API_KEY) {
        try {
          rawText = (await generateChatWithRewind(composePrompt, null)).trim();
        } catch (rewindErr) {
          lastErr = rewindErr;
        }
      }

      if (!rawText && process.env.EDENAI_API_KEY) {
        try {
          rawText = (await generateChatWithEdenAi(composePrompt, null)).trim();
        } catch (edenErr) {
          lastErr = edenErr;
        }
      }

      if (!rawText) {
        throw lastErr || new Error('Layanan penyusun teks server belum tersedia.');
      }

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText) as {
        reply?: string;
        documentTitle?: string;
        documentContent?: string;
      };

      res.json({
        reply: parsed.reply || 'Teks berhasil disusun.',
        documentTitle: parsed.documentTitle || docTitle,
        documentContent:
          typeof parsed.documentContent === 'string' ? parsed.documentContent : currentDoc,
      });
    } catch (error: unknown) {
      const formatted = formatServerError(error);
      console.error('[/api/compose-text] Error:', error);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const body = req.body as ChatRequestBody;
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const currentDoc = typeof body?.documentContent === 'string' ? body.documentContent : '';
      const docTitle = typeof body?.documentTitle === 'string' ? body.documentTitle : 'Dokumen Tanpa Judul';
      const refFile = body?.referenceFile ?? null;
      const attachedImage = body?.attachedImage ?? null;

      if (messages.length === 0) {
        res.status(400).json({ error: 'Pesan chat tidak boleh kosong.' });
        return;
      }

      const recentHistory = messages.slice(-16);
      const historyTranscript = recentHistory
        .slice(0, -1)
        .map((m) => `${m.role === 'user' ? 'Pengguna' : 'Asisten'}: ${m.content}`)
        .join('\n\n');

      const latestUserMessage = recentHistory[recentHistory.length - 1]?.content ?? '';

      const sanitizedDocForPrompt = currentDoc.replace(
        /!\[([^\]]*)\]\(data:image\/[^)]+\)/g,
        '![$1](inline-image-embedded)'
      );

      const promptParts: string[] = [
        `=== JUDUL DOKUMEN SAAT INI ===\n${docTitle}`,
        `=== DOKUMEN SAAT INI (MARKDOWN) ===\n${
          sanitizedDocForPrompt.trim() ? sanitizedDocForPrompt : '(Dokumen masih kosong)'
        }`,
      ];

      if (refFile && refFile.content) {
        const truncatedRef = refFile.content.slice(0, 40000);
        promptParts.push(
          `=== FILE REFERENSI TERLAMPIR: ${refFile.name} ===\n${truncatedRef}`
        );
      }

      const imagePart = attachedImage?.url
        ? await resolveServerImagePart(attachedImage.url)
        : null;

      if (imagePart && attachedImage) {
        promptParts.push(
          `=== GAMBAR TERLAMPIR UNTUK DIANALISIS: ${attachedImage.name || attachedImage.url} ===\n(Gambar dilampirkan sebagai data visual multimodal)`
        );
      }

      if (historyTranscript) {
        promptParts.push(`=== RIWAYAT PERCAKAPAN SEBELUMNYA ===\n${historyTranscript}`);
      }

      promptParts.push(`=== INSTRUKSI TERBARU PENGGUNA ===\n${latestUserMessage}`);

      const textPrompt = promptParts.join('\n\n');
      let rawText = '';
      let lastModelError: unknown;

      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = getGeminiClient();
          const generateRequest = {
            model: 'gemini-4-hydrogen',
            contents: imagePart
              ? { parts: [imagePart, { text: textPrompt }] }
              : textPrompt,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  reply: {
                    type: Type.STRING,
                    description:
                      'Pesan balasan singkat di kolom chat yang menjelaskan hasil tindakan atau menjawab pertanyaan pengguna.',
                  },
                  documentTitle: {
                    type: Type.STRING,
                    description:
                      'Judul dokumen yang ringkas dan sesuai jika dokumen baru dibuat atau diubah; jika tidak berubah, kembalikan judul dokumen saat ini.',
                  },
                  documentContent: {
                    type: Type.STRING,
                    description:
                      'Seluruh isi dokumen terbaru dalam format Markdown. Jika membuat gambar, sertakan token {{GENERATED_IMAGE}} pada lokasi gambar.',
                  },
                  needsImageGeneration: {
                    type: Type.BOOLEAN,
                    description:
                      'True jika pengguna meminta membuat gambar, ilustrasi, diagram, bagan, poster, ikon, atau logo.',
                  },
                  imageTitle: {
                    type: Type.STRING,
                    description:
                      'Judul singkat gambar jika needsImageGeneration bernilai true.',
                  },
                  imagePrompt: {
                    type: Type.STRING,
                    description:
                      'Deskripsi visual terperinci untuk generator gambar Server AI jika needsImageGeneration bernilai true.',
                  },
                },
                required: [
                  'reply',
                  'documentTitle',
                  'documentContent',
                  'needsImageGeneration',
                  'imageTitle',
                  'imagePrompt',
                ],
              },
            },
          };

          const modelCandidates = [
            { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, attempts: 3 },
            { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, attempts: 2 },
          ];

          for (const candidate of modelCandidates) {
            let succeeded = false;
            for (let attempt = 1; attempt <= candidate.attempts; attempt++) {
              try {
                const response = await ai.models.generateContent({
                  ...generateRequest,
                  model: candidate.model,
                  config: {
                    ...generateRequest.config,
                    thinkingConfig: { thinkingLevel: candidate.thinkingLevel },
                  },
                });
                rawText = (response?.text ?? '').trim();
                if (rawText) {
                  succeeded = true;
                  break;
                }
              } catch (err: unknown) {
                lastModelError = err;
                if (!isTransientAiError(err)) {
                  throw err;
                }
                if (attempt < candidate.attempts) {
                  const backoffMs = Math.round(
                    1100 * Math.pow(1.8, attempt - 1) + Math.random() * 400
                  );
                  await new Promise((resolve) => setTimeout(resolve, backoffMs));
                }
              }
            }
            if (succeeded) {
              break;
            }
            console.warn(
              `[/api/chat] Model ${candidate.model} transient error, trying fallback if available:`,
              lastModelError instanceof Error ? lastModelError.message : lastModelError
            );
          }
        } catch (geminiErr: unknown) {
          lastModelError = geminiErr;
          console.warn(
            '[/api/chat] Gemini failed, checking Rewind AI fallback:',
            geminiErr instanceof Error ? geminiErr.message : geminiErr
          );
        }
      }

      if (!rawText && process.env.REWIND_API_KEY) {
        try {
          rawText = (await generateChatWithRewind(textPrompt, imagePart)).trim();
        } catch (rewindErr: unknown) {
          lastModelError = rewindErr;
          console.warn(
            '[/api/chat] Rewind AI failed, checking Eden AI fallback:',
            rewindErr instanceof Error ? rewindErr.message : rewindErr
          );
        }
      }

      if (!rawText && process.env.EDENAI_API_KEY) {
        try {
          rawText = (await generateChatWithEdenAi(textPrompt, imagePart)).trim();
        } catch (edenErr: unknown) {
          lastModelError = edenErr;
        }
      }

      if (!rawText && lastModelError) {
        throw lastModelError;
      }

      if (!rawText) {
        if (
          !process.env.GEMINI_API_KEY &&
          !process.env.REWIND_API_KEY &&
          !process.env.EDENAI_API_KEY
        ) {
          throw new Error(
            'GEMINI_API_KEY, REWIND_API_KEY, maupun EDENAI_API_KEY belum dikonfigurasi pada environment server.'
          );
        }
        res.status(502).json({ error: 'Model tidak mengembalikan respons.' });
        return;
      }

      let parsed: {
        reply?: unknown;
        documentTitle?: unknown;
        documentContent?: unknown;
        needsImageGeneration?: unknown;
        imageTitle?: unknown;
        imagePrompt?: unknown;
      };
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          res.status(502).json({ error: 'Format respons AI tidak valid.' });
          return;
        }
        parsed = JSON.parse(jsonMatch[0]);
      }

      let reply =
        typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : 'Dokumen telah diproses.';
      const documentTitle =
        typeof parsed.documentTitle === 'string' && parsed.documentTitle.trim()
          ? parsed.documentTitle.trim()
          : docTitle;
      let documentContent =
        typeof parsed.documentContent === 'string' ? parsed.documentContent : currentDoc;

      if (documentContent.includes('(inline-image-embedded)')) {
        const originalDataUrls = Array.from(
          currentDoc.matchAll(/!\[[^\]]*\]\((data:image\/[^)]+)\)/g)
        ).map((m) => m[1]);
        let imgIdx = 0;
        documentContent = documentContent.replace(/\(inline-image-embedded\)/g, () => {
          const restored = originalDataUrls[imgIdx++];
          return restored ? `(${restored})` : '(inline-image-embedded)';
        });
      }

      let generatedImage: GeneratedImageMeta | undefined;
      let pendingImage: { prompt: string; title: string } | undefined;

      if (parsed.needsImageGeneration === true) {
        const imgPrompt =
          typeof parsed.imagePrompt === 'string' && parsed.imagePrompt.trim()
            ? parsed.imagePrompt.trim()
            : latestUserMessage;
        const imgTitle =
          typeof parsed.imageTitle === 'string' && parsed.imageTitle.trim()
            ? parsed.imageTitle.trim()
            : 'Ilustrasi Dokumen';

        if (process.env.REWIND_API_KEY) {
          try {
            generatedImage = await generateImageWithRewind(imgPrompt, imgTitle);
          } catch (rewindImgErr) {
            console.warn('[/api/chat] Rewind image failed, trying Groq/Puter fallback:', rewindImgErr);
          }
        }

        if (!generatedImage && process.env.GROQ_API_KEY) {
          try {
            generatedImage = await generateImageWithGroq(imgPrompt, imgTitle);
          } catch (groqErr) {
            console.warn('[/api/chat] Groq image fallback to Puter:', groqErr);
          }
        }

        if (generatedImage) {
          const markdownImg = `![${generatedImage.title}](${generatedImage.url})`;
          if (documentContent.includes('{{GENERATED_IMAGE}}')) {
            documentContent = documentContent.replace(/\{\{GENERATED_IMAGE\}\}/g, markdownImg);
          } else if (documentContent.trim()) {
            documentContent = `${documentContent.trim()}\n\n${markdownImg}`;
          } else {
            documentContent = `# ${generatedImage.title}\n\n${markdownImg}`;
          }
        } else {
          pendingImage = { prompt: imgPrompt, title: imgTitle };
        }
      } else {
        documentContent = documentContent.replace(/\{\{GENERATED_IMAGE\}\}/g, '').trim();
      }

      res.json({
        reply,
        documentTitle,
        documentContent,
        generatedImage,
        pendingImage,
        imageAnalyzed: Boolean(imagePart),
      });
    } catch (error: unknown) {
      const formatted = formatServerError(error);
      console.error('[/api/chat] Error:', error);
      res.status(formatted.status).json({
        error: formatted.message,
        code: formatted.status,
        retryable: formatted.retryable,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Naskah Studio server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
