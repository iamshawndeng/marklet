# Privacy Policy — Marklet

**Last updated:** November 21, 2026

Marklet ("the Extension") is built with a strict privacy-first, least-privilege architecture.

## 1. Data Collection & Network Activity
- **Zero data collection:** Marklet does not collect, track, analyze, or transmit any personal data, browsing history, page content, comments, or screenshots to external servers.
- **Zero third-party analytics or ads:** Marklet contains no telemetry, tracking pixels, remote scripts, or third-party SDKs.
- **Zero network requests:** All features operate entirely within your browser.

## 2. How Your Data Is Stored
- Comments, replies, display name preferences, and cropped element screenshots are stored locally on your device using the browser's built-in `chrome.storage.local` API.
- You have full control over your data at all times: you can export comments to JSON or a Design Brief `.zip`, delete comments for individual pages, or clear all stored data from the extension menu.

## 3. Permissions Used
Marklet requests only the minimum permissions required to function:
- **`activeTab`**: Grants temporary access to the currently active tab *only* when you explicitly click the Marklet icon and choose **Start Review**. Marklet never reads or modifies pages in the background.
- **`scripting`**: Injects the isolated Shadow DOM commenting overlay into the active tab after you start a review.
- **`storage`**: Saves your comments, element anchors, and snapshots locally in your browser.

## 4. Contact
If you have any questions about this privacy policy or security practices, please contact Shawn Deng at **shawnzpdeng@gmail.com** or reach out on X ([@shawnzpdeng](https://x.com/shawnzpdeng)).
