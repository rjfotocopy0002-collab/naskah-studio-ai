import React, { useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  FileDown,
  ImageIcon,
  ImagePlus,
  Loader2,
} from 'lucide-react';
import { exportToDocx, exportToPdf } from '../utils/exportDocument';

function allowDocumentUrl(url: string): string {
  const trimmed = url.trim();
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  return defaultUrlTransform(trimmed);
}

function DocumentImage(
  props: React.ImgHTMLAttributes<HTMLImageElement>
) {
  const { src, alt, ...rest } = props;
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span className="flex items-center justify-center gap-2 my-4 px-4 py-6 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-500 font-sans">
        <ImageIcon className="w-4 h-4 text-slate-400 shrink-0" />
        <span>{alt || 'Gambar tidak dapat dimuat'}</span>
      </span>
    );
  }

  return (
    <span className="block my-4 text-center">
      <img
        {...rest}
        src={src}
        alt={alt || 'Gambar dokumen'}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      {alt && (
        <span className="block mt-1.5 text-xs italic text-slate-500 font-sans">
          {alt}
        </span>
      )}
    </span>
  );
}

interface DocumentPanelProps {
  title: string;
  content: string;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
}

export function DocumentPanel({
  title,
  content,
  onTitleChange,
  onContentChange,
}: DocumentPanelProps) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [copied, setCopied] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isInsertingImage, setIsInsertingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wordCount = content.trim()
    ? content.trim().split(/\s+/).filter(Boolean).length
    : 0;
  const charCount = content.length;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
      const temp = document.createElement('textarea');
      temp.value = content;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportDocx = async () => {
    if (isExportingDocx) return;
    setIsExportingDocx(true);
    try {
      await exportToDocx(title, content);
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      await exportToPdf(title, content);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleInsertImageFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsInsertingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
        reader.readAsDataURL(file);
      });

      let finalUrl = dataUrl;
      try {
        const res = await fetch('/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl }),
        });
        if (res.ok) {
          const uploaded = (await res.json()) as { url?: string };
          if (uploaded.url) finalUrl = uploaded.url;
        }
      } catch {
        // Fallback to inline data URL if upload route fails
      }

      const cleanAlt =
        file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() ||
        'Gambar Dokumen';
      const markdownImg = `![${cleanAlt}](${finalUrl})`;

      if (mode === 'edit' && textareaRef.current) {
        const el = textareaRef.current;
        const start = el.selectionStart ?? content.length;
        const end = el.selectionEnd ?? content.length;
        const before = content.slice(0, start);
        const after = content.slice(end);
        const prefix = before && !before.endsWith('\n') ? '\n\n' : '';
        const suffix = after && !after.startsWith('\n') ? '\n\n' : '';
        onContentChange(`${before}${prefix}${markdownImg}${suffix}${after}`);
      } else {
        const trimmed = content.trimEnd();
        onContentChange(trimmed ? `${trimmed}\n\n${markdownImg}` : markdownImg);
      }
    } finally {
      setIsInsertingImage(false);
    }
  };

  return (
    <section
      aria-label="Editor dan Pratinjau Dokumen A4"
      className="flex flex-col h-full min-h-0 workspace-desk-bg"
    >
      {/* Toolbar */}
      <div className="bg-white/90 backdrop-blur-sm border-b border-indigo-100 px-4 sm:px-6 py-3 shrink-0 space-y-2.5 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-4">
        {/* Editable Document Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <input
            type="text"
            dir="auto"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Judul Dokumen..."
            aria-label="Judul Dokumen"
            className="w-full min-w-0 text-sm sm:text-base font-semibold text-indigo-950 placeholder:text-slate-400 bg-indigo-50/50 hover:bg-white focus:bg-white border border-indigo-200/80 hover:border-indigo-300 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/15 rounded-lg px-3 py-1.5 outline-none transition-all"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
          {/* Mode Segmented Switch */}
          <div
            role="tablist"
            aria-label="Mode Dokumen"
            className="inline-flex items-center p-0.5 bg-indigo-50/90 border border-indigo-200/80 rounded-lg shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'preview'}
              onClick={() => setMode('preview')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'preview'
                  ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-indigo-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Pratinjau A4</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'edit'}
              onClick={() => setMode('edit')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'edit'
                  ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-indigo-900'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Langsung</span>
            </button>
          </div>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={handleInsertImageFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isInsertingImage}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
            title="Sisipkan gambar dari perangkat ke dalam dokumen A4"
          >
            {isInsertingImage ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ImagePlus className="w-3.5 h-3.5" />
            )}
            <span>Sisipkan Gambar</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            disabled={!content.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700 font-semibold">Tersalin</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Salin Teks</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!content.trim() || isExportingPdf}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
          >
            {isExportingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileDown className="w-3.5 h-3.5" />
            )}
            <span>Export ke PDF (.pdf)</span>
          </button>

          <button
            type="button"
            onClick={handleExportDocx}
            disabled={!content.trim() || isExportingDocx}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-lg transition-all whitespace-nowrap shrink-0 shadow-xs disabled:opacity-40"
          >
            {isExportingDocx ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Export ke Word (.docx)</span>
          </button>
        </div>
      </div>

      {/* A4 Desk Viewport */}
      <div className="flex-1 overflow-y-auto studio-scroll px-4 py-7 sm:px-8 sm:py-10 min-h-0">
        <div className="mx-auto w-full max-w-[794px]">
          {/* A4 Paper Sheet */}
          <div className="bg-white rounded-[3px] ring-1 ring-indigo-950/[0.07] shadow-[0_4px_12px_rgba(30,41,59,0.06),0_24px_54px_-12px_rgba(67,56,202,0.16)] min-h-[1123px] px-8 py-10 sm:px-16 sm:py-14">
            {mode === 'edit' ? (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-indigo-100 text-xs text-slate-500">
                  <span>Mode Edit Langsung (Markdown)</span>
                  <button
                    type="button"
                    onClick={() => setMode('preview')}
                    className="text-indigo-700 hover:underline font-medium"
                  >
                    Lihat Pratinjau Terformat
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  dir="auto"
                  value={content}
                  onChange={(e) => onContentChange(e.target.value)}
                  placeholder="Mulai mengetik isi dokumen dalam format Markdown di sini, atau minta asisten AI di kolom kiri untuk membuatkannya..."
                  aria-label="Editor Isi Dokumen Markdown"
                  className="w-full min-h-[960px] font-mono text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 bg-transparent resize-y outline-none"
                />
              </div>
            ) : content.trim() ? (
              <div
                onDoubleClick={() => setMode('edit')}
                title="Klik dua kali untuk mengedit dokumen secara langsung"
                className="a4-prose cursor-text"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={allowDocumentUrl}
                  components={{
                    img: DocumentImage,
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center min-h-[700px] px-6">
                <p className="text-base font-semibold text-indigo-950 mb-2">
                  Lembar Kertas A4 Masih Kosong
                </p>
                <p className="text-sm text-slate-500 max-w-md mb-6 leading-relaxed">
                  Gunakan kolom chat di sebelah kiri untuk meminta AI membuat draf dokumen baru, atau mulai mengetik secara langsung di halaman ini.
                </p>
                <button
                  type="button"
                  onClick={() => setMode('edit')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Ketik Langsung di Kertas A4</span>
                </button>
              </div>
            )}
          </div>

          {/* Unboxed Paper Metadata Footer */}
          <div className="flex items-center justify-between px-1 pt-3.5 text-xs text-slate-600 tabular-nums">
            <div className="flex items-center gap-2">
              <span>{wordCount} kata</span>
              <span aria-hidden="true">·</span>
              <span>{charCount} karakter</span>
              <span aria-hidden="true">·</span>
              <span>Kertas A4 (210 × 297 mm)</span>
            </div>
            {mode === 'preview' && content.trim() && (
              <span className="hidden sm:inline text-slate-500">
                Klik dua kali pada kertas untuk edit langsung
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
