/**
 * Marklet core · AI iteration brief generator (Markdown + Visual ZIP bundle)
 *
 * Converts element-level comment threads + cropped element screenshots into a
 * structured Markdown prompt or self-contained `.zip` bundle ready for AI coding
 * agents (Antigravity, Cursor, Claude, Codex).
 * Pure TypeScript, zero platform/chrome.* dependencies.
 */
import type { CommentThread } from '../adapters/types';
import { createZipBlob, type ZipEntry } from './zip';

export interface ExportPromptOptions {
  pageTitle?: string;
  pageUrl: string;
  /** Include resolved threads as read-only context (default: false, open threads only). */
  includeResolved?: boolean;
  viewport?: { width: number; height: number };
  /** Optional map of threadId -> relative screenshot path inside a bundle (e.g. "./screenshots/pin-1.jpg"). */
  screenshotPaths?: Record<string, string>;
}

function formatThread(t: CommentThread, screenshotPath?: string): string {
  const { anchor } = t;
  const ctx = anchor.overlayContext;
  const ctxPrefix = ctx ? `[${ctx.kind}${ctx.title ? `: ${ctx.title}` : ''}] ` : '';
  const snippetPart = anchor.textSnippet ? ` “${anchor.textSnippet}”` : '';

  const lines: string[] = [];
  lines.push(`### #${t.pinNumber} · ${ctxPrefix}\`<${anchor.tagName}>\`${snippetPart}`);
  lines.push('');
  lines.push(`- **Status**: ${t.status === 'open' ? 'Open' : 'Resolved'}`);
  lines.push(`- **Selector** (\`${anchor.strategy}\`): \`${anchor.selector}\``);
  if (anchor.pathSelector && anchor.pathSelector !== anchor.selector) {
    lines.push(`- **DOM Path**: \`${anchor.pathSelector}\``);
  }
  if (anchor.textSnippet) {
    lines.push(`- **Visible Text**: "${anchor.textSnippet}"`);
  }
  if (ctx) {
    const trigger = ctx.triggerLabel ? ` (opened via "${ctx.triggerLabel}")` : '';
    lines.push(`- **Overlay Context**: Inside ${ctx.kind}${ctx.title ? ` "${ctx.title}"` : ''}${trigger}`);
  }
  const bb = anchor.boundingBox;
  lines.push(`- **Element Box**: ${bb.width}×${bb.height}px at (${bb.pageX}, ${bb.pageY})`);
  if (screenshotPath) {
    lines.push('');
    lines.push(`![Comment #${t.pinNumber} visual context](${screenshotPath})`);
  }
  lines.push('');
  lines.push(`**Feedback** (${t.author.name}):`);
  lines.push(`> ${t.body.replace(/\n/g, '\n> ')}`);

  if (t.replies.length > 0) {
    lines.push('');
    lines.push('**Discussion / Follow-ups**:');
    for (const r of t.replies) {
      lines.push(`- **${r.author.name}**: ${r.body.replace(/\n/g, ' ')}`);
    }
  }

  return lines.join('\n');
}

export function buildAiIterationMarkdown(threads: CommentThread[], options: ExportPromptOptions): string {
  const sorted = [...threads].sort((a, b) => a.pinNumber - b.pinNumber);
  const open = sorted.filter((t) => t.status === 'open');
  const resolved = sorted.filter((t) => t.status === 'resolved');
  const includeResolved = Boolean(options.includeResolved);
  const shots = options.screenshotPaths ?? {};

  const lines: string[] = [];
  lines.push('# Marklet UI Iteration Brief');
  lines.push('');
  if (options.pageTitle) lines.push(`- **Page**: ${options.pageTitle}`);
  lines.push(`- **URL**: ${options.pageUrl}`);
  if (options.viewport) {
    lines.push(`- **Viewport**: ${options.viewport.width}×${options.viewport.height}`);
  }
  lines.push(`- **Summary**: ${open.length} open, ${resolved.length} resolved`);
  lines.push(`- **Exported**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Instructions for AI');
  lines.push(
    'Please review the element-level UI feedback and visual screenshots below, then update the corresponding components in the codebase. ' +
      'Use each item’s selector, visible text, overlay context, and screenshot to locate the exact element, incorporate the latest conclusion from any discussion replies, and avoid changing unrelated UI.',
  );
  lines.push('');

  if (open.length === 0 && (!includeResolved || resolved.length === 0)) {
    lines.push('_No open comments to export._');
    return lines.join('\n') + '\n';
  }

  if (open.length > 0) {
    lines.push(`## Open Feedback (${open.length})`);
    lines.push('');
    for (const t of open) {
      lines.push(formatThread(t, shots[t.id]));
      lines.push('');
    }
  }

  if (includeResolved && resolved.length > 0) {
    lines.push(`## Resolved Reference (${resolved.length})`);
    lines.push('');
    for (const t of resolved) {
      lines.push(formatThread(t, shots[t.id]));
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

function dataUrlToBytes(dataUrl: string): { ext: string; bytes: Uint8Array } | null {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ext, bytes };
}

/**
 * Package `brief.md` + `screenshots/pin-N.jpg` into a single downloadable `.zip` bundle.
 */
export function buildAiIterationZip(threads: CommentThread[], options: ExportPromptOptions): Blob {
  const sorted = [...threads].sort((a, b) => a.pinNumber - b.pinNumber);
  const includeResolved = Boolean(options.includeResolved);
  const included = sorted.filter((t) => t.status === 'open' || includeResolved);

  const entries: ZipEntry[] = [];
  const screenshotPaths: Record<string, string> = {};

  for (const t of included) {
    if (!t.snapshotDataUrl) continue;
    const decoded = dataUrlToBytes(t.snapshotDataUrl);
    if (!decoded) continue;
    const relPath = `screenshots/comment-${t.pinNumber}.${decoded.ext}`;
    screenshotPaths[t.id] = `./${relPath}`;
    entries.push({ name: relPath, data: decoded.bytes });
  }

  const md = buildAiIterationMarkdown(threads, { ...options, screenshotPaths });
  entries.unshift({ name: 'brief.md', data: new TextEncoder().encode(md) });

  return createZipBlob(entries);
}
