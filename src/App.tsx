import { useState } from 'react';
import { DOCUMENT_PRESETS } from './data/presets';
import {
  AiEngine,
  AttachedImage,
  ChatApiResponse,
  ChatMessage,
  GeneratedImageMeta,
  ReferenceFile,
} from './types/document';
import { ChatPanel } from './components/ChatPanel';
import { DocumentPanel } from './components/DocumentPanel';
import {
  extractErrorMessage,
  generateImageWithPuter,
  isPuterSignedIn,
  isTransientAiError,
  resolveImageForVision,
  runPuterDocumentChat,
  signInPuter,
} from './utils/puterAi';

function extractExplicitImageUrlFromPrompt(text: string): string | null {
  const match = text.match(
    /https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>]*)?/i
  );
  return match ? match[0] : null;
}

function extractDocumentImageForPrompt(
  promptText: string,
  markdown: string
): AttachedImage | null {
  const asksAboutDocImage =
    /\b(analisis|analisa|lihat|jelaskan|deskripsikan|baca|periksa|apa\s+isi|what\s+do\s+you\s+see|describe|analyze)\b/i.test(
      promptText
    ) && /\b(gambar|foto|ilustrasi|diagram|image|picture|bagan)\b/i.test(promptText);
  if (!asksAboutDocImage) return null;

  const imgMatch = markdown.match(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  if (!imgMatch) return null;
  return {
    name: imgMatch[1].trim() || 'Gambar Dokumen',
    url: imgMatch[2].trim(),
  };
}

function formatTimeNow(): string {
  return new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function App() {
  const initialPreset = DOCUMENT_PRESETS[0];

  const [activePresetId, setActivePresetId] = useState<string>(initialPreset.id);
  const [documentTitle, setDocumentTitle] = useState<string>(initialPreset.title);
  const [documentContent, setDocumentContent] = useState<string>(
    initialPreset.content
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [referenceFile, setReferenceFile] = useState<ReferenceFile | null>(null);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [aiEngine, setAiEngine] = useState<AiEngine>('server');
  const [puterSignedIn, setPuterSignedIn] = useState<boolean>(() =>
    isPuterSignedIn()
  );
  const [mobileTab, setMobileTab] = useState<'chat' | 'document'>('chat');
  const [logoError, setLogoError] = useState<boolean>(false);
  const [bannerError, setBannerError] = useState<boolean>(false);

  const handleSelectPreset = (presetId: string) => {
    const preset = DOCUMENT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePresetId(preset.id);
    setDocumentTitle(preset.title);
    setDocumentContent(preset.content);
    setError(null);
  };

  const handleNewDocument = () => {
    setActivePresetId('blank');
    setDocumentTitle('Dokumen Baru');
    setDocumentContent('');
    setMessages([]);
    setReferenceFile(null);
    setAttachedImage(null);
    setError(null);
  };

  const handleSignInPuter = async () => {
    setError(null);
    try {
      const ok = await signInPuter();
      setPuterSignedIn(ok);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    }
  };

  const callServerChat = async (
    nextMessages: ChatMessage[],
    imageForTurn: AttachedImage | null
  ): Promise<ChatApiResponse> => {
    let preparedImage = imageForTurn;
    if (
      preparedImage?.url &&
      (preparedImage.url.startsWith('data:image/svg+xml') ||
        preparedImage.url.toLowerCase().split('?')[0].endsWith('.svg'))
    ) {
      const pngDataUrl = await resolveImageForVision(preparedImage.url);
      preparedImage = {
        ...preparedImage,
        url: pngDataUrl,
        mimeType: 'image/png',
      };
    }

    const payload = JSON.stringify({
      messages: nextMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      documentContent,
      documentTitle,
      referenceFile: referenceFile
        ? { name: referenceFile.name, content: referenceFile.content }
        : null,
      attachedImage: preparedImage
        ? {
            name: preparedImage.name,
            url: preparedImage.url,
            mimeType: preparedImage.mimeType,
          }
        : null,
    });

    const maxClientAttempts = 2;
    for (let attempt = 1; attempt <= maxClientAttempts; attempt++) {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      const rawBody = await response.text();
      let parsed: ChatApiResponse | null = null;
      try {
        parsed = JSON.parse(rawBody) as ChatApiResponse;
      } catch {
        parsed = null;
      }

      if (!response.ok || parsed?.error) {
        const msg =
          parsed?.error ||
          (response.status === 503
            ? 'Server AI sedang mengalami kepadatan permintaan (503). Silakan coba lagi.'
            : `Server AI mengembalikan status ${response.status}. Silakan coba lagi.`);

        const isRetryable =
          response.status === 503 ||
          response.status === 502 ||
          response.status === 504 ||
          response.status === 429;

        if (isRetryable && attempt < maxClientAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        throw new Error(msg);
      }

      if (!parsed) {
        throw new Error('Respons dari Server AI tidak valid.');
      }

      return parsed;
    }

    throw new Error('Server AI sedang sibuk sementara (503). Silakan coba lagi.');
  };

  const handleInsertAnalysisToDocument = (analysisText: string, image?: AttachedImage) => {
    const sections: string[] = [];
    if (image?.url) {
      sections.push(`![${image.name || 'Gambar Dianalisis'}](${image.url})`);
    }
    sections.push(`## Hasil Analisis Gambar\n\n${analysisText.trim()}`);
    const block = sections.join('\n\n');
    const trimmed = documentContent.trimEnd();
    setDocumentContent(trimmed ? `${trimmed}\n\n${block}` : block);
    setActivePresetId('');
    setMobileTab('document');
  };

  const executeChatTurn = async (
    nextMessages: ChatMessage[],
    effectiveImage: AttachedImage | null
  ) => {
    setError(null);
    setRetryAction(null);
    setIsLoading(true);

    const previousDocumentContent = documentContent;

    try {
      let data: ChatApiResponse;

      if (aiEngine === 'puter') {
        try {
          data = await runPuterDocumentChat({
            messages: nextMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            documentContent: previousDocumentContent,
            documentTitle,
            referenceFile,
            attachedImage: effectiveImage,
            onStreamUpdate: ({ documentTitle: liveTitle, documentContent: liveDoc }) => {
              if (typeof liveDoc === 'string') {
                setDocumentContent(liveDoc);
                setActivePresetId('');
              }
              if (typeof liveTitle === 'string' && liveTitle.trim()) {
                setDocumentTitle(liveTitle.trim());
              }
            },
          });
          setPuterSignedIn(isPuterSignedIn());
        } catch (puterErr: unknown) {
          // Restore previous document if stream failed midway, then fall back to Server AI
          setDocumentContent(previousDocumentContent);
          const serverData = await callServerChat(nextMessages, effectiveImage);
          const puterReason = extractErrorMessage(puterErr);
          data = {
            ...serverData,
            reply: `${serverData.reply}\n\n_(Catatan: Puter.js dialihkan sementara [${puterReason}], sehingga otomatis diproses via Server AI.)_`,
          };
        }
      } else {
        try {
          data = await callServerChat(nextMessages, effectiveImage);
        } catch (serverErr: unknown) {
          if (isTransientAiError(serverErr) && isPuterSignedIn()) {
            const puterData = await runPuterDocumentChat({
              messages: nextMessages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              documentContent: previousDocumentContent,
              documentTitle,
              referenceFile,
              attachedImage: effectiveImage,
              onStreamUpdate: ({ documentTitle: liveTitle, documentContent: liveDoc }) => {
                if (typeof liveDoc === 'string') {
                  setDocumentContent(liveDoc);
                  setActivePresetId('');
                }
                if (typeof liveTitle === 'string' && liveTitle.trim()) {
                  setDocumentTitle(liveTitle.trim());
                }
              },
            });
            data = {
              ...puterData,
              reply: `${puterData.reply}\n\n_(Catatan: Server AI sedang padat [503], sehingga otomatis diproses via Puter.js.)_`,
            };
          } else {
            throw serverErr;
          }
        }
      }

      if (data.pendingImage && !data.generatedImage) {
        try {
          const generated = await generateImageWithPuter(
            data.pendingImage.prompt,
            data.pendingImage.title
          );
          setPuterSignedIn(isPuterSignedIn());
          data.generatedImage = generated;
          const markdownImg = `![${generated.title}](${generated.url})`;
          if (data.documentContent.includes('{{GENERATED_IMAGE}}')) {
            data.documentContent = data.documentContent.replace(
              /\{\{GENERATED_IMAGE\}\}/g,
              markdownImg
            );
          } else if (data.documentContent.trim()) {
            data.documentContent = `${data.documentContent.trim()}\n\n${markdownImg}`;
          } else {
            data.documentContent = `# ${generated.title}\n\n${markdownImg}`;
          }
        } catch (imgErr: unknown) {
          data.documentContent = data.documentContent
            .replace(/\{\{GENERATED_IMAGE\}\}/g, '')
            .trim();
          data.reply = `${data.reply}\n\n_(Catatan: Pembuatan gambar via Puter gpt-image-2.6-flare belum berjalan [${extractErrorMessage(imgErr)}]. Silakan klik "Masuk Puter" atau coba lagi.)_`;
        }
      }

      const incomingDoc =
        typeof data.documentContent === 'string'
          ? data.documentContent
          : previousDocumentContent;
      const didUpdateDoc = incomingDoc.trim() !== previousDocumentContent.trim();

      if (didUpdateDoc) {
        setDocumentContent(incomingDoc);
        if (
          typeof data.documentTitle === 'string' &&
          data.documentTitle.trim() &&
          data.documentTitle.trim() !== documentTitle.trim()
        ) {
          setDocumentTitle(data.documentTitle.trim());
        }
        setActivePresetId('');
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply || 'Permintaan telah diproses.',
        timestamp: formatTimeNow(),
        documentUpdated: didUpdateDoc,
        generatedImage: data.generatedImage,
        imageAnalyzed: data.imageAnalyzed || Boolean(effectiveImage),
        attachedImage: effectiveImage ?? undefined,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
      setRetryAction(() => () => {
        void executeChatTurn(nextMessages, effectiveImage);
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    setError(null);
    setRetryAction(null);

    let effectiveImage = attachedImage;
    if (!effectiveImage) {
      const urlInPrompt = extractExplicitImageUrlFromPrompt(text);
      if (urlInPrompt) {
        effectiveImage = {
          name: urlInPrompt.split('/').pop()?.split('?')[0] || 'Gambar URL',
          url: urlInPrompt,
        };
      } else {
        effectiveImage = extractDocumentImageForPrompt(text, documentContent);
      }
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: formatTimeNow(),
      referenceFileName: referenceFile?.name,
      attachedImage: effectiveImage ?? undefined,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setAttachedImage(null);
    await executeChatTurn(nextMessages, effectiveImage);
  };

  const runGenerateImageTurn = async (cleanPrompt: string, shortTitle: string) => {
    setError(null);
    setRetryAction(null);
    setIsLoading(true);

    try {
      let generated: GeneratedImageMeta;

      const callServerGenerateImage = async (): Promise<GeneratedImageMeta> => {
        const res = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: cleanPrompt, title: shortTitle }),
        });
        const body = (await res.json()) as GeneratedImageMeta & { error?: string };
        if (!res.ok || body?.error || !body?.url) {
          throw new Error(body?.error || `Server AI mengembalikan status ${res.status}.`);
        }
        return body;
      };

      if (aiEngine === 'server') {
        try {
          generated = await callServerGenerateImage();
        } catch (serverImgErr: unknown) {
          try {
            generated = await generateImageWithPuter(cleanPrompt, shortTitle);
            setPuterSignedIn(isPuterSignedIn());
          } catch {
            throw serverImgErr;
          }
        }
      } else {
        try {
          generated = await generateImageWithPuter(cleanPrompt, shortTitle);
          setPuterSignedIn(isPuterSignedIn());
        } catch (puterErr: unknown) {
          try {
            generated = await callServerGenerateImage();
          } catch {
            throw new Error(extractErrorMessage(puterErr));
          }
        }
      }

      const markdownImg = `![${generated.title}](${generated.url})`;
      const trimmedDoc = documentContent.trimEnd();
      if (trimmedDoc) {
        setDocumentContent(`${trimmedDoc}\n\n${markdownImg}`);
      } else {
        setDocumentTitle(generated.title);
        setDocumentContent(`# ${generated.title}\n\n${markdownImg}`);
      }
      setActivePresetId('');

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: `Gambar berhasil dibuat menggunakan ${generated.engine || 'AI'} dan disisipkan ke dokumen A4.`,
        timestamp: formatTimeNow(),
        documentUpdated: true,
        generatedImage: generated,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
      setRetryAction(() => () => {
        void runGenerateImageTurn(cleanPrompt, shortTitle);
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateImage = async (promptText: string) => {
    const cleanPrompt = promptText.trim();
    if (!cleanPrompt || isLoading) return;
    setError(null);
    setRetryAction(null);

    const shortTitle =
      cleanPrompt.length > 48 ? `${cleanPrompt.slice(0, 45).trim()}...` : cleanPrompt;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Buatkan gambar: ${cleanPrompt}`,
      timestamp: formatTimeNow(),
    };

    setMessages((prev) => [...prev, userMsg]);
    await runGenerateImageTurn(cleanPrompt, shortTitle);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-indigo-50 text-slate-900">
      {/* Top Navigation Bar */}
      <header className="h-16 px-4 sm:px-6 bg-gradient-to-r from-indigo-900 via-blue-800 to-indigo-800 text-white border-b border-indigo-700/60 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6 shrink-0 shadow-xs">
        {/* Left: RNS Brand Logo */}
        <div className="justify-self-start min-w-0">
          <a
            href="/"
            aria-label="RNS Robi Naskah Studio"
            className="inline-flex items-center shrink-0 whitespace-nowrap"
          >
            {logoError ? (
              <span className="text-sm sm:text-base font-bold tracking-tight text-white">
                RNS
              </span>
            ) : (
              <span className="inline-flex items-center bg-white px-2 py-1 rounded-lg shadow-xs ring-1 ring-white/20">
                <img
                  src="/assets/aistudio/WhatsApp_Image_2026-11-13_at_10.03.43_e2363421.jpeg"
                  alt="RNS Logo"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="h-8 sm:h-9 w-auto object-contain block"
                />
              </span>
            )}
          </a>
        </div>

        {/* Center Top: App Name Banner Image */}
        <div className="justify-self-center flex items-center justify-center min-w-0">
          {bannerError ? (
            <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
              Robi Naskah Studio
            </span>
          ) : (
            <span className="inline-flex items-center bg-white px-2 py-1 rounded-lg shadow-xs ring-1 ring-white/25">
              <img
                src="/assets/aistudio/WhatsApp_Image_2026-11-13_at_10.03.43_1bcec877.jpeg"
                alt="Robi Naskah Studio"
                referrerPolicy="no-referrer"
                onError={() => setBannerError(true)}
                className="h-7 sm:h-9 w-auto max-w-[200px] sm:max-w-[320px] object-contain block"
              />
            </span>
          )}
        </div>

        {/* Right: Single primary action */}
        <div className="justify-self-end flex items-center shrink-0">
          <button
            type="button"
            onClick={handleNewDocument}
            className="px-3 sm:px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-300 hover:bg-amber-200 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
          >
            Dokumen Baru
          </button>
        </div>
      </header>

      {/* Template Quick-Select Bar */}
      <nav
        aria-label="Templat Dokumen"
        className="hidden md:flex items-center justify-center gap-6 px-6 py-2 bg-white/95 border-b border-indigo-100 text-xs font-medium text-slate-600 shrink-0"
      >
        <span className="text-slate-400 whitespace-nowrap shrink-0">
          Templat Cepat:
        </span>
        {DOCUMENT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handleSelectPreset(preset.id)}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-indigo-700 ${
              activePresetId === preset.id
                ? 'text-indigo-700 underline underline-offset-4 decoration-indigo-600 decoration-2 font-semibold'
                : ''
            }`}
          >
            {preset.label}
          </button>
        ))}
      </nav>

      {/* Mobile Tab Bar (< lg) */}
      <div className="lg:hidden flex items-center gap-1 px-4 py-2 bg-white border-b border-indigo-100 shrink-0">
        <button
          type="button"
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
            mobileTab === 'chat'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-indigo-50'
          }`}
        >
          Chat AI
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('document')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
            mobileTab === 'document'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-indigo-50'
          }`}
        >
          Dokumen A4
        </button>
      </div>

      {/* Main Split-Screen Workspace: 40% Left Chat / 60% Right A4 Document */}
      <main className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        <div
          className={`${
            mobileTab === 'chat' ? 'flex' : 'hidden'
          } lg:flex flex-col w-full lg:w-[40%] h-full min-h-0`}
        >
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            error={error}
            onRetry={retryAction ?? undefined}
            aiEngine={aiEngine}
            onAiEngineChange={setAiEngine}
            puterSignedIn={puterSignedIn}
            onSignInPuter={handleSignInPuter}
            hasDocumentContent={Boolean(documentContent.trim())}
            referenceFile={referenceFile}
            onAttachFile={setReferenceFile}
            attachedImage={attachedImage}
            onAttachImage={setAttachedImage}
            onInsertAnalysisToDocument={handleInsertAnalysisToDocument}
            onGenerateImage={handleGenerateImage}
            onSendMessage={handleSendMessage}
            onClearChat={() => {
              setMessages([]);
              setAttachedImage(null);
              setError(null);
              setRetryAction(null);
            }}
            onOpenDocument={() => setMobileTab('document')}
          />
        </div>

        <div
          className={`${
            mobileTab === 'document' ? 'flex' : 'hidden'
          } lg:flex flex-col w-full lg:w-[60%] h-full min-h-0`}
        >
          <DocumentPanel
            title={documentTitle}
            content={documentContent}
            onTitleChange={(val) => {
              setDocumentTitle(val);
              setActivePresetId('');
            }}
            onContentChange={(val) => {
              setDocumentContent(val);
              setActivePresetId('');
            }}
          />
        </div>
      </main>
    </div>
  );
}
