import { puter, type ChatOptions } from '@heyputer/puter.js';
import type {
  AttachedImage,
  ChatApiResponse,
  ChatMessage,
  GeneratedImageMeta,
  ReferenceFile,
} from '../types/document';

export { puter };

function normalizeRawErrorText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'Terjadi kesalahan saat menghubungi AI.';

  // Unwrap JSON-serialized API error payloads (e.g. Gemini 503 UNAVAILABLE)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { code?: unknown; message?: unknown; status?: unknown };
        message?: unknown;
      };
      const nestedMsg = parsed?.error?.message ?? parsed?.message;
      const nestedCode = parsed?.error?.code;
      if (nestedCode === 503 || String(parsed?.error?.status || '').toUpperCase() === 'UNAVAILABLE') {
        return 'Server AI sedang mengalami kepadatan permintaan (503). Silakan coba lagi beberapa saat lagi.';
      }
      if (typeof nestedMsg === 'string' && nestedMsg.trim()) {
        return nestedMsg.trim();
      }
    } catch {
      // Keep original text if not valid JSON
    }
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('503') ||
    lower.includes('service unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('"status":"unavailable"')
  ) {
    return 'Server AI sedang sibuk sementara (503). Silakan klik "Coba Lagi" beberapa detik lagi.';
  }

  return trimmed;
}

export function extractErrorMessage(err: unknown): string {
  if (!err) return 'Terjadi kesalahan yang tidak diketahui.';
  if (typeof err === 'string') return normalizeRawErrorText(err);
  if (err instanceof Error) {
    return normalizeRawErrorText(
      err.message || 'Terjadi kesalahan saat memproses permintaan.'
    );
  }

  if (typeof err === 'object') {
    const obj = err as {
      message?: unknown;
      code?: unknown;
      status?: unknown;
      error?: unknown;
    };

    if (typeof obj.message === 'string' && obj.message.trim()) {
      return normalizeRawErrorText(obj.message);
    }
    if (obj.error && typeof obj.error === 'object') {
      const nested = obj.error as { message?: unknown; code?: unknown };
      if (typeof nested.message === 'string' && nested.message.trim()) {
        return normalizeRawErrorText(nested.message);
      }
      if (typeof nested.code === 'string' && nested.code.trim()) {
        return normalizeRawErrorText(`Puter error: ${nested.code.trim()}`);
      }
    }
    if (typeof obj.error === 'string' && obj.error.trim()) {
      return normalizeRawErrorText(obj.error);
    }
    if (typeof obj.code === 'string' && obj.code.trim()) {
      return normalizeRawErrorText(`Kode galat: ${obj.code.trim()}`);
    }
    if (typeof obj.status === 'number') {
      return normalizeRawErrorText(`HTTP ${obj.status}`);
    }
  }

  return 'Terjadi kesalahan saat menghubungi AI.';
}

export function isTransientAiError(err: unknown): boolean {
  const msg = extractErrorMessage(err).toLowerCase();
  const raw =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === 'string'
        ? err.toLowerCase()
        : '';
  const combined = `${msg} ${raw}`;

  if (
    combined.includes('503') ||
    combined.includes('502') ||
    combined.includes('504') ||
    combined.includes('429') ||
    combined.includes('unavailable') ||
    combined.includes('high demand') ||
    combined.includes('overloaded') ||
    combined.includes('resource_exhausted') ||
    combined.includes('kepadatan permintaan') ||
    combined.includes('sibuk sementara') ||
    combined.includes('timeout')
  ) {
    return true;
  }

  if (err && typeof err === 'object') {
    const obj = err as { status?: unknown; code?: unknown };
    const status = Number(obj.status ?? 0);
    if (status === 503 || status === 502 || status === 504 || status === 429) {
      return true;
    }
  }

  return false;
}

async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1100
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isPuterAuthError(err) || !isTransientAiError(err) || attempt === maxAttempts) {
        throw err;
      }
      const delay = Math.round(baseDelayMs * Math.pow(1.7, attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

export function isPuterAuthError(err: unknown): boolean {
  const msg = extractErrorMessage(err).toLowerCase();
  if (
    msg.includes('auth_canceled') ||
    msg.includes('authentication canceled') ||
    msg.includes('reauthentication required') ||
    msg.includes('unauthorized') ||
    msg.includes('401') ||
    msg.includes('token_auth_failed')
  ) {
    return true;
  }
  if (err && typeof err === 'object') {
    const obj = err as { code?: unknown; status?: unknown; error?: { code?: unknown } };
    const code = String(obj.code ?? obj.error?.code ?? '').toLowerCase();
    if (
      code === 'auth_canceled' ||
      code === 'token_auth_failed' ||
      code === 'reauth_required' ||
      obj.status === 401
    ) {
      return true;
    }
  }
  return false;
}

export function isPuterSignedIn(): boolean {
  try {
    return Boolean(puter?.auth?.isSignedIn?.());
  } catch {
    return false;
  }
}

export async function signInPuter(): Promise<boolean> {
  try {
    await puter.auth.signIn();
    return isPuterSignedIn();
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}

const PUTER_SYSTEM_PROMPT = `Kamu adalah Asisten Pembuat dan Editor Dokumen Profesional. Tugas utamamu adalah membantu pengguna menyusun dokumen baru, merangkum, menerjemahkan, merevisi dokumen, serta menangani permintaan pembuatan gambar/ilustrasi.

Aturan Kerja:
1. Selalu periksa konteks "Dokumen Saat Ini" yang dikirimkan bersama pesan pengguna.
2. EKSEKUSI LANGSUNG DALAM SEKALI PERINTAH: Jika pengguna meminta membuat dokumen baru (surat, proposal, artikel, laporan, kontrak, penjelasan mendalam, atau teks Arab), langsung buat dokumen lengkapnya pada bagian [[DOCUMENT]] dalam format Markdown standar yang rapi (#, ##, ###, -, 1., **, *, tabel Markdown). Jangan pernah menunda dengan bertanya balik; gunakan placeholder seperti [Nama Lengkap] atau [Tanggal] bila perlu.
3. PEMBUATAN BARU VS PENGEDITAN:
   - Jika pengguna meminta dokumen baru yang berbeda topik dari Dokumen Saat Ini, buat dokumen baru lengkap dan perbarui [[TITLE]].
   - Jika pengguna meminta revisi atau tambahan pada dokumen aktif, tuliskan seluruh isi dokumen terbaru dengan hanya mengubah bagian yang diminta sambil mempertahankan bagian lainnya.
   - Jika pengguna hanya bertanya atau mengobrol tanpa meminta pembuatan/pengeditan dokumen maupun gambar, tulis persis [[NO_CHANGE]] pada bagian [[DOCUMENT]].
4. PERINTAH MEMBUAT GAMBAR:
   - Jika pengguna meminta membuat gambar, ilustrasi, diagram, poster, ikon, atau logo, sisipkan tepat di lokasi gambar dalam [[DOCUMENT]] tag persis:
     [[IMAGE: Judul Singkat Gambar | Detailed visual prompt in English]]
5. Jangan pernah memasukkan basa-basi percakapan ke dalam [[DOCUMENT]].
6. WAJIB gunakan format penanda persis seperti ini agar dokumen dapat tampil secara live (streaming):

[[TITLE]]
Judul Dokumen Ringkas
[[DOCUMENT]]
Isi lengkap dokumen dalam Markdown (atau [[NO_CHANGE]] jika dokumen tidak berubah)
[[REPLY]]
Pesan balasan singkat untuk pengguna di kolom chat`;

const PUTER_ANALYSIS_SYSTEM_PROMPT = `Kamu adalah Editor Senior dan Analis Kualitas Dokumen Profesional yang dilengkapi kemampuan pencarian web (web_search). Tugasmu adalah menganalisis BENTUK (struktur, hierarki heading, tabel Markdown, kerapian format) dan TULISAN YANG BENAR (ejaan EYD V/PUEBI, tata bahasa, istilah baku, tanda baca, serta keakuratan fakta/tautan URL) di dalam dokumen.

Aturan Kerja:
1. Periksa "Dokumen Saat Ini" secara teliti maupun tautan URL atau topik faktual yang ditanyakan pengguna (gunakan tool web_search bila perlu memverifikasi fakta terbaru atau merangkum URL).
2. Jika pengguna meminta memperbaiki/mengoreksi/merapikan dokumen, tuliskan versi dokumen yang sudah diperbaiki secara lengkap di bagian [[DOCUMENT]] dan jelaskan daftar temuan serta perbaikannya secara ringkas dan jelas di [[REPLY]].
3. Jika pengguna hanya meminta analisis, evaluasi, pemeriksaan, atau ringkasan tanpa meminta mengubah dokumen, tulis [[NO_CHANGE]] di bagian [[DOCUMENT]] dan sajikan hasil analisis bentuk & tulisan yang benar secara terstruktur di [[REPLY]].
4. WAJIB gunakan format penanda persis:

[[TITLE]]
Judul Dokumen
[[DOCUMENT]]
Isi dokumen Markdown hasil koreksi atau [[NO_CHANGE]]
[[REPLY]]
Hasil analisis bentuk, struktur, dan ketepatan tulisan/fakta`;

const PUTER_IMAGE_ANALYSIS_PROMPT = `Kamu adalah Asisten Analis Visual & Dokumen Profesional. Pengguna melampirkan sebuah gambar untuk dianalisis.

Aturan Kerja:
1. Jawab dalam bahasa yang sama dengan pertanyaan pengguna (default Bahasa Indonesia jika tidak jelas).
2. Deskripsikan isi gambar secara akurat, jelas, dan terstruktur (objek utama, teks yang terbaca/OCR bila ada, konteks, warna/komposisi, serta detail penting).
3. PEMBUATAN / PEMBARUAN DOKUMEN A4 VS JAWABAN CHAT:
   - Jika pengguna meminta membuat atau memperbarui dokumen/laporan/ringkasan/artikel dari gambar ini, tuliskan isi dokumen Markdown lengkap di bagian [[DOCUMENT]], perbarui [[TITLE]] jika relevan, dan tulis ringkasan balasan di [[REPLY]].
   - Jika pengguna hanya bertanya tentang isi gambar (misal "What do you see in this image?", "Apa yang ada di gambar ini?", "Analisis gambar ini"), tulis persis [[NO_CHANGE]] di bagian [[DOCUMENT]] dan sajikan seluruh hasil analisis gambar di [[REPLY]].
4. Gunakan format penanda persis:

[[TITLE]]
Judul Dokumen
[[DOCUMENT]]
Isi dokumen Markdown atau [[NO_CHANGE]]
[[REPLY]]
Hasil analisis gambar yang lengkap dan mudah dibaca`;

function shouldUseAnalysisModel(prompt: string): boolean {
  return /\b(analisis|analisa|periksa|cek|koreksi|typo|ejaan|eyd|puebi|kbbi|tata\s*bahasa|struktur|bentuk|tulisan\s*yang\s*benar|evaluasi|audit|verifikasi|fakta|ringkas|summarize)\b|https?:\/\//i.test(
    prompt
  );
}

function extractTextFromPuterResponse(res: unknown): string {
  if (typeof res === 'string') return res;
  if (!res || typeof res !== 'object') return '';

  const obj = res as {
    message?: { content?: unknown };
    result?: { message?: { content?: unknown } };
    choices?: Array<{ message?: { content?: unknown } }>;
    text?: unknown;
    toString?: () => string;
  };

  const content =
    obj.message?.content ??
    obj.result?.message?.content ??
    obj.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.toString === 'function') {
    const str = obj.toString();
    if (str !== '[object Object]') return str;
  }
  return '';
}

async function rasterizeSvgUrlToPngDataUrl(svgUrl: string): Promise<string> {
  const res = await fetch(svgUrl);
  const svgText = await res.text();
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 1200;
        const h = img.naturalHeight || 750;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak tersedia untuk konversi gambar.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Gagal memuat gambar SVG.'));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function resolveImageForVision(imageUrl: string): Promise<string> {
  const trimmed = imageUrl.trim();
  if (!trimmed) {
    throw new Error('URL atau sumber gambar tidak boleh kosong.');
  }

  const isSvg =
    trimmed.startsWith('data:image/svg+xml') ||
    trimmed.toLowerCase().split('?')[0].endsWith('.svg');

  if (isSvg) {
    return rasterizeSvgUrlToPngDataUrl(trimmed);
  }

  // Public HTTP(S) URLs can be passed directly to puter.ai.chat(prompt, url, { model: 'gpt-6-luna' })
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Same-origin relative paths (e.g. /api/images/...) must be converted to a data URL
  // because Puter cloud servers cannot fetch localhost/relative URLs.
  if (trimmed.startsWith('/') || trimmed.startsWith('blob:')) {
    const res = await fetch(trimmed);
    if (!res.ok) {
      throw new Error('Gagal membaca gambar lokal untuk dianalisis.');
    }
    const blob = await res.blob();
    if (blob.type.includes('svg')) {
      return rasterizeSvgUrlToPngDataUrl(trimmed);
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Gagal mengonversi gambar.'));
      reader.readAsDataURL(blob);
    });
  }

  return trimmed;
}

export interface PuterStreamUpdate {
  documentTitle?: string;
  documentContent?: string;
}

function stripTrailingMarkerFragment(text: string): string {
  // Prevent partial marker tokens like "[[RE", "[[REPLY", or incomplete "[[IMAGE:..." from flickering on screen
  return text
    .replace(/\[\[IMAGE:[^\]]*$/i, '')
    .replace(/\[\[(?:T|TI|TIT|TITL|TITLE|D|DO|DOC|DOCU|DOCUM|DOCUME|DOCUMEN|DOCUMENT|R|RE|REP|REPL|REPLY|N|NO|NO_|NO_C|NO_CH|NO_CHA|NO_CHAN|NO_CHANG|NO_CHANGE)?\]?$/i, '')
    .replace(/\[$/i, '');
}

function parseStreamingSections(
  fullBuffer: string,
  fallbackTitle: string,
  fallbackDoc: string
): {
  title: string;
  doc: string | null;
  reply: string;
  hasMarkers: boolean;
} {
  const titleIdx = fullBuffer.indexOf('[[TITLE]]');
  const docIdx = fullBuffer.indexOf('[[DOCUMENT]]');
  const replyIdx = fullBuffer.indexOf('[[REPLY]]');
  const hasMarkers = titleIdx !== -1 || docIdx !== -1 || replyIdx !== -1;

  if (!hasMarkers) {
    // Fallback if model outputs plain Markdown directly without markers
    const trimmed = fullBuffer.trimStart();
    if (trimmed.length > 40 && !trimmed.startsWith('[')) {
      return {
        title: fallbackTitle,
        doc: stripTrailingMarkerFragment(fullBuffer),
        reply: '',
        hasMarkers: false,
      };
    }
    return { title: fallbackTitle, doc: null, reply: '', hasMarkers: false };
  }

  let title = fallbackTitle;
  if (titleIdx !== -1) {
    const titleStart = titleIdx + '[[TITLE]]'.length;
    const titleEnd =
      docIdx !== -1 ? docIdx : replyIdx !== -1 ? replyIdx : fullBuffer.length;
    const rawTitle = fullBuffer.slice(titleStart, titleEnd).trim();
    if (docIdx !== -1 && rawTitle) {
      title = rawTitle.split('\n')[0].trim() || fallbackTitle;
    }
  }

  let doc: string | null = null;
  if (docIdx !== -1) {
    const docStart = docIdx + '[[DOCUMENT]]'.length;
    const docEnd = replyIdx !== -1 ? replyIdx : fullBuffer.length;
    const rawDoc = fullBuffer.slice(docStart, docEnd).replace(/^\r?\n/, '');
    const cleanedDoc = stripTrailingMarkerFragment(rawDoc);
    const trimmedCheck = cleanedDoc.trim();

    if (
      trimmedCheck === '[[NO_CHANGE]]' ||
      trimmedCheck.startsWith('[[NO_CHANGE') ||
      trimmedCheck === '[[NO_CH'
    ) {
      doc = fallbackDoc;
    } else if (cleanedDoc.trim().length > 0) {
      doc = cleanedDoc;
    }
  }

  let reply = '';
  if (replyIdx !== -1) {
    reply = fullBuffer.slice(replyIdx + '[[REPLY]]'.length).trim();
  }

  return { title, doc, reply, hasMarkers: true };
}

async function waitForImageReady(imgEl: HTMLImageElement): Promise<string> {
  if (!imgEl) {
    throw new Error('Puter AI tidak mengembalikan elemen gambar.');
  }

  if (
    (!imgEl.complete || imgEl.naturalWidth === 0) &&
    imgEl.src &&
    !imgEl.src.startsWith('data:')
  ) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 20000);
      imgEl.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      imgEl.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Gagal memuat gambar dari Puter AI.'));
      };
      if (imgEl.complete && imgEl.naturalWidth > 0) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  // Normalize image into a clean PNG data URL when canvas access allows,
  // and persist via /api/images/upload so the Markdown document stays compact.
  let finalUrl = imgEl.src;
  try {
    const w = imgEl.naturalWidth || imgEl.width || 1024;
    const h = imgEl.naturalHeight || imgEl.height || 1024;
    if (w > 0 && h > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(imgEl, 0, 0, w, h);
        finalUrl = canvas.toDataURL('image/png');
      }
    }
  } catch {
    // Fallback to direct image src if tainted by CORS
  }

  if (!finalUrl) {
    throw new Error('Puter AI tidak mengembalikan sumber gambar.');
  }

  if (finalUrl.startsWith('data:image/')) {
    try {
      const uploadRes = await fetch('/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: finalUrl }),
      });
      if (uploadRes.ok) {
        const uploaded = (await uploadRes.json()) as { url?: string };
        if (uploaded.url) return uploaded.url;
      }
    } catch {
      // Fallback to returning data URL directly
    }
  }

  return finalUrl;
}

export async function generateImageWithPuter(
  prompt: string,
  title: string
): Promise<GeneratedImageMeta> {
  try {
    let usedModel = 'gpt-image-2.6-flare';
    let imgEl: HTMLImageElement;

    try {
      imgEl = await withTransientRetry(
        () =>
          puter.ai.txt2img(prompt, {
            model: 'gpt-image-2.6-flare',
          }),
        2,
        1200
      );
    } catch (primaryErr) {
      if (isPuterAuthError(primaryErr) || !isTransientAiError(primaryErr)) {
        throw primaryErr;
      }
      // Fallback to Puter default image model if gpt-image-2.6-flare returns 503
      usedModel = 'gpt-image-2';
      imgEl = await withTransientRetry(
        () =>
          puter.ai.txt2img(prompt, {
            model: 'gpt-image-2',
          }),
        2,
        1200
      );
    }

    const url = await waitForImageReady(imgEl);
    return {
      url,
      title: title.trim() || 'Ilustrasi Dokumen',
      engine: `Puter AI (${usedModel})`,
    };
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}

export async function runPuterDocumentChat(params: {
  messages: Pick<ChatMessage, 'role' | 'content'>[];
  documentContent: string;
  documentTitle: string;
  referenceFile: ReferenceFile | null;
  attachedImage?: AttachedImage | null;
  onStreamUpdate?: (update: PuterStreamUpdate) => void;
}): Promise<ChatApiResponse> {
  const {
    messages,
    documentContent,
    documentTitle,
    referenceFile,
    attachedImage,
    onStreamUpdate,
  } = params;
  const recentHistory = messages.slice(-14);
  const historyTranscript = recentHistory
    .slice(0, -1)
    .map((m) => `${m.role === 'user' ? 'Pengguna' : 'Asisten'}: ${m.content}`)
    .join('\n\n');
  const latestUserMessage = recentHistory[recentHistory.length - 1]?.content ?? '';

  // Avoid bloating the prompt if an inline data URL is already embedded
  const sanitizedDocForPrompt = documentContent.replace(
    /!\[([^\]]*)\]\(data:image\/[^)]+\)/g,
    '![$1](inline-image-embedded)'
  );

  const contextParts: string[] = [
    `=== JUDUL DOKUMEN SAAT INI ===\n${documentTitle}`,
    `=== DOKUMEN SAAT INI (MARKDOWN) ===\n${
      sanitizedDocForPrompt.trim() ? sanitizedDocForPrompt : '(Dokumen masih kosong)'
    }`,
  ];

  if (referenceFile && referenceFile.content) {
    contextParts.push(
      `=== FILE REFERENSI TERLAMPIR: ${referenceFile.name} ===\n${referenceFile.content.slice(
        0,
        30000
      )}`
    );
  }

  if (historyTranscript) {
    contextParts.push(`=== RIWAYAT PERCAKAPAN SEBELUMNYA ===\n${historyTranscript}`);
  }

  contextParts.push(`=== INSTRUKSI TERBARU PENGGUNA ===\n${latestUserMessage}`);

  let fullBuffer = '';
  let lastStreamedDoc = documentContent;
  let lastStreamedTitle = documentTitle;
  const isImageAnalysis = Boolean(attachedImage?.url);
  const useAnalysisModel = !isImageAnalysis && shouldUseAnalysisModel(latestUserMessage);

  try {
    if (isImageAnalysis && attachedImage) {
      const visionImageUrl = await resolveImageForVision(attachedImage.url);
      const visionPrompt = `${PUTER_IMAGE_ANALYSIS_PROMPT}\n\n${contextParts.join('\n\n')}`;
      const visionResponse = await withTransientRetry(
        () =>
          puter.ai.chat(visionPrompt, visionImageUrl, {
            model: 'gpt-6-luna',
          }),
        2,
        1200
      );

      fullBuffer = extractTextFromPuterResponse(visionResponse);
    } else {
      let usedFallbackStream = !useAnalysisModel;

      if (useAnalysisModel) {
        try {
          const analysisResponse = await withTransientRetry(
            () =>
              puter.ai.chat(
                [
                  { role: 'system', content: PUTER_ANALYSIS_SYSTEM_PROMPT },
                  { role: 'user', content: contextParts.join('\n\n') },
                ],
                {
                  model: 'openai/gpt-6-luna',
                  tools: [{ type: 'web_search' }] as unknown as NonNullable<
                    ChatOptions['tools']
                  >,
                  normalize: true,
                }
              ),
            2,
            1000
          );

          fullBuffer = extractTextFromPuterResponse(analysisResponse);
          if (!fullBuffer.trim()) {
            usedFallbackStream = true;
          }
        } catch (analysisErr) {
          if (isPuterAuthError(analysisErr)) {
            throw analysisErr;
          }
          usedFallbackStream = true;
        }
      }

      if (usedFallbackStream) {
        const stream = await withTransientRetry(
          () =>
            puter.ai.chat(
              [
                { role: 'system', content: PUTER_SYSTEM_PROMPT },
                { role: 'user', content: contextParts.join('\n\n') },
              ],
              {
                stream: true,
                model: 'gpt-5.4-nano',
              }
            ),
          2,
          1000
        );

        for await (const part of stream) {
          if (part?.type === 'error') {
            throw part;
          }
          const chunkText = part?.text;
          if (typeof chunkText === 'string' && chunkText.length > 0) {
            fullBuffer += chunkText;
            const liveParsed = parseStreamingSections(
              fullBuffer,
              documentTitle,
              documentContent
            );

            const nextLiveTitle = liveParsed.title || lastStreamedTitle;
            const nextLiveDoc =
              liveParsed.doc !== null ? liveParsed.doc : lastStreamedDoc;

            if (
              nextLiveTitle !== lastStreamedTitle ||
              nextLiveDoc !== lastStreamedDoc
            ) {
              lastStreamedTitle = nextLiveTitle;
              lastStreamedDoc = nextLiveDoc;
              onStreamUpdate?.({
                documentTitle: nextLiveTitle,
                documentContent: nextLiveDoc,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    const errorObj = new Error(extractErrorMessage(err)) as Error & {
      isPuterAuth?: boolean;
    };
    errorObj.isPuterAuth = isPuterAuthError(err);
    throw errorObj;
  }

  const rawText = fullBuffer.trim();
  if (!rawText) {
    throw new Error('Puter AI tidak mengembalikan respons.');
  }

  const finalParsed = parseStreamingSections(
    rawText,
    documentTitle,
    documentContent
  );

  const nextTitle = finalParsed.title || documentTitle;
  let nextContent =
    finalParsed.doc !== null ? finalParsed.doc.trim() : documentContent;
  let reply = finalParsed.reply;

  if (!finalParsed.hasMarkers) {
    if (isImageAnalysis) {
      // Plain text vision response: show full analysis in chat without overwriting A4 document
      nextContent = documentContent;
      reply = rawText;
    } else {
      // If the model returned plain Markdown directly, keep it in documentContent and provide a clean reply
      nextContent = rawText;
      reply =
        reply ||
        'Dokumen telah selesai disusun secara streaming menggunakan Puter.js (gpt-5.4-nano).';
    }
  } else if (!reply) {
    reply =
      nextContent.trim() !== documentContent.trim()
        ? 'Dokumen telah disusun dan diperbarui secara langsung di kertas A4.'
        : 'Permintaan telah diproses.';
  }

  // Restore inline data URLs if the model echoed our placeholder token
  if (nextContent.includes('(inline-image-embedded)')) {
    const originalDataUrls = Array.from(
      documentContent.matchAll(/!\[[^\]]*\]\((data:image\/[^)]+)\)/g)
    ).map((m) => m[1]);
    let idx = 0;
    nextContent = nextContent.replace(/\(inline-image-embedded\)/g, () => {
      const restored = originalDataUrls[idx++];
      return restored ? `(${restored})` : '(inline-image-embedded)';
    });
  }

  let generatedImage: GeneratedImageMeta | undefined;
  const imageTagRegex = /\[\[IMAGE:\s*([^|\]]+)\|\s*([^\]]+)\]\]/i;
  const imageTagMatch =
    nextContent.match(imageTagRegex) || reply.match(imageTagRegex);

  if (imageTagMatch) {
    const imgTitle = imageTagMatch[1].trim() || 'Ilustrasi Dokumen';
    const imgPrompt = imageTagMatch[2].trim() || latestUserMessage;

    generatedImage = await generateImageWithPuter(imgPrompt, imgTitle);
    const markdownImg = `![${generatedImage.title}](${generatedImage.url})`;

    if (imageTagRegex.test(nextContent)) {
      nextContent = nextContent.replace(
        /\[\[IMAGE:\s*[^|\]]+\|\s*[^\]]+\]\]/gi,
        markdownImg
      );
    } else {
      nextContent = nextContent.trim()
        ? `${nextContent.trim()}\n\n${markdownImg}`
        : `# ${generatedImage.title}\n\n${markdownImg}`;
    }
    reply = reply.replace(/\[\[IMAGE:\s*[^|\]]+\|\s*[^\]]+\]\]/gi, '').trim();
  }

  return {
    reply,
    documentTitle: nextTitle,
    documentContent: nextContent,
    generatedImage,
    imageAnalyzed: isImageAnalysis,
  };
}
