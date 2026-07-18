const DEFAULT_FOLDERS = [
  "attachments", "Attachments",
  "assets", "Assets",
  "_attachments", "_resources",
  "files", "Files", "media", "images", "Images"
];

const foldersEl = document.getElementById("folders");
const themeEl = document.getElementById("theme");
const savedEl = document.getElementById("saved");

chrome.storage.sync.get(
  { folders: DEFAULT_FOLDERS, obsidianTheme: true },
  (s) => {
    foldersEl.value = (s.folders || DEFAULT_FOLDERS).join("\n");
    themeEl.checked = s.obsidianTheme !== false;
  }
);

document.getElementById("save").addEventListener("click", () => {
  const folders = foldersEl.value
    .split("\n")
    .map((l) => l.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);

  chrome.storage.sync.set(
    {
      folders: folders.length ? folders : DEFAULT_FOLDERS,
      obsidianTheme: themeEl.checked
    },
    () => {
      savedEl.classList.add("show");
      setTimeout(() => savedEl.classList.remove("show"), 1500);
    }
  );
});
