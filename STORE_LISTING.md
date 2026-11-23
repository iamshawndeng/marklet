# Store Listing & Review Submission Kit

Use this sheet when updating `release/marklet-v0.2.0.zip` on **Chrome Web Store** and **Microsoft Edge Add-ons**.

---

## 1. Basic Listing Copy

- **Name**:
  `Marklet — Visual Comments for Async and AI Workflows`

- **Short Description / Summary (119 chars, limit 132)**:
  `Figma-style feedback on any web prototype. Send your team a link for async reviews, merge comments, and export for AI.`

- **Official Website URL**:
  `https://iamshawndeng.github.io/marklet/`

- **Privacy Policy URL**:
  `https://iamshawndeng.github.io/marklet/privacy.html`

- **Support / Issues URL**:
  `https://github.com/iamshawndeng/marklet/issues`

- **Category**:
  `Developer Tools`

- **Detailed Description**:
```text
Marklet brings Figma-style comments to any live webpage or local HTML prototype.

Send your team a link for async design reviews, merge everyone's feedback in one click, and export a single .zip brief for AI to iterate.

How it works
01. Mark the page — Click Start Review, press C, and click any UI element to attach a comment with an automatic cropped snapshot.
02. Send a link — Click Send to copy a clean feedback link into Teams, Slack, or email. Nothing is uploaded to a cloud.
03. Merge and export for AI — Open teammates' links to merge their notes without overwriting yours, then export one .zip brief (Markdown, exact selectors, and cropped snapshots) for Cursor, Claude, Codex, or Antigravity.

Private by default
• Nothing runs in the background — Marklet only activates when you click Start Review.
• Local storage — Comments and snapshots stay in your browser.
• Optional Microsoft & Google sign-in — Sync your name and avatar onto comments, or review anonymously.
• Works everywhere — Review production pages, staging apps, internal prototypes, or local file:// HTML pages.
```

---

## 2. Chrome Web Store / Edge Add-ons Privacy & Permissions Justifications

### Single Purpose Statement
> Marklet allows users to leave element-level visual comments on web pages and HTML prototypes during an active review session and export structured design briefs.

### Permission Justifications
- **`activeTab`**:
  > Used only when the user explicitly clicks the Marklet icon and selects "Start Review" to access the active tab's title/URL, inject the commenting overlay, and capture cropped element screenshots during that session.
- **`scripting`**:
  > Used to inject Marklet's isolated Shadow DOM commenting overlay (`content.js`) on demand into the active tab after the user starts a review.
- **`storage`**:
  > Used to store the user's comments, replies, optional display profile, and cropped element screenshots locally on their device via `chrome.storage.local`.
- **`identity`** & OAuth host permissions (`login.microsoftonline.com`, `graph.microsoft.com`, `accounts.google.com`, `www.googleapis.com`):
  > Used strictly on explicit user action when clicking "Microsoft" or "Google" in the extension popup to authenticate via standard OAuth 2.0 (`chrome.identity.launchWebAuthFlow`) and fetch only the user's display name, email, and profile photo into local browser storage. Never invoked in the background and never requests file or browsing permissions.

---

## 3. Store Screenshots (`1280×800` PNG — 2 high-impact slides)
1. [docs/images/store-1-review.png](file:///Users/shawndeng/Downloads/marklet/docs/images/store-1-review.png) — **Live Review Experience (Light Mode)**: Full browser prototype with teardrop pins `#1` & `#2`, open `Comment #1` popover, floating bottom toolbar, and open `Comments` sidebar.
2. [docs/images/store-2-handoff.png](file:///Users/shawndeng/Downloads/marklet/docs/images/store-2-handoff.png) — **Async Link & AI Brief Handoff (Dark Mode)**: Marklet extension popup (`Send 2 comments`), 1-click `Merge 3 comments` bar, and exported `marklet-brief.zip` with `brief.md` + auto-cropped element snapshot.
