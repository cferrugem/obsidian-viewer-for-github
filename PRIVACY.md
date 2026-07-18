# Privacy Policy — Obsidian Viewer for GitHub

_Last updated: 2026-07-18_

**Obsidian Viewer for GitHub** ("the extension") is a browser extension that
improves how Obsidian vault notes are displayed on github.com. This policy
explains exactly what it does with data. The short version: **it collects
nothing and sends nothing to the developer or any third party.**

## What the extension does

The extension runs only on `https://github.com/*`. When you view a Markdown
file, it:

- reads the note content already rendered on the page to replace Obsidian
  syntax (`![[embeds]]`, `[[wikilinks]]`, callouts, `==highlights==`, `#tags`,
  `%%comments%%`) with images and links;
- requests the repository's file list and GitHub code-search results **from
  github.com itself**, using your existing GitHub session, only to resolve
  where images and linked notes live.

All of this happens locally in your browser. No page content is transmitted
anywhere other than the normal requests your browser already makes to GitHub.

## Data the extension stores

- **Preferences** (attachment folder names and the "Obsidian styling" toggle)
  are saved with the browser's `storage` API so they persist between sessions.
- **Image sizes** you set by dragging are saved in your browser's local
  storage, per image, so they survive page reloads.

This data stays in your browser. It is never sent to the developer.

## Data the extension does NOT do

- It does **not** collect, transmit, sell, or share any personal data.
- It does **not** use analytics, tracking, cookies, or fingerprinting.
- It does **not** run remote code — all logic ships inside the extension.
- It does **not** modify your repository or notes in any way.

## Permissions

- `storage` — to remember your own display preferences.
- Host access to `https://github.com/*` — the only site the extension runs on,
  needed to read the note you're viewing and to resolve embeds/links via
  GitHub's own file list and search.

## Contact

Questions or issues: open an issue at
<https://github.com/cferrugem/obsidian-viewer-for-github/issues>.
