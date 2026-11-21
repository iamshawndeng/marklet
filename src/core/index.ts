/**
 * Public surface of the Marklet core engine.
 * Any host (browser extension, VS Code Webview, standalone script tag) mounts
 * `OverlayApp` inside a Shadow DOM and injects adapters.
 */
export { OverlayApp, type OverlayAppProps, type OverlayController } from './OverlayApp';
export * from './anchor';
export { buildAiIterationMarkdown, buildAiIterationZip, type ExportPromptOptions } from './exportPrompt';
export { default as overlayCss } from './overlay.css?inline';
