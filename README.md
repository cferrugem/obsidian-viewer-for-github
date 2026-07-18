<p align="center">
  <img src="icons/logo.png" alt="Obsidian Viewer for GitHub" width="160" />
</p>

<h1 align="center">Obsidian Viewer for GitHub</h1>

A small Chrome/Edge extension that makes your **Obsidian vault look like Obsidian**
when you read it on **github.com**.

## The problem it solves

You back up your Obsidian vault to a GitHub repo. When you open a note on GitHub,
image embeds and internal links show up as raw text instead of rendering, because
GitHub's Markdown renderer doesn't understand Obsidian's wikilink syntax:

| In your note | GitHub shows | This extension shows |
|---|---|---|
| `![[1000016992.png]]` | `![[1000016992.png]]` (text) | the actual image |
| `[[Inglês]]` | `[[Inglês]]` (text) | a clickable note link |
| `> [!tip] Heads up` | plain quote | a colored Obsidian callout |

It works on **private repos** too — images load through GitHub's own
`.../raw/...` URLs using your logged-in session, exactly like normal README images.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`github_page`, the one containing `manifest.json`).
4. Open any Markdown note in your vault repo, e.g.
   `https://github.com/cferrugem/obsidian/blob/master/Sync/01%20Notas/....md`

That's it — embeds and wikilinks now render.

## Configure your attachment folder

Obsidian resolves images by **filename**, wherever they live in the vault. The
extension tries, in order: the note's own folder, your configured folders, then
the repo root. To make resolution instant and exact, tell it where your images are:

1. On `chrome://extensions`, click **Details** → **Extension options**
   (or right-click the extension → **Options**).
2. Enter your attachment folder(s), one per line, relative to the repo root —
   e.g. `Sync/attachments`.
3. **Save**, then refresh the GitHub note.

Common folders (`attachments`, `assets`, `_resources`, `images`, …) are tried by
default even without configuration.

## What it handles

- `![[image.png]]`, with size: `![[image.png|300]]`
- **Drag-to-resize images**: hover an embedded image and drag the purple handle
  at its bottom-right corner. The size is remembered locally in your browser
  (per image) so it survives reloads — the repo/note is never modified.
  Double-click the handle to reset.
- `![[video.mp4]]`, `![[audio.mp3]]`, `![[doc.pdf]]`
- `[[Note]]`, `[[Note|alias]]`, `[[Note#heading]]` → clickable (opens GitHub
  code search scoped to your repo to jump to the note)
- `![[note.md]]` and other files → a link
- Obsidian callouts: `> [!note] / [!tip] / [!warning] / [!danger]`, etc.
- **Dataview** backlink / MOC queries — the common ones:
  - `LIST FROM [[]]` → the notes that link to the current note (backlinks)
  - `LIST FROM [[Some Note]]` → notes linking to that note
  - `LIST FROM #tag` → notes with that tag
  - `LIST FROM "Folder"` → notes inside that folder

  These are resolved live via GitHub's code search (your session), rendered as
  a list of clickable note links. `TABLE`/`TASK` are simplified to a note list;
  other Dataview queries are shown as a styled, read-only panel (they can't run
  outside Obsidian).
- `==highlights==` → highlighted text
- `#tags` → styled pills (link to a repo-scoped search); hex colors like
  `#e74c3c` and things like `C#` are correctly left alone
- `%%comments%%` → hidden, like in Obsidian (inline)
- An Obsidian-like **reading view**: comfortable width, typography, headings,
  tables, blockquotes, inline code and rules (toggle in options).

## Notes & limits

- Designed for the **github.com** file view (the "Preview" of a `.md` blob),
  which is what you're using. GitHub Pages (`*.github.io`) renders Markdown
  differently and isn't targeted here.
- Wikilinks can't know a note's exact path (a note may live anywhere), so they
  open a repo-scoped GitHub code search for the note name — one click to the file.
- Everything runs locally in your browser. The only permission used is `storage`
  (to remember your folder settings); no data leaves your machine.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3) |
| `content.js` | Rewrites embeds/wikilinks/callouts in the rendered note |
| `styles.css` | Image and Obsidian-like styling |
| `options.html` / `options.js` | Settings page (attachment folders) |
