import { TreeView } from './tree-view.js';
import { ContentViewer } from './content-viewer.js';
import { TapAssembler } from './tap-assembler.js';

const treeContainer = document.getElementById('tree-container');
const contentContainer = document.getElementById('content-container');
const currentPathEl = document.getElementById('current-path');
const btnOpenFolder = document.getElementById('btn-open-folder');
const divider = document.getElementById('divider');
const treePanel = document.getElementById('tree-panel');

const contentViewer = new ContentViewer(contentContainer);
const tapAssembler = new TapAssembler(contentContainer);

let currentFolder = null;

const treeView = new TreeView(treeContainer, {
  onSelectDirectory: (path, entries) => {
    currentFolder = path;
    contentViewer.showDirectoryInfo(path, entries);
  },
  onSelectTapFile: (path, blocks) => {
    currentFolder = path.substring(0, path.lastIndexOf('/'));
    contentViewer.showFileInfo(path, blocks);
  },
  onSelectBlock: (filePath, blockIndex) => {
    contentViewer.showBlock(filePath, blockIndex);
  },
});

// Wire dirty-state callback (after treeView is created)
contentViewer.onDirtyChange = (filePath, isDirty) => {
  treeView.setFileDirty(filePath, isDirty);
};

// Open folder
async function openFolder() {
  const folderPath = await window.api.openFolderDialog();
  if (folderPath) {
    currentFolder = folderPath;
    currentPathEl.textContent = folderPath;
    currentPathEl.title = folderPath;
    treeView.setRoot(folderPath);
  }
}

btnOpenFolder.addEventListener('click', openFolder);
window.api.onMenuOpenFolder(openFolder);

// Save TAP As (from menu)
window.api.onMenuSaveTapAs(() => {
  if (contentViewer.currentFilePath && contentViewer.hasEdits(contentViewer.currentFilePath)) {
    contentViewer.saveTapAs(contentViewer.currentFilePath);
  }
});

// TAP Assembler (from menu)
window.api.onMenuOpenAssembler(() => {
  if (currentFolder) {
    tapAssembler.open(currentFolder);
  }
});

// Start with home directory
(async () => {
  const homePath = await window.api.getHomePath();
  currentFolder = homePath;
  currentPathEl.textContent = homePath;
  currentPathEl.title = homePath;
  treeView.setRoot(homePath);
})();

// Divider drag
let isDragging = false;
let startX = 0;
let startWidth = 0;

divider.addEventListener('mousedown', (e) => {
  isDragging = true;
  startX = e.clientX;
  startWidth = treePanel.offsetWidth;
  divider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const delta = e.clientX - startX;
  const newWidth = Math.min(600, Math.max(200, startWidth + delta));
  treePanel.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
  }
});
