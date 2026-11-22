# Changelog

All notable changes to Marklet are documented in this file.

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
