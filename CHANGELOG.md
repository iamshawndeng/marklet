# Changelog

All notable changes to Marklet are documented in this file.

## [0.2.0] - 2026-11-22

### Added
- **Zero-server async team reviews (`Send` & `Merge`)**: Click **Send** (in the Comments panel footer or extension popup) to compress your comments into a shareable `#marklet=` link copied as a clean rich hyperlink for Teams, Slack, or email. Teammates open the link and click **Merge** to combine everyone's comments onto the page without overwriting existing feedback, then export a single `.zip` Design Brief for AI coding tools.
- **Optional Microsoft & Google Sign-In**: Sign in with a Microsoft (Entra ID / Outlook) or Google account to automatically sync your real name and profile avatar onto comments — zero backend server, read-only profile scopes (`User.Read` / `openid profile email`), completely optional.
- **Interactive "How Marklet works" guide**: Added a `?` help button in the extension popup header with custom Light/Dark vector illustrations explaining the 3-step Mark → Send → Merge & Export async workflow and keyboard shortcuts.

### Improved
- **Cleaner Popup layout & hierarchy**: Moved `Feedback ↗` into the `···` overflow menu, promoted primary actions (`Send`, `Show comments`, `Review & Merge`) with clear visual hierarchy, and aligned status notifications directly below the action buttons.
- **Updated Privacy Policy & Store Listing**: Documented optional Microsoft/Google OAuth sign-in and zero-server URL hash sharing clearly in `PRIVACY.md` and `STORE_LISTING.md`.

## [0.1.1] - 2026-11-21

### Added
- **Multi-page site awareness**: View and jump to comments on other pages of the same site (`Other pages on <host>`) directly from the Comments panel, while keeping your review session and panel open across same-origin navigation.
- **Comments panel shortcut**: Toggle the Comments panel anytime with the `S` keyboard shortcut (shown as `All comments (S)` in the toolbar tooltip).
- **Reduced motion support**: Full `prefers-reduced-motion: reduce` accessibility support across both the overlay and extension popup.

### Improved
- **Smarter Comments panel**: Automatically opens when starting review on a page with existing comments, stays open when inspecting uncovered pins, and automatically yields (and restores) when overlapping a focused element.
- **Refined UI & micro-interactions**: Spring-animated segmented controls with rolling count numbers, in-place morphing delete confirmation (replacing browser `confirm` dialogs), animated status toasts with SVG check-draw feedback, inline `Exported .zip` button confirmation, and a cleaner comment card header & extension popup (removed `Recent pages`).
- **Feedback link**: Updated the extension popup Feedback link to point directly to GitHub Issues.

### Fixed
- **Off-screen element detection**: Fixed elements scrolled behind sticky headers or near viewport edges being misclassified as "Covered by an open overlay"; they now accurately show "Element is off-screen" with a working **Scroll to** button.

## [0.1.0] - 2026-11-21

### Added
- Initial release of Marklet MV3 Chrome / Microsoft Edge extension with Shadow DOM commenting overlay, composite DOM anchoring, cropped visual element snapshots, Light & Dark mode, and one-click `.zip` Design Brief export.
