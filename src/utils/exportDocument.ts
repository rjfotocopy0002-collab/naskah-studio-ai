import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import mammoth from 'mammoth';

import { ReferenceFile } from '../types/document';

const ARABIC_CHAR_REGEX =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_SEGMENT_REGEX =
  /([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF][\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s0-9\u0660-\u0669.,،؛؟!:"'()\-–—]*[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF0-9\u0660-\u0669.,،؛؟!:"'()\-–—]*)/g;
const LATIN_CHAR_REGEX = /[A-Za-z\u00C0-\u024F]/;

function hasArabic(text: string): boolean {
  return ARABIC_CHAR_REGEX.test(text);
}

/**
 * Determines paragraph base direction following Unicode UAX #9 first-strong-character rule
 * (matches HTML `dir="auto"` and CSS `unicode-bidi: plaintext`).
 */
function isRtlParagraph(text: string): boolean {
  const cleaned = text.replace(/^#{1,3}\s+|^[-*+]\s+|^\d+\.\s+|^>\s+/, '');
  for (const ch of cleaned) {
    if (ARABIC_CHAR_REGEX.test(ch)) return true;
    if (LATIN_CHAR_REGEX.test(ch)) return false;
  }
  return false;
}

function sanitizeFileName(title: string, ext: string): string {
  const cleaned = title
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  const base = cleaned || 'dokumen-naskah';
  return `${base}.${ext}`;
}

interface RasterizedImage {
  pngBytes: Uint8Array;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

function parseSvgDimensions(svgText: string): { width: number; height: number } {
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (viewBoxMatch) {
    const w = parseFloat(viewBoxMatch[1]);
    const h = parseFloat(viewBoxMatch[2]);
    if (w > 0 && h > 0) {
      const targetW = 1600;
      const targetH = Math.max(200, Math.round((targetW * h) / w));
      return { width: targetW, height: targetH };
    }
  }
  return { width: 1600, height: 1000 };
}

async function rasterizeImageToPng(src: string): Promise<RasterizedImage | null> {
  try {
    let objectUrl: string | null = null;
    let imageSourceUrl = src;
    let isSvg =
      src.startsWith('data:image/svg+xml') ||
      src.toLowerCase().split('?')[0].endsWith('.svg');
    let targetW = 1600;
    let targetH = 1000;

    try {
      const response = await fetch(src);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.type.includes('svg')) isSvg = true;

        if (isSvg) {
          const svgText = await blob.text();
          const dims = parseSvgDimensions(svgText);
          targetW = dims.width;
          targetH = dims.height;
          const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
          objectUrl = URL.createObjectURL(svgBlob);
        } else {
          objectUrl = URL.createObjectURL(blob);
        }
        imageSourceUrl = objectUrl;
      }
    } catch {
      // Fallback to loading image URL directly via <img>
    }

    try {
      const loadedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Gagal memuat gambar untuk ekspor.'));
        img.src = imageSourceUrl;
      });

      if (!isSvg && loadedImg.naturalWidth > 0 && loadedImg.naturalHeight > 0) {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / loadedImg.naturalWidth);
        targetW = Math.max(1, Math.round(loadedImg.naturalWidth * scale));
        targetH = Math.max(1, Math.round(loadedImg.naturalHeight * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(loadedImg, 0, 0, targetW, targetH);

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!pngBlob) return null;

      const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
      return { pngBytes, canvas, width: targetW, height: targetH };
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

export async function parseReferenceFile(file: File): Promise<ReferenceFile> {
  const name = file.name;
  const lower = name.toLowerCase();

  if (lower.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const content = result.value.trim();
    if (!content) {
      throw new Error('File .docx tidak memiliki teks yang dapat dibaca.');
    }
    return { name, size: file.size, content };
  }

  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    const content = (await file.text()).trim();
    if (!content) {
      throw new Error('File teks yang diunggah kosong.');
    }
    return { name, size: file.size, content };
  }

  throw new Error('Format file tidak didukung. Gunakan .txt, .md, atau .docx.');
}

const DOCX_DEFAULT_FONT = {
  ascii: 'Calibri',
  hAnsi: 'Calibri',
  cs: 'Arial',
  eastAsia: 'Calibri',
};

function createStyledTextRuns(
  text: string,
  options: {
    bold?: boolean;
    italics?: boolean;
    size?: number;
    color?: string;
    isCode?: boolean;
  } = {}
): TextRun[] {
  const {
    bold = false,
    italics = false,
    size = 22,
    color,
    isCode = false,
  } = options;

  if (!text) return [];

  if (isCode) {
    return [
      new TextRun({
        text,
        font: hasArabic(text) ? DOCX_DEFAULT_FONT : 'Courier New',
        size: size - 2,
        bold,
        boldComplexScript: bold,
        italics,
        italicsComplexScript: italics,
        sizeComplexScript: size - 2,
        color,
        rightToLeft: hasArabic(text),
        language: hasArabic(text) ? { bidirectional: 'ar-SA' } : undefined,
      }),
    ];
  }

  const runs: TextRun[] = [];
  const regex = new RegExp(ARABIC_SEGMENT_REGEX.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const latinSegment = text.slice(lastIndex, match.index);
      runs.push(
        new TextRun({
          text: latinSegment,
          font: DOCX_DEFAULT_FONT,
          size,
          sizeComplexScript: size,
          bold,
          italics,
          color,
        })
      );
    }

    const arabicSegment = match[0];
    runs.push(
      new TextRun({
        text: arabicSegment,
        font: DOCX_DEFAULT_FONT,
        size,
        sizeComplexScript: size,
        bold,
        boldComplexScript: bold,
        italics,
        italicsComplexScript: italics,
        color,
        rightToLeft: true,
        language: { bidirectional: 'ar-SA' },
      })
    );

    lastIndex = match.index + arabicSegment.length;
  }

  if (lastIndex < text.length) {
    runs.push(
      new TextRun({
        text: text.slice(lastIndex),
        font: DOCX_DEFAULT_FONT,
        size,
        sizeComplexScript: size,
        bold,
        italics,
        color,
      })
    );
  }

  return runs;
}

function parseInlineRuns(text: string, size = 22, color?: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(
        ...createStyledTextRuns(text.slice(lastIndex, match.index), {
          size,
          color,
        })
      );
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      runs.push(
        ...createStyledTextRuns(token.slice(2, -2), {
          bold: true,
          size,
          color,
        })
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      runs.push(
        ...createStyledTextRuns(token.slice(1, -1), {
          italics: true,
          size,
          color,
        })
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      runs.push(
        ...createStyledTextRuns(token.slice(1, -1), {
          isCode: true,
          size,
          color,
        })
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    runs.push(
      ...createStyledTextRuns(text.slice(lastIndex), {
        size,
        color,
      })
    );
  }

  return runs.length > 0
    ? runs
    : [new TextRun({ text: '', font: DOCX_DEFAULT_FONT, size })];
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

type ColumnAlign = 'left' | 'center' | 'right' | 'auto';

interface ParsedMarkdownTable {
  headers: string[];
  alignments: ColumnAlign[];
  rows: string[][];
  nextIndex: number;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false;
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|');
  return (
    cells.length >= 1 &&
    cells.every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell))
  );
}

function parseTableCells(rowLine: string): string[] {
  return rowLine
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function parseSeparatorAlignments(sepLine: string, colCount: number): ColumnAlign[] {
  const raw = parseTableCells(sepLine);
  const alignments: ColumnAlign[] = [];
  for (let c = 0; c < colCount; c++) {
    const token = (raw[c] ?? '').trim();
    const startsColon = token.startsWith(':');
    const endsColon = token.endsWith(':');
    if (startsColon && endsColon) {
      alignments.push('center');
    } else if (endsColon) {
      alignments.push('right');
    } else if (startsColon) {
      alignments.push('left');
    } else {
      alignments.push('auto');
    }
  }
  return alignments;
}

function parseMarkdownTable(
  lines: string[],
  startIndex: number
): ParsedMarkdownTable | null {
  if (startIndex + 1 >= lines.length) return null;
  const headerLine = lines[startIndex];
  const sepLine = lines[startIndex + 1];

  if (!headerLine.trim().includes('|') || !isTableSeparatorLine(sepLine)) {
    return null;
  }

  const headers = parseTableCells(headerLine);
  const colCount = headers.length;
  if (colCount === 0) return null;

  const alignments = parseSeparatorAlignments(sepLine, colCount);
  const rows: string[][] = [];

  let i = startIndex + 2;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || !line.includes('|') || isTableSeparatorLine(line)) {
      break;
    }
    const rawCells = parseTableCells(lines[i]);
    const normalized: string[] = [];
    for (let c = 0; c < colCount; c++) {
      normalized.push(rawCells[c] ?? '');
    }
    rows.push(normalized);
    i++;
  }

  return {
    headers,
    alignments,
    rows,
    nextIndex: i,
  };
}

function computeProportionalColumnWidths(
  headers: string[],
  rows: string[][],
  totalWidth: number,
  minColWidth: number
): number[] {
  const colCount = headers.length;
  if (colCount === 0) return [];
  if (colCount === 1) return [totalWidth];

  const weights = headers.map((h, colIdx) => {
    let maxLen = stripInlineMarkdown(h).length;
    for (const row of rows) {
      const len = stripInlineMarkdown(row[colIdx] ?? '').length;
      if (len > maxLen) maxLen = len;
    }
    return Math.min(44, Math.max(8, maxLen));
  });

  const effectiveMin = Math.min(minColWidth, Math.floor(totalWidth / colCount));
  const remainingWidth = Math.max(0, totalWidth - effectiveMin * colCount);
  const totalWeight = weights.reduce((acc, w) => acc + w, 0) || colCount;

  const widths = weights.map(
    (w) => effectiveMin + Math.floor((w / totalWeight) * remainingWidth)
  );

  // Distribute rounding remainder to the widest column so total matches exactly
  const currentSum = widths.reduce((a, b) => a + b, 0);
  const diff = totalWidth - currentSum;
  if (diff !== 0) {
    let maxIdx = 0;
    for (let c = 1; c < widths.length; c++) {
      if (widths[c] > widths[maxIdx]) maxIdx = c;
    }
    widths[maxIdx] += diff;
  }

  return widths;
}

function getDocxAlignment(
  colAlign: ColumnAlign,
  text: string
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (colAlign === 'center') return AlignmentType.CENTER;
  if (colAlign === 'right') return AlignmentType.RIGHT;
  if (colAlign === 'left') return AlignmentType.LEFT;
  return isRtlParagraph(text) ? AlignmentType.START : AlignmentType.LEFT;
}

export async function exportToDocx(
  title: string,
  markdown: string
): Promise<void> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const children: Array<Paragraph | Table> = [];

  // A4 width (11906 twips) - left/right margins (2 * 1440 twips) = 9026 twips
  const A4_CONTENT_TWIPS = 9026;
  const TABLE_BORDER_STYLE = {
    style: BorderStyle.SINGLE,
    size: 6,
    color: 'CBD5E1',
  };

  let i = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      } else {
        inCodeBlock = false;
        const codeText = codeLines.join('\n');
        children.push(
          new Paragraph({
            bidirectional: isRtlParagraph(codeText),
            alignment: AlignmentType.START,
            shading: {
              type: ShadingType.CLEAR,
              fill: 'FAFAFA',
              color: 'auto',
            },
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: 'E4E4E7' },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E4E4E7' },
              left: { style: BorderStyle.SINGLE, size: 4, color: 'E4E4E7' },
              right: { style: BorderStyle.SINGLE, size: 4, color: 'E4E4E7' },
            },
            spacing: { before: 120, after: 120 },
            children: createStyledTextRuns(codeText, {
              isCode: true,
              size: 21,
            }),
          })
        );
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      i++;
      continue;
    }

    const parsedTable = parseMarkdownTable(lines, i);
    if (parsedTable) {
      const colWidths = computeProportionalColumnWidths(
        parsedTable.headers,
        parsedTable.rows,
        A4_CONTENT_TWIPS,
        1100
      );

      const allTableText = [
        ...parsedTable.headers,
        ...parsedTable.rows.flat(),
      ].join(' ');
      const tableIsRtl = isRtlParagraph(allTableText);

      const tableRows: TableRow[] = [];

      // Header Row
      tableRows.push(
        new TableRow({
          tableHeader: true,
          cantSplit: true,
          children: parsedTable.headers.map(
            (cellText, colIdx) =>
              new TableCell({
                width: { size: colWidths[colIdx], type: WidthType.DXA },
                verticalAlign: VerticalAlignTable.CENTER,
                shading: {
                  type: ShadingType.CLEAR,
                  fill: 'F4F4F5',
                  color: 'auto',
                },
                margins: {
                  top: 110,
                  bottom: 110,
                  left: 140,
                  right: 140,
                },
                children: [
                  new Paragraph({
                    bidirectional: isRtlParagraph(cellText),
                    alignment: getDocxAlignment(
                      parsedTable.alignments[colIdx],
                      cellText
                    ),
                    spacing: { before: 0, after: 0 },
                    children: createStyledTextRuns(
                      stripInlineMarkdown(cellText),
                      { bold: true, size: 20, color: '18181B' }
                    ),
                  }),
                ],
              })
          ),
        })
      );

      // Data Rows
      for (const row of parsedTable.rows) {
        tableRows.push(
          new TableRow({
            cantSplit: true,
            children: row.map(
              (cellText, colIdx) =>
                new TableCell({
                  width: { size: colWidths[colIdx], type: WidthType.DXA },
                  verticalAlign: VerticalAlignTable.TOP,
                  margins: {
                    top: 100,
                    bottom: 100,
                    left: 140,
                    right: 140,
                  },
                  children: [
                    new Paragraph({
                      bidirectional: isRtlParagraph(cellText),
                      alignment: getDocxAlignment(
                        parsedTable.alignments[colIdx],
                        cellText
                      ),
                      spacing: { before: 0, after: 0 },
                      children: parseInlineRuns(cellText, 20, '27272A'),
                    }),
                  ],
                })
            ),
          })
        );
      }

      children.push(
        new Table({
          width: { size: A4_CONTENT_TWIPS, type: WidthType.DXA },
          columnWidths: colWidths,
          layout: TableLayoutType.FIXED,
          visuallyRightToLeft: tableIsRtl,
          borders: {
            top: TABLE_BORDER_STYLE,
            bottom: TABLE_BORDER_STYLE,
            left: TABLE_BORDER_STYLE,
            right: TABLE_BORDER_STYLE,
            insideHorizontal: TABLE_BORDER_STYLE,
            insideVertical: TABLE_BORDER_STYLE,
          },
          margins: {
            top: 100,
            bottom: 100,
            left: 140,
            right: 140,
          },
          rows: tableRows,
        })
      );
      children.push(new Paragraph({ text: '', spacing: { after: 140 } }));
      i = parsedTable.nextIndex;
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    const imageMatch = trimmed.match(
      /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/
    );
    if (imageMatch) {
      const altText = imageMatch[1].trim();
      const imageUrl = imageMatch[2].trim();
      const rasterized = await rasterizeImageToPng(imageUrl);

      if (rasterized) {
        const maxDocxWidth = 540;
        const targetW = Math.min(maxDocxWidth, rasterized.width);
        const targetH = Math.max(
          1,
          Math.round((targetW * rasterized.height) / rasterized.width)
        );

        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 140, after: altText ? 60 : 160 },
            children: [
              new ImageRun({
                type: 'png',
                data: rasterized.pngBytes,
                transformation: {
                  width: targetW,
                  height: targetH,
                },
                altText: {
                  name: altText || 'ilustrasi-dokumen',
                  title: altText || 'Ilustrasi Dokumen',
                  description: altText || 'Ilustrasi Dokumen',
                },
              }),
            ],
          })
        );

        if (altText) {
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              bidirectional: isRtlParagraph(altText),
              spacing: { before: 0, after: 160 },
              children: createStyledTextRuns(altText, {
                italics: true,
                size: 18,
                color: '52525B',
              }),
            })
          );
        }
      } else {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: 120 },
            children: createStyledTextRuns(`[Gambar: ${altText || imageUrl}]`, {
              italics: true,
              size: 20,
              color: '71717A',
            }),
          })
        );
      }

      i++;
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      children.push(
        new Paragraph({
          border: {
            bottom: {
              color: 'D4D4D8',
              space: 4,
              style: BorderStyle.SINGLE,
              size: 6,
            },
          },
          spacing: { before: 120, after: 120 },
          text: '',
        })
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      const headingText = stripInlineMarkdown(trimmed.slice(4));
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          bidirectional: isRtlParagraph(headingText),
          alignment: AlignmentType.START,
          spacing: { before: 200, after: 80 },
          children: createStyledTextRuns(headingText, { bold: true, size: 24 }),
        })
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      const headingText = stripInlineMarkdown(trimmed.slice(3));
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          bidirectional: isRtlParagraph(headingText),
          alignment: AlignmentType.START,
          border: {
            bottom: {
              color: 'E4E4E7',
              space: 4,
              style: BorderStyle.SINGLE,
              size: 4,
            },
          },
          spacing: { before: 260, after: 100 },
          children: createStyledTextRuns(headingText, { bold: true, size: 28 }),
        })
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      const headingText = stripInlineMarkdown(trimmed.slice(2));
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          bidirectional: isRtlParagraph(headingText),
          alignment: AlignmentType.START,
          spacing: { before: 120, after: 160 },
          children: createStyledTextRuns(headingText, { bold: true, size: 34 }),
        })
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quoteText = stripInlineMarkdown(trimmed.slice(2));
      const rtl = isRtlParagraph(quoteText);
      children.push(
        new Paragraph({
          bidirectional: rtl,
          alignment: AlignmentType.START,
          border: rtl
            ? {
                right: {
                  color: 'D4D4D8',
                  space: 12,
                  style: BorderStyle.SINGLE,
                  size: 8,
                },
              }
            : {
                left: {
                  color: 'D4D4D8',
                  space: 12,
                  style: BorderStyle.SINGLE,
                  size: 8,
                },
              },
          indent: rtl ? { right: 320 } : { left: 320 },
          spacing: { before: 100, after: 100 },
          children: createStyledTextRuns(quoteText, {
            italics: true,
            size: 22,
            color: '52525B',
          }),
        })
      );
      i++;
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const content = trimmed.replace(/^[-*+]\s+/, '');
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          bidirectional: isRtlParagraph(content),
          alignment: AlignmentType.START,
          spacing: { before: 40, after: 60 },
          children: parseInlineRuns(content, 22),
        })
      );
      i++;
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const rtl = isRtlParagraph(orderedMatch[2]);
      children.push(
        new Paragraph({
          bidirectional: rtl,
          alignment: AlignmentType.START,
          indent: rtl
            ? { right: 360, hanging: 240 }
            : { left: 360, hanging: 240 },
          spacing: { before: 40, after: 60 },
          children: [
            ...createStyledTextRuns(`${orderedMatch[1]}. `, {
              bold: true,
              size: 22,
            }),
            ...parseInlineRuns(orderedMatch[2], 22),
          ],
        })
      );
      i++;
      continue;
    }

    children.push(
      new Paragraph({
        bidirectional: isRtlParagraph(trimmed),
        alignment: AlignmentType.START,
        spacing: { before: 40, after: 120 },
        children: parseInlineRuns(trimmed, 22),
      })
    );
    i++;
  }

  if (children.length === 0) {
    children.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({
    title: title || 'Dokumen',
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
            },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, sanitizeFileName(title, 'docx'));
}

/**
 * Renders A4 pages using the browser's native HarfBuzz + ICU BiDi text engine on high-DPI Canvas
 * and embeds them cleanly into an A4 jsPDF document. Preserves Arabic shaping, RTL layout,
 * table columns, grid border lines, heading rules, and blockquote dividers.
 */
export async function exportToPdf(
  title: string,
  markdown: string
): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  // A4 at 180 DPI (210mm x 297mm)
  const PAGE_W = 1488;
  const PAGE_H = 2105;
  const MARGIN_X = 148;
  const MARGIN_TOP = 148;
  const MARGIN_BOTTOM = 152;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;

  const pages: HTMLCanvasElement[] = [];

  const createPageCanvas = (): {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  } => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D tidak tersedia di browser.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    pages.push(canvas);
    return { canvas, ctx };
  };

  let { ctx } = createPageCanvas();
  let cursorY = MARGIN_TOP;

  const ensureSpace = (neededPx: number): boolean => {
    if (cursorY + neededPx > PAGE_H - MARGIN_BOTTOM) {
      const next = createPageCanvas();
      ctx = next.ctx;
      cursorY = MARGIN_TOP;
      return true;
    }
    return false;
  };

  const wrapLines = (text: string, maxW: number): string[] => {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];
    const result: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxW) {
        current = candidate;
      } else {
        if (current) result.push(current);
        if (ctx.measureText(word).width <= maxW) {
          current = word;
        } else {
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxW && chunk) {
              result.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          current = chunk;
        }
      }
    }
    if (current) result.push(current);
    return result;
  };

  const renderTextBlock = (
    text: string,
    options: {
      fontSizePx: number;
      fontWeight?: '400' | '600' | '700';
      fontStyle?: 'normal' | 'italic';
      fontFamily?: string;
      color?: string;
      indentPx?: number;
      lineHeightPx?: number;
      spaceAfterPx?: number;
      forceRtl?: boolean;
      drawBottomRule?: boolean;
      drawQuoteBar?: boolean;
    }
  ) => {
    const {
      fontSizePx,
      fontWeight = '400',
      fontStyle = 'normal',
      fontFamily = '"Source Serif 4", "Noto Naskh Arabic", Georgia, serif',
      color = '#18181b',
      indentPx = 0,
      lineHeightPx = Math.round(fontSizePx * 1.62),
      spaceAfterPx = 18,
      forceRtl,
      drawBottomRule = false,
      drawQuoteBar = false,
    } = options;

    const rtl = forceRtl ?? isRtlParagraph(text);
    const activeFamily = hasArabic(text)
      ? `"Noto Naskh Arabic", ${fontFamily}`
      : fontFamily;

    ctx.font = `${fontStyle} ${fontWeight} ${fontSizePx}px ${activeFamily}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = rtl ? 'right' : 'left';

    const maxW = CONTENT_W - indentPx;
    const wrapped = wrapLines(text, maxW);
    const xPos = rtl ? PAGE_W - MARGIN_X - indentPx : MARGIN_X + indentPx;

    for (const line of wrapped) {
      ensureSpace(lineHeightPx);
      if (drawQuoteBar) {
        const barX = rtl ? PAGE_W - MARGIN_X - 10 : MARGIN_X + 10;
        ctx.strokeStyle = '#d4d4d8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(barX, cursorY);
        ctx.lineTo(barX, cursorY + lineHeightPx);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.fillText(line, xPos, cursorY);
      cursorY += lineHeightPx;
    }

    if (drawBottomRule) {
      cursorY += 6;
      ctx.strokeStyle = '#e4e4e7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, cursorY);
      ctx.lineTo(PAGE_W - MARGIN_X, cursorY);
      ctx.stroke();
      cursorY += 4;
    }

    cursorY += spaceAfterPx;
  };

  const renderPdfTable = (table: ParsedMarkdownTable) => {
    const colCount = table.headers.length;
    const colWidths = computeProportionalColumnWidths(
      table.headers,
      table.rows,
      CONTENT_W,
      115
    );

    const allTableText = [...table.headers, ...table.rows.flat()].join(' ');
    const tableIsRtl = isRtlParagraph(allTableText);

    // Order columns left-to-right visually (reversed if the whole table is RTL Arabic)
    const visualColIndices = tableIsRtl
      ? Array.from({ length: colCount }, (_, idx) => colCount - 1 - idx)
      : Array.from({ length: colCount }, (_, idx) => idx);

    const cellPadX = 16;
    const cellPadY = 12;
    const cellFontSize = 23;
    const cellLineHeight = 34;

    const prepareRowLayout = (cells: string[], isHeader: boolean) => {
      const wrappedPerVisualCol: string[][] = [];
      let maxLines = 1;

      for (const origIdx of visualColIndices) {
        const clean = stripInlineMarkdown(cells[origIdx] ?? '');
        const family = hasArabic(clean)
          ? '"Noto Naskh Arabic", "Plus Jakarta Sans", sans-serif'
          : '"Plus Jakarta Sans", "Noto Naskh Arabic", sans-serif';
        ctx.font = `${isHeader ? '600' : '400'} ${cellFontSize}px ${family}`;
        const colW = colWidths[origIdx];
        const linesWrapped = clean.trim()
          ? wrapLines(clean, Math.max(40, colW - cellPadX * 2))
          : [''];
        if (linesWrapped.length > maxLines) {
          maxLines = linesWrapped.length;
        }
        wrappedPerVisualCol.push(linesWrapped);
      }

      const rowHeight = maxLines * cellLineHeight + cellPadY * 2;
      return { wrappedPerVisualCol, rowHeight };
    };

    const drawRow = (
      cells: string[],
      wrappedPerVisualCol: string[][],
      rowHeight: number,
      isHeader: boolean
    ) => {
      let cellX = MARGIN_X;

      visualColIndices.forEach((origIdx, vIdx) => {
        const colW = colWidths[origIdx];
        const clean = stripInlineMarkdown(cells[origIdx] ?? '');
        const cellLines = wrappedPerVisualCol[vIdx];
        const cellRtl = isRtlParagraph(clean);
        const colAlign = table.alignments[origIdx];

        // Cell background
        ctx.fillStyle = isHeader ? '#f4f4f5' : '#ffffff';
        ctx.fillRect(cellX, cursorY, colW, rowHeight);

        // Cell grid border lines
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.75;
        ctx.strokeRect(cellX, cursorY, colW, rowHeight);

        // Cell text
        const family = hasArabic(clean)
          ? '"Noto Naskh Arabic", "Plus Jakarta Sans", sans-serif'
          : '"Plus Jakarta Sans", "Noto Naskh Arabic", sans-serif';
        ctx.font = `${isHeader ? '600' : '400'} ${cellFontSize}px ${family}`;
        ctx.fillStyle = isHeader ? '#09090b' : '#27272a';
        ctx.textBaseline = 'top';
        ctx.direction = cellRtl ? 'rtl' : 'ltr';

        let align: CanvasTextAlign = cellRtl ? 'right' : 'left';
        let textX = cellRtl ? cellX + colW - cellPadX : cellX + cellPadX;

        if (colAlign === 'center') {
          align = 'center';
          textX = cellX + colW / 2;
        } else if (colAlign === 'right') {
          align = 'right';
          textX = cellX + colW - cellPadX;
        } else if (colAlign === 'left') {
          align = 'left';
          textX = cellX + cellPadX;
        }

        ctx.textAlign = align;

        const blockHeight = cellLines.length * cellLineHeight;
        let textY = isHeader
          ? cursorY + Math.max(cellPadY, (rowHeight - blockHeight) / 2)
          : cursorY + cellPadY;

        for (const lineText of cellLines) {
          ctx.fillText(lineText, textX, textY);
          textY += cellLineHeight;
        }

        cellX += colW;
      });

      cursorY += rowHeight;
    };

    const headerLayout = prepareRowLayout(table.headers, true);
    ensureSpace(headerLayout.rowHeight + 48);
    cursorY += 8;
    drawRow(
      table.headers,
      headerLayout.wrappedPerVisualCol,
      headerLayout.rowHeight,
      true
    );

    for (const row of table.rows) {
      const rowLayout = prepareRowLayout(row, false);
      const brokePage = ensureSpace(rowLayout.rowHeight);
      if (brokePage) {
        drawRow(
          table.headers,
          headerLayout.wrappedPerVisualCol,
          headerLayout.rowHeight,
          true
        );
      }
      drawRow(row, rowLayout.wrappedPerVisualCol, rowLayout.rowHeight, false);
    }

    cursorY += 22;
  };

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let inCode = false;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      inCode = !inCode;
      if (!inCode) cursorY += 12;
      i++;
      continue;
    }

    if (inCode) {
      renderTextBlock(rawLine || ' ', {
        fontSizePx: 24,
        fontFamily: '"JetBrains Mono", "Noto Naskh Arabic", monospace',
        color: '#3f3f46',
        indentPx: 24,
        lineHeightPx: 36,
        spaceAfterPx: 2,
      });
      i++;
      continue;
    }

    const parsedTable = parseMarkdownTable(lines, i);
    if (parsedTable) {
      renderPdfTable(parsedTable);
      i = parsedTable.nextIndex;
      continue;
    }

    if (!trimmed) {
      cursorY += 14;
      i++;
      continue;
    }

    const imageMatch = trimmed.match(
      /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/
    );
    if (imageMatch) {
      const altText = imageMatch[1].trim();
      const imageUrl = imageMatch[2].trim();
      const rasterized = await rasterizeImageToPng(imageUrl);

      if (rasterized) {
        const maxDrawW = Math.round(CONTENT_W * 0.94);
        const maxDrawH = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - 90;
        let drawW = Math.min(maxDrawW, rasterized.width);
        let drawH = Math.round((drawW * rasterized.height) / rasterized.width);

        if (drawH > maxDrawH) {
          drawH = maxDrawH;
          drawW = Math.round((drawH * rasterized.width) / rasterized.height);
        }

        ensureSpace(drawH + (altText ? 58 : 28));
        const drawX = MARGIN_X + Math.round((CONTENT_W - drawW) / 2);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(drawX, cursorY, drawW, drawH);
        ctx.drawImage(rasterized.canvas, drawX, cursorY, drawW, drawH);

        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(drawX, cursorY, drawW, drawH);

        cursorY += drawH + 10;

        if (altText) {
          ctx.font =
            'italic 400 21px "Plus Jakarta Sans", "Noto Naskh Arabic", sans-serif';
          ctx.fillStyle = '#52525b';
          ctx.textBaseline = 'top';
          ctx.direction = isRtlParagraph(altText) ? 'rtl' : 'ltr';
          ctx.textAlign = 'center';
          ctx.fillText(altText, PAGE_W / 2, cursorY);
          cursorY += 34;
        } else {
          cursorY += 14;
        }
      } else {
        renderTextBlock(`[Gambar: ${altText || imageUrl}]`, {
          fontSizePx: 24,
          fontStyle: 'italic',
          color: '#71717a',
          lineHeightPx: 36,
          spaceAfterPx: 16,
        });
      }

      i++;
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      ensureSpace(34);
      cursorY += 10;
      ctx.strokeStyle = '#d4d4d8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, cursorY);
      ctx.lineTo(PAGE_W - MARGIN_X, cursorY);
      ctx.stroke();
      cursorY += 24;
      i++;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      ensureSpace(76);
      renderTextBlock(stripInlineMarkdown(trimmed.slice(2)), {
        fontSizePx: 44,
        fontWeight: '700',
        fontFamily: '"Plus Jakarta Sans", "Noto Naskh Arabic", sans-serif',
        color: '#09090b',
        lineHeightPx: 62,
        spaceAfterPx: 26,
      });
      i++;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      ensureSpace(64);
      cursorY += 12;
      renderTextBlock(stripInlineMarkdown(trimmed.slice(3)), {
        fontSizePx: 34,
        fontWeight: '600',
        fontFamily: '"Plus Jakarta Sans", "Noto Naskh Arabic", sans-serif',
        color: '#18181b',
        lineHeightPx: 48,
        spaceAfterPx: 18,
        drawBottomRule: true,
      });
      i++;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      ensureSpace(52);
      cursorY += 8;
      renderTextBlock(stripInlineMarkdown(trimmed.slice(4)), {
        fontSizePx: 29,
        fontWeight: '600',
        fontFamily: '"Plus Jakarta Sans", "Noto Naskh Arabic", sans-serif',
        color: '#27272a',
        lineHeightPx: 42,
        spaceAfterPx: 14,
      });
      i++;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      renderTextBlock(stripInlineMarkdown(trimmed.slice(2)), {
        fontSizePx: 27,
        fontStyle: 'italic',
        color: '#52525b',
        indentPx: 36,
        lineHeightPx: 44,
        spaceAfterPx: 18,
        drawQuoteBar: true,
      });
      i++;
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const clean = stripInlineMarkdown(trimmed.replace(/^[-*+]\s+/, ''));
      const rtl = isRtlParagraph(clean);
      renderTextBlock(`•  ${clean}`, {
        fontSizePx: 27,
        indentPx: 26,
        lineHeightPx: 44,
        spaceAfterPx: 10,
        forceRtl: rtl,
      });
      i++;
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const clean = stripInlineMarkdown(orderedMatch[2]);
      const rtl = isRtlParagraph(clean);
      renderTextBlock(`${orderedMatch[1]}.  ${clean}`, {
        fontSizePx: 27,
        indentPx: 26,
        lineHeightPx: 44,
        spaceAfterPx: 10,
        forceRtl: rtl,
      });
      i++;
      continue;
    }

    renderTextBlock(stripInlineMarkdown(trimmed), {
      fontSizePx: 27,
      lineHeightPx: 45,
      spaceAfterPx: 18,
    });
    i++;
  }

  // Draw crisp footer page numbers on every canvas page
  const totalPages = pages.length;
  for (let p = 0; p < totalPages; p++) {
    const pageCtx = pages[p].getContext('2d');
    if (!pageCtx) continue;
    pageCtx.direction = 'ltr';
    pageCtx.font =
      '400 21px "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif';
    pageCtx.fillStyle = '#71717a';
    pageCtx.textBaseline = 'bottom';
    pageCtx.textAlign = 'right';
    pageCtx.fillText(
      `Halaman ${p + 1} dari ${totalPages}`,
      PAGE_W - MARGIN_X,
      PAGE_H - 68
    );
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pdfW = doc.internal.pageSize.getWidth();
  const pdfH = doc.internal.pageSize.getHeight();

  pages.forEach((canvas, idx) => {
    if (idx > 0) doc.addPage();
    const imgData = canvas.toDataURL('image/jpeg', 0.94);
    doc.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH, undefined, 'FAST');
  });

  doc.save(sanitizeFileName(title, 'pdf'));
}
