const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  getTapBlocks: (filePath) => ipcRenderer.invoke('tap-blocks', filePath),
  getTapBlockContent: (filePath, blockIndex, offset, limit) =>
    ipcRenderer.invoke('tap-block-content', filePath, blockIndex, offset, limit),
  openFolderDialog: () => ipcRenderer.invoke('open-folder'),
  getHomePath: () => ipcRenderer.invoke('get-home-path'),
  showSaveDialog: (defaultName) => ipcRenderer.invoke('save-tap-dialog', defaultName),
  saveTapAs: (originalPath, savePath, edits) =>
    ipcRenderer.invoke('save-tap-as', originalPath, savePath, edits),
  saveBasicFromCapture: (filePath, blockIndex, savePath) =>
    ipcRenderer.invoke('save-basic-from-capture', filePath, blockIndex, savePath),
  saveEditedBasic: (savePath, name, lines, autostart, variablesBase64) =>
    ipcRenderer.invoke('save-edited-basic', savePath, name, lines, autostart, variablesBase64),
  savePng: (savePath, base64Data) =>
    ipcRenderer.invoke('save-png', savePath, base64Data),
  assembleTap: (entries, savePath) =>
    ipcRenderer.invoke('assemble-tap', entries, savePath),
  onMenuOpenFolder: (callback) => ipcRenderer.on('menu-open-folder', callback),
  onMenuSaveTapAs: (callback) => ipcRenderer.on('menu-save-tap-as', callback),
  onMenuOpenAssembler: (callback) => ipcRenderer.on('menu-open-assembler', callback),
});
