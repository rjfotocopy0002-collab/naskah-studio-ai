import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Download,
  FileCheck2,
  FilePlus2,
  FileText,
  ImageIcon,
  Link2,
  Loader2,
  Paperclip,
  PenLine,
  RotateCcw,
  ScanEye,
  Sparkles,
  X,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { CHAT_STARTER_PROMPTS } from '../data/presets';
import {
  AiEngine,
  AttachedImage,
  ChatMessage,
  ReferenceFile,
} from '../types/document';
import { parseReferenceFile } from '../utils/exportDocument';

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
  aiEngine: AiEngine;
  onAiEngineChange: (engine: AiEngine) => void;
  puterSignedIn: boolean;
  onSignInPuter: () => void;
  hasDocumentContent?: boolean;
  referenceFile: ReferenceFile | null;
  onAttachFile: (file: ReferenceFile | null) => void;
  attachedImage: AttachedImage | null;
  onAttachImage: (image: AttachedImage | null) => void;
  onInsertAnalysisToDocument?: (analysisText: string, image?: AttachedImage) => void;
  onGenerateImage?: (prompt: string) => void;
  onSendMessage: (text: string) => void;
  onClearChat: () => void;
  onOpenDocument?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatPanel({
  messages,
  isLoading,
  error,
  onRetry,
  aiEngine,
  onAiEngineChange,
  puterSignedIn,
  onSignInPuter,
  hasDocumentContent = false,
  referenceFile,
  onAttachFile,
  attachedImage,
  onAttachImage,
  onInsertAnalysisToDocument,
  onGenerateImage,
  onSendMessage,
  onClearChat,
  onOpenDocument,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState('');
  const [showImageGenInput, setShowImageGenInput] = useState(false);
  const [imageGenDraft, setImageGenDraft] = useState('');
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const readImageFileAsAttached = async (file: File) => {
    setFileError(null);
    if (!file.type.startsWith('image/')) {
      setFileError('Format gambar tidak didukung. Gunakan PNG, JPEG, WebP, atau GIF.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setFileError('Ukuran gambar maksimal 8 MB.');
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
        reader.readAsDataURL(file);
      });
      onAttachImage({
        name: file.name || 'gambar-terlampir.png',
        url: dataUrl,
        mimeType: file.type,
        size: file.size,
      });
      setShowImageUrlInput(false);
    } catch (err: unknown) {
      setFileError(
        err instanceof Error ? err.message : 'Gagal memuat file gambar.'
      );
    }
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await readImageFileAsAttached(file);
  };

  const handleAttachImageUrl = (rawUrl?: string) => {
    const targetUrl = (rawUrl ?? imageUrlDraft).trim();
    if (!targetUrl) return;
    if (!/^https?:\/\//i.test(targetUrl) && !targetUrl.startsWith('data:image/')) {
      setFileError('Masukkan URL gambar yang diawali http:// atau https://.');
      return;
    }
    setFileError(null);
    const derivedName =
      targetUrl.split('/').pop()?.split('?')[0] || 'gambar-url';
    onAttachImage({
      name: derivedName,
      url: targetUrl,
    });
    setImageUrlDraft('');
    setShowImageUrlInput(false);
  };

  const handleTextareaPaste = async (
    e: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((item) => item.type.startsWith('image/'));
    if (imgItem) {
      const file = imgItem.getAsFile();
      if (file) {
        e.preventDefault();
        await readImageFileAsAttached(file);
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setFileError(null);
    setIsParsingFile(true);
    try {
      const parsed = await parseReferenceFile(file);
      onAttachFile(parsed);
    } catch (err: unknown) {
      setFileError(
        err instanceof Error ? err.message : 'Gagal membaca file referensi.'
      );
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && !attachedImage) || isLoading) return;
    const messageToSend =
      trimmed || 'Apa yang terlihat pada gambar ini? Analisis secara detail.';
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSendMessage(messageToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInputResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleDownloadPng = async (msgId: string, url: string, title: string) => {
    if (downloadingImageId) return;
    setDownloadingImageId(msgId);
    try {
      const safeName =
        title
          .trim()
          .replace(/[^a-zA-Z0-9\s-_]/g, '')
          .replace(/\s+/g, '-')
          .toLowerCase() || 'gambar-ai';

      const response = await fetch(url);
      const blob = await response.blob();
      const isSvg =
        blob.type.includes('svg') ||
        url.startsWith('data:image/svg+xml') ||
        url.toLowerCase().split('?')[0].endsWith('.svg');

      let sourceUrl: string;
      if (isSvg) {
        const svgText = await blob.text();
        const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        sourceUrl = URL.createObjectURL(svgBlob);
      } else {
        sourceUrl = URL.createObjectURL(blob);
      }

      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = isSvg ? 1600 : img.naturalWidth || 1600;
          canvas.height = isSvg ? 1000 : img.naturalHeight || 1000;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(sourceUrl);
            reject(new Error('Canvas tidak tersedia'));
            return;
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(sourceUrl);
          canvas.toBlob((pngBlob) => {
            if (pngBlob) {
              saveAs(pngBlob, `${safeName}.png`);
            }
            resolve();
          }, 'image/png');
        };
        img.onerror = () => {
          URL.revokeObjectURL(sourceUrl);
          reject(new Error('Gagal merender gambar PNG'));
        };
        img.src = sourceUrl;
      });
    } catch {
      setFileError('Gagal mengunduh gambar PNG.');
    } finally {
      setDownloadingImageId(null);
    }
  };

  return (
    <section
      aria-label="Asisten Chat Dokumen"
      className="flex flex-col h-full min-h-0 bg-white border-r border-indigo-100"
    >
      {/* Sub-header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 bg-gradient-to-r from-indigo-50/90 via-white to-sky-50/70 border-b border-indigo-100 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-indigo-950">
            Asisten Penulisan
          </h2>
          <p className="text-xs text-slate-600 truncate">
            {aiEngine === 'puter'
              ? 'Puter.js aktif (gpt-5.4-nano, gpt-6-luna vision & gpt-image-2.6-flare)'
              : 'Instruksikan pembuatan, revisi, atau analisis & pembuatan gambar'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            role="radiogroup"
            aria-label="Mesin AI Chat"
            className="inline-flex items-center p-0.5 bg-indigo-50/90 border border-indigo-200/80 rounded-lg"
          >
            <button
              type="button"
              role="radio"
              aria-checked={aiEngine === 'server'}
              onClick={() => onAiEngineChange('server')}
              title="Server AI (Gemini + Eden AI + Rewind AI)"
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                aiEngine === 'server'
                  ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-indigo-900'
              }`}
            >
              Server AI
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={aiEngine === 'puter'}
              onClick={() => onAiEngineChange('puter')}
              title="Puter.js AI (gpt-5.4-nano)"
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                aiEngine === 'puter'
                  ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-indigo-900'
              }`}
            >
              Puter.js
            </button>
          </div>

          {aiEngine === 'puter' && !puterSignedIn && (
            <button
              type="button"
              onClick={onSignInPuter}
              className="px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors whitespace-nowrap shrink-0"
              title="Masuk ke akun Puter agar mode Puter.js berjalan langsung"
            >
              Masuk Puter
            </button>
          )}

          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClearChat}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:bg-indigo-100/70 rounded-md transition-colors whitespace-nowrap shrink-0"
              title="Mulai percakapan baru"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto studio-scroll chat-surface-bg px-5 py-5 space-y-5 min-h-0">
        {messages.length === 0 ? (
          <div className="py-4 space-y-5">
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-indigo-950">
                Siap menyusun atau menyunting dokumen Anda.
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                Ketik instruksi di bawah untuk membuat dokumen baru, merevisi teks di kertas A4 sebelah kanan, atau unggah file referensi (.txt, .md, .docx).
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium text-indigo-700">
                Contoh instruksi cepat
              </p>
              <div className="grid grid-cols-1 gap-2">
                {CHAT_STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onSendMessage(prompt)}
                    disabled={isLoading}
                    className="text-left px-3.5 py-2.5 text-sm text-slate-700 bg-white hover:bg-indigo-50/80 hover:text-indigo-950 border border-indigo-100 hover:border-indigo-300 shadow-[0_1px_3px_rgba(79,70,229,0.05)] rounded-lg transition-all disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[88%] space-y-1.5">
                  {msg.referenceFileName && (
                    <div className="flex items-center justify-end gap-1.5 text-xs text-sky-700">
                      <FileText className="w-3.5 h-3.5" />
                      <span>Referensi: {msg.referenceFileName}</span>
                    </div>
                  )}
                  {msg.attachedImage && (
                    <div className="flex justify-end">
                      <div className="inline-flex flex-col items-end gap-1 p-1.5 bg-white border border-indigo-200 rounded-xl shadow-xs">
                        <img
                          src={msg.attachedImage.url}
                          alt={msg.attachedImage.name}
                          referrerPolicy="no-referrer"
                          className="max-h-36 max-w-[220px] w-auto rounded-lg object-contain bg-slate-50 block"
                        />
                        <span className="text-[11px] text-slate-500 max-w-[210px] truncate px-1">
                          {msg.attachedImage.name}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-sm rounded-xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  <div className="text-right text-[11px] text-slate-400 tabular-nums">
                    {msg.timestamp}
                  </div>
                </div>
              ) : (
                <div className="max-w-[94%] space-y-2">
                  <div className="bg-white border border-indigo-100 shadow-[0_2px_8px_rgba(79,70,229,0.06)] text-slate-800 rounded-xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                    {msg.generatedImage && (
                      <div className="mt-3 pt-3 border-t border-indigo-100 space-y-2">
                        {failedImages[msg.id] ? (
                          <div className="flex items-center gap-2 p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                            <ImageIcon className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>{msg.generatedImage.title}</span>
                          </div>
                        ) : (
                          <img
                            src={msg.generatedImage.url}
                            alt={msg.generatedImage.title}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedImages((prev) => ({ ...prev, [msg.id]: true }))
                            }
                            className="w-full h-auto rounded-lg border border-slate-200 bg-white block"
                          />
                        )}
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <span className="font-medium text-slate-700 truncate block">
                              {msg.generatedImage.title}
                            </span>
                            {msg.generatedImage.engine && (
                              <span className="text-[11px] text-slate-400 truncate block">
                                {msg.generatedImage.engine}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleDownloadPng(
                                msg.id,
                                msg.generatedImage!.url,
                                msg.generatedImage!.title
                              )
                            }
                            disabled={downloadingImageId === msg.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                          >
                            {downloadingImageId === msg.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            <span>Unduh PNG</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 tabular-nums">
                    <span>{msg.timestamp}</span>
                    {msg.documentUpdated && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-700 font-semibold">
                          Dokumen A4 diperbarui
                        </span>
                        {onOpenDocument && (
                          <button
                            type="button"
                            onClick={onOpenDocument}
                            className="lg:hidden text-indigo-700 font-semibold underline underline-offset-2 ml-1"
                          >
                            Buka Kertas A4
                          </button>
                        )}
                      </>
                    )}
                    {msg.imageAnalyzed && !msg.documentUpdated && onInsertAnalysisToDocument && (
                      <>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() =>
                            onInsertAnalysisToDocument(msg.content, msg.attachedImage)
                          }
                          className="inline-flex items-center gap-1 text-indigo-700 hover:text-indigo-900 font-semibold hover:underline underline-offset-2"
                        >
                          <FilePlus2 className="w-3 h-3" />
                          <span>Salin ke Dokumen A4</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex items-start">
            <div className="inline-flex items-center gap-2.5 bg-white border border-indigo-100 shadow-[0_2px_8px_rgba(79,70,229,0.06)] text-indigo-900 rounded-xl px-4 py-2.5 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span>Menyusun respons dan memperbarui dokumen...</span>
            </div>
          </div>
        )}

        {(error || fileError) && (
          <div
            role="alert"
            className="flex items-start justify-between gap-2.5 p-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-snug">{error || fileError}</span>
            </div>
            {error && onRetry && !isLoading && (
              <button
                type="button"
                onClick={onRetry}
                className="px-2.5 py-1 text-xs font-semibold text-rose-800 bg-white hover:bg-rose-100 border border-rose-300 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                Coba Lagi
              </button>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="p-4 border-t border-indigo-100 bg-white shrink-0 space-y-2.5">
        {referenceFile && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-900">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-sky-600 shrink-0" />
              <span className="font-medium truncate">{referenceFile.name}</span>
              <span className="text-sky-400 shrink-0" aria-hidden="true">
                ·
              </span>
              <span className="text-sky-700 tabular-nums shrink-0">
                {formatFileSize(referenceFile.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onAttachFile(null)}
              aria-label="Hapus file referensi"
              className="p-1 text-sky-500 hover:text-sky-800 rounded transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {attachedImage && (
          <div className="flex items-center justify-between gap-2.5 px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-950">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={attachedImage.url}
                alt={attachedImage.name}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-md object-cover border border-violet-200 bg-white shrink-0"
              />
              <div className="min-w-0">
                <p className="font-medium truncate">{attachedImage.name}</p>
                <p className="text-[11px] text-violet-700 truncate">
                  Analisis visual: {aiEngine === 'puter' ? 'Puter gpt-6-luna' : 'Gemini Vision'}
                  {attachedImage.size ? ` · ${formatFileSize(attachedImage.size)}` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onAttachImage(null)}
              aria-label="Hapus lampiran gambar"
              className="p-1 text-violet-500 hover:text-violet-800 rounded transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {showImageGenInput && onGenerateImage && (
          <div className="flex items-center gap-2 px-2.5 py-2 bg-amber-50/80 border border-amber-200 rounded-lg">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <input
              type="text"
              value={imageGenDraft}
              onChange={(e) => setImageGenDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const prompt = imageGenDraft.trim();
                  if (prompt && !isLoading) {
                    setImageGenDraft('');
                    setShowImageGenInput(false);
                    onGenerateImage(prompt);
                  }
                }
              }}
              placeholder="Prompt gambar AI (misal: A futuristic cityscape at night)"
              aria-label="Prompt untuk membuat gambar AI"
              className="flex-1 min-w-0 text-xs text-slate-900 placeholder:text-slate-400 bg-white border border-amber-200 rounded-md px-2.5 py-1.5 outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => setImageGenDraft('A futuristic cityscape at night')}
              className="px-2 py-1.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              title="Isi contoh prompt: A futuristic cityscape at night"
            >
              Contoh
            </button>
            <button
              type="button"
              onClick={() => {
                const prompt = imageGenDraft.trim();
                if (!prompt || isLoading) return;
                setImageGenDraft('');
                setShowImageGenInput(false);
                onGenerateImage(prompt);
              }}
              disabled={!imageGenDraft.trim() || isLoading}
              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Buat
            </button>
            <button
              type="button"
              onClick={() => setShowImageGenInput(false)}
              aria-label="Tutup pembuat gambar AI"
              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {showImageUrlInput && (
          <div className="flex items-center gap-2 px-2.5 py-2 bg-indigo-50/70 border border-indigo-200 rounded-lg">
            <Link2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <input
              type="url"
              value={imageUrlDraft}
              onChange={(e) => setImageUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAttachImageUrl();
                }
              }}
              placeholder="Tempel URL gambar (misal: https://assets.puter.site/doge.jpeg)"
              aria-label="URL Gambar untuk dianalisis"
              className="flex-1 min-w-0 text-xs text-slate-900 placeholder:text-slate-400 bg-white border border-indigo-200 rounded-md px-2.5 py-1.5 outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => handleAttachImageUrl('https://assets.puter.site/doge.jpeg')}
              className="px-2 py-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              title="Gunakan contoh gambar doge.jpeg"
            >
              Contoh
            </button>
            <button
              type="button"
              onClick={() => handleAttachImageUrl()}
              disabled={!imageUrlDraft.trim()}
              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Lampirkan
            </button>
            <button
              type="button"
              onClick={() => setShowImageUrlInput(false)}
              aria-label="Tutup input URL gambar"
              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="border border-indigo-200 focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-600/15 rounded-xl bg-white shadow-[0_1px_3px_rgba(79,70,229,0.05)] transition-all"
        >
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={handleInputResize}
            onKeyDown={handleKeyDown}
            onPaste={handleTextareaPaste}
            placeholder={
              attachedImage
                ? 'Tanyakan tentang gambar ini (misal: What do you see in this image?)...'
                : 'Tulis instruksi dokumen atau tempel URL gambar untuk dianalisis...'
            }
            className="w-full px-3.5 pt-3 pb-1 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent resize-none outline-none max-h-40"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
            <div className="flex items-center gap-1 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.docx"
                onChange={handleFileChange}
                className="hidden"
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleImageFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isParsingFile || isLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                title="Unggah file teks/Word (.txt, .md, .docx)"
              >
                {isParsingFile ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Paperclip className="w-3.5 h-3.5" />
                )}
                <span>File</span>
              </button>

              {onGenerateImage && (
                <button
                  type="button"
                  onClick={() => {
                    setShowImageGenInput((v) => !v);
                    setShowImageUrlInput(false);
                  }}
                  disabled={isLoading}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                    showImageGenInput
                      ? 'bg-amber-100 text-amber-900'
                      : 'text-amber-700 hover:text-amber-900 hover:bg-amber-50'
                  }`}
                  title="Hasilkan gambar AI dengan Puter (gpt-image-2.6-flare)"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Buat Gambar</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:text-violet-900 hover:bg-violet-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                title="Unggah gambar untuk dianalisis AI (PNG, JPG, WebP, GIF)"
              >
                <ScanEye className="w-3.5 h-3.5" />
                <span>Analisis Gambar</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowImageUrlInput((v) => !v);
                  setShowImageGenInput(false);
                }}
                disabled={isLoading}
                className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  showImageUrlInput
                    ? 'bg-indigo-100 text-indigo-800'
                    : 'text-slate-600 hover:text-indigo-900 hover:bg-indigo-50'
                }`}
                title="Analisis gambar dari tautan URL (misal https://assets.puter.site/doge.jpeg)"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>URL</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (hasDocumentContent) {
                    onSendMessage(
                      'Susun ulang dan sempurnakan struktur, alur paragraf, serta bahasa teks pada dokumen ini agar lebih rapi, jelas, dan profesional.'
                    );
                  } else {
                    setInput('Buatkan dan susun teks terstruktur tentang: ');
                    textareaRef.current?.focus();
                  }
                }}
                disabled={isLoading}
                title="Buat atau susun ulang struktur dan bahasa teks dokumen"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 hover:bg-sky-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
              >
                <PenLine className="w-3.5 h-3.5" />
                <span>Susun Teks</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onSendMessage(
                    'Analisis bentuk, struktur Markdown, ejaan (EYD), serta tulisan yang benar dan akurasi isi pada dokumen ini, lalu perbaiki bagian yang keliru.'
                  )
                }
                disabled={!hasDocumentContent || isLoading}
                title="Analisis struktur dokumen dan periksa tulisan yang benar"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Periksa</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={(!input.trim() && !attachedImage) || isLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 rounded-lg transition-all whitespace-nowrap shrink-0 shadow-xs"
            >
              <span>Kirim</span>
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
