export type AiEngine = 'server' | 'puter';

export interface GeneratedImageMeta {
  url: string;
  title: string;
  engine?: string;
}

export interface AttachedImage {
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  documentUpdated?: boolean;
  referenceFileName?: string;
  attachedImage?: AttachedImage;
  generatedImage?: GeneratedImageMeta;
  imageAnalyzed?: boolean;
}

export interface ReferenceFile {
  name: string;
  size: number;
  content: string;
}

export interface ChatApiResponse {
  reply: string;
  documentTitle?: string;
  documentContent: string;
  generatedImage?: GeneratedImageMeta;
  pendingImage?: {
    prompt: string;
    title: string;
  };
  imageAnalyzed?: boolean;
  error?: string;
}

export interface DocumentPreset {
  id: string;
  label: string;
  title: string;
  content: string;
}
