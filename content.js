/*
 * Obsidian Viewer for GitHub
 * -------------------------------------------------------------
 * When you view a Markdown note from your Obsidian vault on
 * github.com, GitHub renders `![[image.png]]` and `[[Note]]`
 * as plain text because it doesn't understand Obsidian's
 * wikilink syntax. This content script post-processes the
 * rendered Markdown so embeds show their images and wikilinks
 * become clickable, giving an Obsidian-like reading view.
 *
 * Images are resolved BY FILENAME across the whole repo (exactly
 * like Obsidian) using GitHub's own file index — no configuration
 * needed. The folder list in options is only a fallback.
 */

(() => {
  "use strict";

  const IMAGE_EXT = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"
  ]);
  const VIDEO_EXT = new Set(["mp4", "webm", "ogv", "mov"]);
  const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "flac", "3gp"]);
  const PDF_EXT = new Set(["pdf"]);

  // Fallback attachment folders (used only if the file index can't
  // be fetched). The user can override these in the options page.
  const DEFAULT_FOLDERS = [
    "attachments", "Attachments", "assets", "Assets",
    "_attachments", "_resources", "files", "Files",
    "media", "images", "Images"
  ];

  let settings = { folders: DEFAULT_FOLDERS.slice(), obsidianTheme: true };

  // Repo-wide file index: { paths:[...], byName:Map(basename->path) }.
  let treeIndex = null;
  let treePromise = null;

  /* ---------- context ---------------------------------------------------- */

  function parseLocation() {
    const m = location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/
    );
    if (!m) return null;
    const [, owner, repo, ref, rawPath] = m;
    const path = decodeURIComponent(rawPath);
    if (!/\.(md|markdown)$/i.test(path)) return null;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    return { owner, repo, ref, path, dir };
  }

  // Current commit SHA, read from GitHub's embedded page data.
  function findOid() {
    const scripts = document.querySelectorAll(
      'script[type="application/json"]'
    );
    for (const s of scripts) {
      const t = s.textContent;
      if (t && t.indexOf("currentOid") !== -1) {
        const m = t.match(/"currentOid":"([0-9a-f]{40})"/);
        if (m) return m[1];
      }
    }
    return null;
  }

  // Fetch the full recursive file list once, and index it by filename.
  function loadTree(ctx) {
    if (treePromise) return treePromise;
    treePromise = (async () => {
      const oid = findOid();
      if (!oid) return null;
      const url =
        "https://github.com/" + ctx.owner + "/" + ctx.repo +
        "/tree-list/" + oid;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      const j = await r.json();
      const paths = j.paths || (j.tree ? j.tree.map((x) => x.path) : []);
      const byName = new Map();
      for (const p of paths) {
        const base = p.slice(p.lastIndexOf("/") + 1).toLowerCase();
        if (!byName.has(base)) byName.set(base, p);
      }
      return { paths, byName };
    })().catch(() => null);
    return treePromise;
  }

  /* ---------- url helpers ------------------------------------------------ */

  function encodePath(p) {
    return p.split("/").map(encodeURIComponent).join("/");
  }
  function rawUrl(ctx, p) {
    return "https://github.com/" + ctx.owner + "/" + ctx.repo +
      "/raw/" + ctx.ref + "/" + encodePath(p);
  }
  function blobUrl(ctx, p) {
    return "https://github.com/" + ctx.owner + "/" + ctx.repo +
      "/blob/" + ctx.ref + "/" + encodePath(p);
  }
  function extOf(name) {
    const dot = name.lastIndexOf(".");
    return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  }

  // Ordered candidate repo-relative paths for an embed/link target.
  // Exact index match first (Obsidian-style filename resolution),
  // then heuristic folders as a safety net.
  function candidatePaths(ctx, target) {
    const clean = target.replace(/^\.?\//, "");
    const base = clean.slice(clean.lastIndexOf("/") + 1);
    const out = [];
    const push = (p) => { if (p && !out.includes(p)) out.push(p); };

    // 1) Exact resolution from the repo file index.
    if (treeIndex) {
      if (clean.includes("/")) {
        const hit = treeIndex.paths.find((p) => p.endsWith("/" + clean) || p === clean);
        if (hit) push(hit);
      }
      const byName = treeIndex.byName.get(base.toLowerCase());
      if (byName) push(byName);
    }

    // 2) Heuristic fallbacks.
    if (clean.includes("/")) {
      push(clean);
      push(ctx.dir ? ctx.dir + "/" + clean : clean);
    } else {
      if (ctx.dir) push(ctx.dir + "/" + base);
      for (const f of settings.folders) push(f + "/" + base);
      push(base);
    }
    return out;
  }

  /* ---------- element builders ------------------------------------------ */

  function buildImage(ctx, target, width) {
    const paths = candidatePaths(ctx, target);
    const img = document.createElement("img");
    img.className = "obsidian-embed-img";
    img.alt = target;
    img.loading = "lazy";
    const defaultWidth = width ? parseInt(width, 10) : null;
    if (defaultWidth) img.style.width = defaultWidth + "px";
    let i = 0;
    const tryNext = () => {
      if (i >= paths.length) {
        const span = document.createElement("span");
        span.className = "obsidian-embed-missing";
        span.textContent = "🖼️ " + target + " (not found)";
        (img.closest(".obsidian-img-wrap") || img).replaceWith(span);
        return;
      }
      img.src = rawUrl(ctx, paths[i++]);
    };
    img.addEventListener("error", tryNext);
    img.addEventListener(
      "load",
      () => makeResizable(img, ctx, target, defaultWidth),
      { once: true }
    );
    tryNext();
    return img;
  }

  // Drag-to-resize handle (like Obsidian's reading view). The chosen
  // width is remembered locally per image (localStorage) so it survives
  // reloads, but the repo/note is never modified. Double-click resets.
  function sizeKey(ctx, target) {
    return "obsidian-img-size:" + ctx.owner + "/" + ctx.repo + ":" + target;
  }

  function makeResizable(img, ctx, target, defaultWidth) {
    if (img.dataset.obsResizable) return;
    img.dataset.obsResizable = "1";

    const wrap = document.createElement("span");
    wrap.className = "obsidian-img-wrap";
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    const handle = document.createElement("span");
    handle.className = "obsidian-img-handle";
    handle.title = "Arraste para redimensionar · duplo-clique para resetar";
    wrap.appendChild(handle);

    let saved = null;
    try { saved = localStorage.getItem(sizeKey(ctx, target)); } catch (e) {}
    if (saved) img.style.width = saved + "px";
    else if (defaultWidth) img.style.width = defaultWidth + "px";

    let dragging = false, startX = 0, startW = 0;

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startX = e.clientX;
      startW = img.getBoundingClientRect().width;
      handle.setPointerCapture(e.pointerId);
      wrap.classList.add("resizing");
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const max = img.naturalWidth || 4000;
      let w = Math.round(startW + (e.clientX - startX));
      w = Math.max(40, Math.min(w, max));
      img.style.width = w + "px";
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove("resizing");
      try {
        localStorage.setItem(
          sizeKey(ctx, target),
          String(Math.round(img.getBoundingClientRect().width))
        );
      } catch (e) {}
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { localStorage.removeItem(sizeKey(ctx, target)); } catch (e) {}
      if (defaultWidth) img.style.width = defaultWidth + "px";
      else img.style.removeProperty("width");
    });
  }

  function buildMedia(tag, ctx, target) {
    const paths = candidatePaths(ctx, target);
    const el = document.createElement(tag);
    el.className = "obsidian-embed-media";
    el.controls = true;
    let i = 0;
    const tryNext = () => {
      if (i >= paths.length) { el.replaceWith(buildFileLink(ctx, target)); return; }
      el.src = rawUrl(ctx, paths[i++]);
    };
    el.addEventListener("error", tryNext);
    tryNext();
    return el;
  }

  function buildPdf(ctx, target) {
    const frame = document.createElement("iframe");
    frame.className = "obsidian-embed-pdf";
    frame.src = rawUrl(ctx, candidatePaths(ctx, target)[0]);
    return frame;
  }

  function buildFileLink(ctx, target) {
    const a = document.createElement("a");
    a.className = "obsidian-embed-file";
    a.textContent = "📄 " + target;
    a.href = blobUrl(ctx, candidatePaths(ctx, target)[0]);
    return a;
  }

  function buildWikiLink(ctx, target) {
    let [dest, alias] = target.split("|");
    dest = dest.split("#")[0].trim();
    const label = (alias || target.split("|")[0]).trim();

    const a = document.createElement("a");
    a.className = "obsidian-wikilink";
    a.textContent = label;

    const base = dest.split("/").pop();
    // Prefer an exact path from the file index; fall back to code search.
    let href = null;
    if (treeIndex) {
      const hit =
        treeIndex.byName.get((base + ".md").toLowerCase()) ||
        treeIndex.byName.get((base + ".markdown").toLowerCase());
      if (hit) href = blobUrl(ctx, hit);
    }
    if (!href) {
      const q = "repo:" + ctx.owner + "/" + ctx.repo + " path:" + base + ".md";
      href = "https://github.com/search?type=code&q=" + encodeURIComponent(q);
    }
    a.href = href;
    a.title = "Obsidian note: " + dest;
    return a;
  }

  /* ---------- Dataview (backlink / MOC queries) -------------------------- */

  function noteDisplayName(path) {
    return path
      .slice(path.lastIndexOf("/") + 1)
      .replace(/\.(md|markdown)$/i, "");
  }

  // Query GitHub's code search (same-origin, uses your session) and
  // return the matching file paths. Works on private repos.
  async function ghCodeSearch(ctx, rawQuery) {
    const q = "repo:" + ctx.owner + "/" + ctx.repo + " " + rawQuery;
    const url = "https://github.com/search?type=code&q=" + encodeURIComponent(q);
    const r = await fetch(url, { headers: { Accept: "text/html" } });
    if (!r.ok) return [];
    const html = await r.text();
    const decode = (s) =>
      s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const scripts = html.matchAll(
      /data-target="react-app\.embeddedData">(.*?)<\/script>/gs
    );
    for (const s of scripts) {
      try {
        const j = JSON.parse(decode(s[1]));
        if (j.payload && Array.isArray(j.payload.results)) {
          return j.payload.results.map((x) => x.path).filter(Boolean);
        }
      } catch (e) { /* try next script block */ }
    }
    return [];
  }

  // Recognise a Dataview query in a plain code block.
  function parseDataview(text) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    const km = lines[0].match(/^(LIST|TABLE|TASK|CALENDAR)\b/i);
    if (!km) return null;
    if (!/\b(FROM|WHERE|SORT|GROUP BY|FLATTEN|LIMIT)\b/i.test(text) &&
        !/\b(file\.|this\.)/.test(text)) {
      return null;
    }
    const fromLine = lines.find((l) => /^FROM\b/i.test(l));
    const source = fromLine ? fromLine.replace(/^FROM\s+/i, "").trim() : "";
    return { type: km[1].toUpperCase(), source, text };
  }

  // Turn a Dataview source into a concrete list of note paths.
  async function resolveDataview(ctx, dv) {
    const src = dv.source;
    if (!src) return null; // "list everything" — skip, would be huge

    // Backlinks: FROM [[]]  or  FROM [[Some Note]]
    if (/\[\[/.test(src)) {
      const inner = (src.match(/\[\[([^\]]*)\]\]/) || [, ""])[1];
      let name = inner.split("|")[0].split("#")[0].trim();
      if (!name) name = noteDisplayName(ctx.path); // [[]] == current note
      const esc = name.replace(/"/g, '\\"');
      const query =
        '("[[' + esc + ']]" OR "[[' + esc + '|" OR "[[' + esc + '#")';
      const paths = await ghCodeSearch(ctx, query);
      return paths.filter((p) => p !== ctx.path);
    }

    // Tag: FROM #tag
    let m = src.match(/#([\w/-]+)/);
    if (m) {
      const paths = await ghCodeSearch(ctx, '"#' + m[1] + '"');
      return paths.filter((p) => p !== ctx.path);
    }

    // Folder: FROM "Folder/Path"
    m = src.match(/^"(.+)"$/);
    if (m && treeIndex) {
      const folder = m[1].replace(/\/+$/, "");
      return treeIndex.paths.filter(
        (p) => p.startsWith(folder + "/") &&
               /\.(md|markdown)$/i.test(p) && p !== ctx.path
      );
    }
    return null; // unsupported source
  }

  function renderDataview(ctx, dv, paths) {
    const panel = document.createElement("div");
    panel.className = "obsidian-dataview";

    const head = document.createElement("div");
    head.className = "obsidian-dataview-head";
    head.textContent =
      "◆ Dataview · " + dv.type + (paths ? " · " + paths.length : "");
    panel.appendChild(head);

    if (!paths) {
      const pre = document.createElement("pre");
      pre.className = "obsidian-dataview-src";
      pre.textContent = dv.text.trim();
      panel.appendChild(pre);
      const hint = document.createElement("div");
      hint.className = "obsidian-dataview-hint";
      hint.textContent = "Consulta Dataview dinâmica (não executável no GitHub).";
      panel.appendChild(hint);
      return panel;
    }
    if (!paths.length) {
      const empty = document.createElement("div");
      empty.className = "obsidian-dataview-hint";
      empty.textContent = "Nenhuma nota vinculada encontrada.";
      panel.appendChild(empty);
      return panel;
    }

    const ul = document.createElement("ul");
    ul.className = "obsidian-dataview-list";
    paths
      .slice()
      .sort((a, b) => noteDisplayName(a).localeCompare(noteDisplayName(b)))
      .forEach((p) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "obsidian-wikilink";
        a.href = blobUrl(ctx, p);
        a.textContent = noteDisplayName(p);
        li.appendChild(a);
        ul.appendChild(li);
      });
    panel.appendChild(ul);

    if (dv.type !== "LIST") {
      const hint = document.createElement("div");
      hint.className = "obsidian-dataview-hint";
      hint.textContent = "(" + dv.type + " simplificada para lista de notas)";
      panel.appendChild(hint);
    }
    return panel;
  }

  function processDataviewBlocks(ctx, container) {
    container
      .querySelectorAll("pre:not([data-obs-block])")
      .forEach((pre) => {
        const code = pre.querySelector("code") || pre;
        const dv = parseDataview(code.textContent);
        if (!dv) return;

        // Non-destructive: keep the React-owned <pre> in the DOM (hidden)
        // so GitHub can still update it on SPA navigation; render our panel
        // as a sibling right after it.
        pre.setAttribute("data-obs-block", "1");
        pre.classList.add("obsidian-block-hidden");

        const loading = document.createElement("div");
        loading.className = "obsidian-dataview";
        loading.innerHTML =
          '<div class="obsidian-dataview-head">◆ Dataview · ' +
          dv.type + ' <span class="obsidian-dv-loading">carregando…</span></div>';
        pre.insertAdjacentElement("afterend", loading);

        const swap = (node) => { if (loading.isConnected) loading.replaceWith(node); };
        resolveDataview(ctx, dv)
          .then((paths) => swap(renderDataview(ctx, dv, paths)))
          .catch(() => swap(renderDataview(ctx, dv, null)));
      });
  }

  // Remove everything this extension injected into a container, and
  // restore the originals it hid. Used when a reused .markdown-body
  // switches to a different note during SPA navigation.
  function cleanupInjections(container) {
    container.querySelectorAll(".obsidian-dataview").forEach((el) => el.remove());
    container.querySelectorAll("pre[data-obs-block]").forEach((pre) => {
      pre.removeAttribute("data-obs-block");
      pre.classList.remove("obsidian-block-hidden");
    });
  }

  function buildNode(ctx, isEmbed, inner) {
    if (isEmbed) {
      let [target, size] = inner.split("|");
      target = target.trim();
      const bare = target.split("#")[0];
      const ext = extOf(bare);
      const width = size && /^\d+$/.test(size.trim()) ? size.trim() : null;
      if (IMAGE_EXT.has(ext)) return buildImage(ctx, bare, width);
      if (VIDEO_EXT.has(ext)) return buildMedia("video", ctx, bare);
      if (AUDIO_EXT.has(ext)) return buildMedia("audio", ctx, bare);
      if (PDF_EXT.has(ext)) return buildPdf(ctx, bare);
      return buildFileLink(ctx, target);
    }
    return buildWikiLink(ctx, inner);
  }

  /* ---------- inline markup (wikilinks, highlights, tags, comments) ------ */

  // One master matcher for every inline token we rewrite:
  //   ![[embed]] / [[wikilink]] | ==highlight== | %%comment%% | #tag
  const INLINE = new RegExp(
    "(!?)\\[\\[([^\\]\\n]+)\\]\\]" +                 // 1:!  2:wikilink/embed
    "|==([^=\\s][^=\\n]*?[^=\\s]|[^=\\s])==" +        // 3: ==highlight==
    "|%%([^\\n]*?)%%" +                               // 4: %%comment%%
    "|(?<![\\w&#/])#([\\p{L}_][\\p{L}\\d_/-]*)",      // 5: #tag
    "gu"
  );

  function isHexColor(s) {
    return /^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s);
  }

  function buildHighlight(text) {
    const mark = document.createElement("mark");
    mark.className = "obsidian-mark";
    mark.textContent = text;
    return mark;
  }

  function buildTag(ctx, tag) {
    const a = document.createElement("a");
    a.className = "obsidian-tag";
    a.textContent = "#" + tag;
    a.href = "https://github.com/search?type=code&q=" +
      encodeURIComponent("repo:" + ctx.owner + "/" + ctx.repo + ' "#' + tag + '"');
    a.title = "Tag: #" + tag;
    return a;
  }

  function processTextNode(ctx, node) {
    const text = node.nodeValue;
    if (!text) return;
    INLINE.lastIndex = 0;
    let m, last = 0, changed = false;
    const frag = document.createDocumentFragment();

    while ((m = INLINE.exec(text)) !== null) {
      let tok = null;
      if (m[2] !== undefined) {
        tok = buildNode(ctx, m[1] === "!", m[2]);
      } else if (m[3] !== undefined) {
        tok = buildHighlight(m[3]);
      } else if (m[4] !== undefined) {
        tok = document.createComment(" obsidian-comment "); // hide %%...%%
      } else if (m[5] !== undefined) {
        if (!isHexColor(m[5]) && /[A-Za-zÀ-ÿ]/.test(m[5])) tok = buildTag(ctx, m[5]);
      }
      if (!tok) continue; // leave this match as plain text (e.g. hex color)

      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      frag.appendChild(tok);
      last = INLINE.lastIndex;
      changed = true;
    }

    if (!changed) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  const INLINE_HINT = /\[\[|==|%%|(?<![\w&#/])#[\p{L}_]/u;

  // Idempotent: text nodes that were already converted no longer contain
  // "[[", and Dataview <pre>s carry a marker — so re-running is safe and
  // picks up content that GitHub renders progressively or after nav.
  function processContainer(ctx, container) {
    if (settings.obsidianTheme) container.classList.add("obsidian-view");

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !INLINE_HINT.test(n.nodeValue)) {
          return NodeFilter.FILTER_REJECT;
        }
        let p = n.parentElement;
        while (p && p !== container) {
          const tag = p.tagName;
          if (tag === "CODE" || tag === "PRE" || tag === "A" ||
              tag === "TEXTAREA" || tag === "SCRIPT" || tag === "STYLE") {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    for (const t of targets) processTextNode(ctx, t);

    styleCallouts(container);
    processDataviewBlocks(ctx, container);
  }

  /* ---------- Obsidian-style callouts ------------------------------------ */

  const CALLOUT_ICONS = {
    note: "🖊️", info: "ℹ️", tip: "💡", hint: "💡", important: "❗",
    success: "✅", check: "✅", done: "✅", question: "❓", faq: "❓",
    warning: "⚠️", caution: "⚠️", attention: "⚠️", failure: "❌",
    fail: "❌", danger: "⛔", error: "⛔", bug: "🐞", example: "📋",
    quote: "❝", abstract: "📑", summary: "📑", todo: "📝"
  };

  function styleCallouts(container) {
    container
      .querySelectorAll("blockquote:not([data-obsidian-callout])")
      .forEach((bq) => {
        const firstP = bq.querySelector("p");
        if (!firstP) return;
        const m = firstP.textContent.match(/^\s*\[!(\w+)\]([+-]?)\s*(.*)/s);
        if (!m) return;
        const type = m[1].toLowerCase();
        const title = m[3].trim() || type.charAt(0).toUpperCase() + type.slice(1);
        bq.setAttribute("data-obsidian-callout", type);
        bq.classList.add("obsidian-callout");
        const head = document.createElement("div");
        head.className = "obsidian-callout-title";
        head.textContent = (CALLOUT_ICONS[type] || "🔹") + " " + title;
        firstP.remove();
        bq.insertBefore(head, bq.firstChild);
      });
  }

  /* ---------- run / observe ---------------------------------------------- */

  let lastPath = null;

  async function run() {
    const ctx = parseLocation();
    if (!ctx) { lastPath = null; return; }

    // Note changed (SPA navigation) → drop stale state and clear any
    // panels left over in a reused .markdown-body element.
    if (ctx.path !== lastPath) {
      lastPath = ctx.path;
      treeIndex = null;
      treePromise = null;
      document.querySelectorAll(".markdown-body").forEach(cleanupInjections);
    }

    if (!treeIndex) treeIndex = await loadTree(ctx);
    document
      .querySelectorAll(".markdown-body")
      .forEach((el) => processContainer(ctx, el));
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; run(); });
  }

  function init() {
    run();
    new MutationObserver(schedule).observe(document.body, {
      childList: true, subtree: true
    });
    // GitHub navigates client-side (React Router / Turbo). Hook the
    // History API so we notice the URL change even without a reload.
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function () {
        const result = original.apply(this, arguments);
        schedule();
        return result;
      };
    }
    window.addEventListener("popstate", schedule);
    document.addEventListener("turbo:load", schedule);
  }

  chrome.storage.sync.get(
    { folders: DEFAULT_FOLDERS, obsidianTheme: true },
    (stored) => {
      if (Array.isArray(stored.folders) && stored.folders.length) {
        settings.folders = stored.folders;
      }
      settings.obsidianTheme = stored.obsidianTheme !== false;
      init();
    }
  );
})();
