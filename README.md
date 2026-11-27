# Marklet

Figma-style feedback on any web prototype. Send your team a link for async reviews, merge every comment, and export one `.zip` brief for AI to iterate.

[**Website**](https://iamshawndeng.github.io/marklet/) · [**Chrome Web Store**](https://chromewebstore.google.com/detail/marklet-%E2%80%94-visual-comments/pkiegfieoakiggifpgoliodceglkmdel) · [**Microsoft Edge Add-ons**](https://microsoftedge.microsoft.com/addons/detail/marklet-%E2%80%94-visual-comments/pbalkephghpppkgfamcamkflfmnmcghl) · [**Privacy Policy**](https://iamshawndeng.github.io/marklet/privacy.html)

![Marklet — Figma-style feedback on any web prototype](./docs/images/store-1-review.png)

![Marklet — Send a link, merge comments, export for AI](./docs/images/store-2-handoff.png)

## Highlights
- **Async team collaboration (`Send` & `Merge`)**: Reviewers click **Send** to copy a clean feedback link into Teams, Slack, or email. The page owner opens each link and clicks **Merge** to combine everyone's comments onto the page without overwriting existing feedback — no workspace setup, no cloud uploads, and page access stays with your site.
- **Export Design Brief (`.zip`)**: One-click export of `brief.md` + DOM selectors + cropped element screenshots — ready to drop straight into AI coding tools (Antigravity, Cursor, Claude, Codex, Copilot).
- **Optional Microsoft & Google Sign-In**: Sync your real name and profile avatar onto comments with read-only OAuth (`User.Read` / `openid profile email`), or stay 100% anonymous with zero network requests.
- **Explicit, least-privilege activation**: Uses `activeTab`, `scripting`, `storage`, and optional `identity` — zero `<all_urls>`, zero background tab monitoring. Marklet never touches a page until you click **Start Review**.
- **Resilient element anchoring & multi-page awareness**: Composite DOM anchoring (`data-testid` → `id` → semantic selector → structural path) with modal/dialog context detection and same-site multi-page navigation.
- **Works everywhere (Light & Dark)**: Review production sites, internal tools, staging links, or local `file://` HTML prototypes.

## Architecture (3 Decoupled Layers)

```
src/
├── core/                    # Pure UI commenting engine (zero chrome.* APIs)
│   ├── anchor.ts            # ElementPicker + composite anchor generation & resolution
│   ├── OverlayApp.tsx       # Shadow DOM toolbar, comment cards, and Comments sidebar
│   ├── overlay.css          # Injected inline into ShadowRoot (Light & Dark themes)
│   ├── exportPrompt.ts      # Markdown & .zip Design Brief generator
│   └── zip.ts               # Zero-dependency ZIP archive builder
├── adapters/                # Pluggable persistence & identity contracts (zero chrome.*)
│   ├── types.ts             # StorageAdapter, AuthAdapter, CommentThread, ElementAnchor
│   ├── localStorageAdapter.ts
│   └── authAdapter.ts
└── extension/               # Chrome / Edge MV3 shell
    ├── manifest.json        # Least-privilege MV3 (activeTab, scripting, storage)
    ├── background.ts        # On-demand injection, viewport capture, per-tab badge
    ├── content.ts           # ShadowRoot + Popover API Top Layer host
    ├── chromeStorageAdapter.ts
    ├── popup.html / popup.tsx
    └── icons/
```

Dependency boundaries are enforced at build time by `scripts/check-layers.mjs` (`core` and `adapters` cannot import `chrome.*`), making it easy to plug in an enterprise REST/WebSocket backend, SSO identity provider, or VS Code Webview shell later.

## Install

- **Microsoft Edge**: [Install from Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/marklet-%E2%80%94-visual-comments/pbalkephghpppkgfamcamkflfmnmcghl)
- **Google Chrome**: [Install from Chrome Web Store](https://chromewebstore.google.com/detail/marklet-%E2%80%94-visual-comments/pkiegfieoakiggifpgoliodceglkmdel)

## Development

```bash
npm install
npm run build      # Layer check + TypeScript typecheck + Vite build -> dist/
npm run package    # Build + zip dist/ -> release/marklet-v<version>.zip
npm run dev        # Development build with inline sourcemaps
```

### Load Unpacked in Chrome / Edge
1. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Click **Load unpacked** and select the `dist/` directory.
3. *(Optional for local HTML files)* Open **Details** → enable **Allow access to file URLs**.
4. Open any webpage (or `demo/test-prototype.html`), click the **Marklet** toolbar icon, and choose **Start Review**.

## Privacy & Security
Marklet makes **zero network requests by default** and stores all comments and screenshots locally in your browser via `chrome.storage.local`. Optional Microsoft or Google sign-in only connects to official OAuth endpoints (`User.Read` / `openid profile email`) when you explicitly click sign-in. See [PRIVACY.md](./PRIVACY.md) for full details.

## Feedback & Author
Built by Shawn Deng ([@shawnzpdeng](https://x.com/shawnzpdeng)). Have ideas or bug reports? Feel free to open a GitHub Issue or say hi on X!
