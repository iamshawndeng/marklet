# Store Listing & Review Submission Kit

Use this sheet when submitting `release/marklet-v0.1.0.zip` to **Chrome Web Store** and **Microsoft Edge Add-ons**.

---

## 1. Basic Listing Copy

- **Name (50 chars)**:
  `Marklet — Visual Comments for Async and AI Workflows`

- **Short Description / Summary (120 chars, limit 132)**:
  `Leave element-level comments on any webpage or prototype for async design feedback, team handoff, and agentic workflows.`

- **Category**:
  `Developer Tools` (or `Productivity`)

- **Detailed Description**:
```text
Marklet lets you leave precise, element-level comments directly on any live webpage or local HTML prototype — without leaving your browser.

Built for designers, product managers, and engineers who want fast async UI feedback and clean handoffs to teammates or AI coding tools.

KEY FEATURES
• Element-level commenting: Click any UI element to attach a comment, reply in threads, and mark items resolved.
• Visual context snapshots: Automatically captures a cropped screenshot of the target element so feedback stays clear even after a page changes.
• Smart DOM anchoring: Re-attaches comments reliably across reloads and inside modals or dialogs.
• Export Design Brief (.zip): Package open comments, selectors, discussion context, and cropped element screenshots into a single .zip ready for teammates or AI coding agents.
• Works everywhere: Review production web pages, staging apps, or local HTML prototypes (enable "Allow access to file URLs" in extension settings for file:// pages).
• Light & Dark mode: Automatically matches your system theme.

PRIVACY & SECURITY FIRST
• Zero background tracking: Marklet never reads or injects into a page until you explicitly click "Start Review".
• Zero network requests: All comments and snapshots stay privately on your device using browser local storage, with built-in JSON export/import and one-click clear controls.
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
  > Used to store the user's comments, replies, display name preference, and cropped element screenshots locally on their device via `chrome.storage.local`.

### Remote Code Declaration
- **Are you using remote code?** → **No, I am not using remote code.** (All JS/CSS is bundled inside the extension package.)

### Data Usage Declaration (Chrome Web Store Privacy Practices)
- Collects user data? → **No** (all checkboxes unchecked)
- Certify compliance with Limited Use policy → **Checked**

---

## 3. Store Assets Checklist
- [x] **Extension archive**: `release/marklet-v0.1.0.zip` (generated via `npm run package`)
- [x] **Store icon (128×128 PNG)**: `dist/icons/icon-128.png`
- [x] **Privacy Policy URL**: `https://github.com/iamshawndeng/marklet/blob/main/PRIVACY.md`
- [x] **Homepage / Support URL**: `https://github.com/iamshawndeng/marklet`
- [ ] **Screenshots (1280×800 PNG, 1–5 images)**:
  1. Prototype page with Comments sidebar open + `Export Design Brief` button (Light mode)
  2. Comment detail card showing cropped element screenshot + replies (Dark mode)
  3. Extension Popup showing `Start Review` / `Reviewing` + `2 open comments`
- [ ] **Small Promo Tile (440×280 PNG)** (optional for Chrome, recommended for Edge)
