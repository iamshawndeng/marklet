# Privacy Policy — Marklet

**Last updated:** November 22, 2026

Marklet ("the Extension") is built with a strict privacy-first, least-privilege architecture.

## 1. Data Collection & Network Activity
- **Zero data collection by Marklet:** Marklet operates with **no backend server** and does not collect, track, analyze, or transmit your browsing history, page content, comments, or screenshots to any Marklet or third-party server.
- **Zero third-party analytics or ads:** Marklet contains no telemetry, tracking pixels, remote scripts, or third-party SDKs.
- **Optional Sign-In (Microsoft / Google):** Signing in is completely optional. Only when you explicitly click **Microsoft** or **Google** in the extension popup does Marklet authenticate directly with Microsoft (`login.microsoftonline.com` / `graph.microsoft.com`) or Google (`accounts.google.com` / `www.googleapis.com`) using standard OAuth 2.0 to read your display name, email address, and profile avatar. This profile information is stored solely on your local device (`chrome.storage.local`) and is never sent to any Marklet server.
- **Zero-server feedback links:** When you click **Send**, Marklet compresses your text comments locally into a URL `#hash` fragment so you can paste them into your own chat or email tool. URL hash fragments are never transmitted to web servers.

## 2. How Your Data Is Stored
- Comments, replies, optional sign-in profile (name, email, avatar), and cropped element screenshots are stored locally on your device using the browser's built-in `chrome.storage.local` API.
- You have full control over your data at all times: you can sign out, export comments to JSON or a Design Brief `.zip`, delete comments for individual pages, or clear all stored data from the extension menu.

## 3. Permissions Used
Marklet requests only the minimum permissions required to function:
- **`activeTab`**: Grants temporary access to the currently active tab *only* when you explicitly click the Marklet icon and choose **Start Review**. Marklet never reads or modifies pages in the background.
- **`scripting`**: Injects the isolated Shadow DOM commenting overlay into the active tab after you start a review.
- **`storage`**: Saves your comments, element anchors, snapshots, and optional profile locally in your browser.
- **`identity`** (and Microsoft/Google OAuth host permissions): Used *only* when you explicitly click **Sign in with Microsoft** or **Google** to fetch your display name, email, and avatar for comments.

## 4. Contact
If you have any questions about this privacy policy or security practices, please contact Shawn Deng at **shawnzpdeng@gmail.com** or open an issue at [github.com/iamshawndeng/marklet/issues](https://github.com/iamshawndeng/marklet/issues).
