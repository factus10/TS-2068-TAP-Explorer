/**
 * Content viewer - renders the right panel based on selected item type.
 * Supports inline editing of BASIC programs and saving to new TAP files.
 */

import { ScreenRenderer } from './screen-renderer.js';
import { HexViewer } from './hex-viewer.js';

export class ContentViewer {
  constructor(container) {
    this.container = container;
    this.currentFilePath = null;
    this.currentBlockIndex = null;

    // Edit state: tracks modifications across all open TAP files
    // Structure: { [filePath]: { [dataBlockIndex]: { lines, autostart, name, dirty } } }
    this.editedBlocks = {};

    // Callbacks for notifying tree view of dirty state
    this.onDirtyChange = null;
  }

  hasEdits(filePath) {
    const fileEdits = this.editedBlocks[filePath];
    if (!fileEdits) return false;
    return Object.values(fileEdits).some(b => b.dirty);
  }

  getEditsForFile(filePath) {
    const fileEdits = this.editedBlocks[filePath];
    if (!fileEdits) return {};
    const result = {};
    for (const [idx, edit] of Object.entries(fileEdits)) {
      if (edit.dirty) {
        result[idx] = { lines: edit.lines, autostart: edit.autostart, name: edit.name, editedLineNumbers: edit.editedLineNumbers };
      }
    }
    return result;
  }

  countEdits(filePath) {
    const fileEdits = this.editedBlocks[filePath];
    if (!fileEdits) return 0;
    let count = 0;
    for (const edit of Object.values(fileEdits)) {
      if (edit.dirty) {
        for (let i = 0; i < edit.lines.length; i++) {
          // We don't have originalData here, so just count dirty blocks
          count++;
        }
        // Actually, count changed lines properly - return block count for now
        return Object.values(fileEdits).filter(b => b.dirty).length;
      }
    }
    return count;
  }

  clear() {
    this.container.innerHTML = '';
  }

  showLoading() {
    this.clear();
    this.container.innerHTML = '<div class="loading">Loading...</div>';
  }

  showError(message) {
    this.clear();
    this.container.innerHTML = `<div class="error-message">${this.escapeHtml(message)}</div>`;
  }

  showDirectoryInfo(path, entries) {
    this.clear();
    const parts = path.split('/');
    const name = parts[parts.length - 1] || path;

    let html = `
      <div class="content-header">
        <h2>\uD83D\uDCC1 ${this.escapeHtml(name)}</h2>
        <div class="subtitle">${this.escapeHtml(path)}</div>
      </div>
    `;

    if (entries.error) {
      html += `<div class="error-message">${this.escapeHtml(entries.error)}</div>`;
    } else {
      const dirs = entries.filter(e => e.type === 'directory');
      const files = entries.filter(e => e.type === 'file');
      html += `<div class="viewer-file-info">
        <div class="info-grid">
          <span class="label">Directories:</span>
          <span class="value">${dirs.length}</span>
          <span class="label">TAP files:</span>
          <span class="value">${files.length}</span>
        </div>
      </div>`;
    }

    this.container.innerHTML = html;
  }

  showFileInfo(filePath, blocks) {
    this.clear();
    const name = filePath.split('/').pop();

    if (blocks.error) {
      this.showError(blocks.error);
      return;
    }

    let html = `
      <div class="content-header">
        <h2>\uD83D\uDCFC ${this.escapeHtml(name)}</h2>
        <div class="subtitle">${this.escapeHtml(filePath)}</div>
      </div>
      <div class="viewer-file-info">
        <div class="info-grid">
          <span class="label">Blocks:</span>
          <span class="value">${blocks.length}</span>
        </div>
    `;

    if (this.hasEdits(filePath)) {
      html += `<div class="edit-actions" id="file-edit-actions"></div>`;
    }

    html += `
        <div class="blocks-summary">
          <h3>Block Summary</h3>
          <table><thead><tr>
            <th>#</th><th>Type</th><th>Details</th><th>Size</th><th>Checksum</th>
          </tr></thead><tbody>
    `;

    for (const block of blocks) {
      const isEdited = this.editedBlocks[filePath]?.[block.index]?.dirty;
      const editMark = isEdited ? ' <span class="edit-badge">edited</span>' : '';

      if (block.isHeader) {
        html += `<tr>
          <td>${block.index}</td><td>Header</td>
          <td>${this.escapeHtml(block.typeName)}: "${this.escapeHtml(block.name)}"${editMark}</td>
          <td>${block.dataLength} bytes</td>
          <td>${block.checksumValid ? '\u2705' : '\u274C'}</td>
        </tr>`;
      } else {
        const size = block.contentLength || (block.rawLength - 2);
        html += `<tr>
          <td>${block.index}</td><td>Data</td>
          <td>Data block${editMark}</td>
          <td>${size} bytes</td>
          <td>${block.checksumValid ? '\u2705' : '\u274C'}</td>
        </tr>`;
      }
    }

    html += '</tbody></table></div></div>';
    this.container.innerHTML = html;

    if (this.hasEdits(filePath)) {
      const actions = document.getElementById('file-edit-actions');
      if (actions) this.renderSaveButton(actions, filePath);
    }
  }

  async showBlock(filePath, blockIndex, offset = 0) {
    this.currentFilePath = filePath;
    this.currentBlockIndex = blockIndex;
    this.showLoading();

    try {
      const result = await window.api.getTapBlockContent(filePath, blockIndex, offset, 512);

      if (result.error) {
        this.showError(result.error);
        return;
      }

      this.clear();

      switch (result.contentType) {
        case 'header':
          this.renderHeader(result.data);
          break;
        case 'basic':
          this.renderBasicListing(result.data, filePath, blockIndex);
          break;
        case 'screen':
          this.renderScreen(result.data);
          break;
        case 'hexdump':
          this.renderHexDump(result.data, result.label);
          break;
        case 'array':
          this.renderArray(result.data);
          break;
        case 'state-capture':
          this.renderStateCapture(result.data, result.label, filePath, blockIndex);
          break;
        default:
          this.showError(`Unknown content type: ${result.contentType}`);
      }
    } catch (err) {
      this.showError(err.message);
    }
  }

  renderHeader(data) {
    this.container.innerHTML = `
      <div class="content-header">
        <h2>\uD83D\uDCCB Header: "${this.escapeHtml(data.name)}"</h2>
        <div class="subtitle">${this.escapeHtml(data.typeName)}</div>
      </div>
      <div class="viewer-header">
        <span class="label">Type:</span>
        <span class="value">${data.type} (${this.escapeHtml(data.typeName)})</span>
        <span class="label">Filename:</span>
        <span class="value">${this.escapeHtml(data.name)}</span>
        <span class="label">Data length:</span>
        <span class="value">${data.dataLength} bytes</span>
        <span class="label">Parameter 1:</span>
        <span class="value">${data.param1} &mdash; ${this.escapeHtml(data.param1Label)}</span>
        <span class="label">Parameter 2:</span>
        <span class="value">${data.param2} &mdash; ${this.escapeHtml(data.param2Label)}</span>
        <span class="label">Checksum:</span>
        <span class="value ${data.checksumValid ? 'ok' : 'error'}">${data.checksumValid ? 'Valid \u2705' : 'Invalid \u274C'}</span>
      </div>
    `;
  }

  /**
   * Render an editable BASIC listing.
   * Double-click a line to edit it. Enter to confirm, Escape to cancel.
   * All edits are batched - nothing is saved until the user clicks "Save TAP As...".
   */
  renderBasicListing(data, filePath, blockIndex) {
    // IMPORTANT: clear first to prevent duplication on re-render after edits
    this.clear();

    const existingEdit = this.editedBlocks[filePath]?.[blockIndex];
    // IMPORTANT: always copy lines so edits don't mutate the original data
    const lines = existingEdit?.dirty
      ? existingEdit.lines.map(l => ({ ...l }))
      : data.lines.map(l => ({ lineNumber: l.lineNumber, text: l.text, tokens: l.tokens }));
    const autostart = existingEdit?.dirty ? existingEdit.autostart : data.autostart;
    const name = existingEdit?.dirty ? existingEdit.name : data.name;
    const hasEditsForFile = this.hasEdits(filePath);
    const blockDirty = existingEdit?.dirty;

    // Count modified lines
    let modifiedCount = 0;
    if (blockDirty) {
      for (let i = 0; i < lines.length; i++) {
        const orig = data.lines.find(l => l.lineNumber === lines[i].lineNumber);
        if (orig && orig.text !== lines[i].text) modifiedCount++;
      }
    }

    // Header
    const header = document.createElement('div');
    header.className = 'content-header';
    header.innerHTML = `
      <h2>\uD83D\uDCDD BASIC Program: "${this.escapeHtml(name)}"
        ${blockDirty ? '<span class="edit-badge">' + modifiedCount + ' line' + (modifiedCount !== 1 ? 's' : '') + ' edited</span>' : ''}
      </h2>
      <div class="subtitle">
        ${lines.length} lines${autostart != null ? ` \u2022 Autostart at line ${autostart}` : ''}
        \u2022 <em>Double-click a line to edit</em>
      </div>
    `;
    this.container.appendChild(header);

    // Edit banner with save button (only when there are edits)
    if (hasEditsForFile) {
      const banner = document.createElement('div');
      banner.className = 'edit-banner';
      banner.innerHTML = `
        <span class="edit-banner-text">
          \u270F\uFE0F ${modifiedCount} line${modifiedCount !== 1 ? 's' : ''} modified.
          Edit as many lines as you need, then save when done.
        </span>
      `;
      this.renderSaveButton(banner, filePath);

      // Revert all button
      const revertAllBtn = document.createElement('button');
      revertAllBtn.className = 'screen-btn';
      revertAllBtn.textContent = '\u21A9 Revert all';
      revertAllBtn.addEventListener('click', () => {
        delete this.editedBlocks[filePath]?.[blockIndex];
        if (this.onDirtyChange) this.onDirtyChange(filePath, this.hasEdits(filePath));
        this.renderBasicListing(data, filePath, blockIndex);
      });
      banner.appendChild(revertAllBtn);

      this.container.appendChild(banner);
    }

    // Listing
    const listing = document.createElement('div');
    listing.className = 'viewer-basic';

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const origLine = data.lines.find(l => l.lineNumber === line.lineNumber);
      const isModified = blockDirty && origLine && origLine.text !== line.text;

      const lineEl = this.createBasicLineElement(
        line, isModified, filePath, blockIndex, idx, lines, autostart, name, data
      );
      listing.appendChild(lineEl);
    }

    this.container.appendChild(listing);
  }

  /**
   * Check if a BASIC line contains DOS-specific commands (Oliger, Larken, AERCO).
   */
  hasDosCommands(text) {
    // OUT 244,1 — switches in the Oliger cartridge ROM
    if (/\bOUT\s+244\s*,/i.test(text)) return true;
    // LOAD /, SAVE /, MERGE /, VERIFY / — Oliger RST 8 trap prefix
    if (/\b(LOAD|SAVE|MERGE|VERIFY)\s+\//i.test(text)) return true;
    // MOVE command (Oliger disk file operations)
    if (/\bMOVE\s+"/i.test(text)) return true;
    // CAT with disk syntax
    if (/\bCAT\s+"/i.test(text)) return true;
    // ERASE
    if (/\bERASE\s+"/i.test(text)) return true;
    return false;
  }

  createBasicLineElement(line, isModified, filePath, blockIndex, lineIdx, allLines, autostart, progName, originalData) {
    const hasDos = this.hasDosCommands(line.text);
    const lineEl = document.createElement('div');
    lineEl.className = 'basic-line' + (isModified ? ' modified' : '') + (hasDos ? ' dos-command' : '');

    const numEl = document.createElement('span');
    numEl.className = 'line-number';
    numEl.textContent = line.lineNumber;

    const contentEl = document.createElement('span');
    contentEl.className = 'line-content';

    if (line.tokens && !isModified) {
      for (const token of line.tokens) {
        const span = document.createElement('span');
        span.className = `token-${token.type}`;
        span.textContent = token.text;
        contentEl.appendChild(span);
      }
    } else {
      contentEl.textContent = line.text;
      if (isModified) contentEl.classList.add('edited-text');
    }

    if (isModified) {
      const revertBtn = document.createElement('button');
      revertBtn.className = 'line-revert-btn';
      revertBtn.textContent = '\u21A9';
      revertBtn.title = 'Revert this line';
      revertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const origLine = originalData.lines.find(l => l.lineNumber === line.lineNumber);
        if (origLine) {
          allLines[lineIdx] = { ...origLine };
          this.updateEditState(filePath, blockIndex, allLines, autostart, progName, originalData);
          this.renderBasicListing(originalData, filePath, blockIndex);
        }
      });
      lineEl.appendChild(revertBtn);
    }

    lineEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.enterEditMode(lineEl, line, lineIdx, allLines, filePath, blockIndex, autostart, progName, originalData);
    });

    lineEl.appendChild(numEl);
    lineEl.appendChild(contentEl);
    return lineEl;
  }

  enterEditMode(lineEl, line, lineIdx, allLines, filePath, blockIndex, autostart, progName, originalData) {
    if (lineEl.querySelector('.line-edit-input')) return;

    lineEl.classList.add('editing');
    const contentEl = lineEl.querySelector('.line-content');
    const originalHtml = contentEl.innerHTML;
    const currentText = line.text;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'line-edit-input';
    input.value = currentText;
    input.spellcheck = false;

    contentEl.innerHTML = '';
    contentEl.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = () => {
      if (committed) return;
      committed = true;
      const newText = input.value;
      lineEl.classList.remove('editing');

      if (newText !== currentText) {
        allLines[lineIdx] = { lineNumber: line.lineNumber, text: newText };
        this.updateEditState(filePath, blockIndex, allLines, autostart, progName, originalData);
      }

      // Re-render (clear + rebuild) to show updated state
      this.renderBasicListing(originalData, filePath, blockIndex);
    };

    const cancel = () => {
      if (committed) return;
      committed = true;
      lineEl.classList.remove('editing');
      contentEl.innerHTML = originalHtml;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!committed) commit();
      }, 100);
    });
  }

  updateEditState(filePath, blockIndex, lines, autostart, name, originalData) {
    if (!this.editedBlocks[filePath]) {
      this.editedBlocks[filePath] = {};
    }

    // Track which specific line numbers were actually changed
    const editedLineNumbers = [];
    const isDirty = lines.some((line, idx) => {
      const orig = originalData.lines[idx];
      const changed = !orig || orig.text !== line.text || orig.lineNumber !== line.lineNumber;
      if (changed && line.lineNumber) editedLineNumbers.push(line.lineNumber);
      return changed;
    }) || lines.length !== originalData.lines.length;

    this.editedBlocks[filePath][blockIndex] = {
      lines: lines.map(l => ({ lineNumber: l.lineNumber, text: l.text })),
      autostart,
      name,
      dirty: isDirty,
      editedLineNumbers,
    };

    if (this.onDirtyChange) {
      this.onDirtyChange(filePath, this.hasEdits(filePath));
    }
  }

  renderSaveButton(container, filePath) {
    const btn = document.createElement('button');
    btn.className = 'save-tap-btn';
    btn.innerHTML = '\uD83D\uDCBE Save TAP As\u2026';
    btn.addEventListener('click', async () => {
      await this.saveTapAs(filePath);
    });
    container.appendChild(btn);
  }

  async saveTapAs(filePath) {
    const edits = this.getEditsForFile(filePath);
    if (Object.keys(edits).length === 0) return;

    const originalName = filePath.split('/').pop();
    const defaultName = originalName.replace(/\.tap$/i, '_edited.tap');
    const savePath = await window.api.showSaveDialog(defaultName);
    if (!savePath) return;

    const result = await window.api.saveTapAs(filePath, savePath, edits);

    if (result.error) {
      alert(`Error saving TAP file: ${result.error}`);
    } else {
      delete this.editedBlocks[filePath];
      if (this.onDirtyChange) this.onDirtyChange(filePath, false);
      this.showSaveSuccess(result.path, result.size);
    }
  }

  showSaveSuccess(path, size) {
    const notification = document.createElement('div');
    notification.className = 'save-notification';
    notification.innerHTML = `
      <span class="save-notification-icon">\u2705</span>
      <span>Saved to <strong>${this.escapeHtml(path.split('/').pop())}</strong> (${size} bytes)</span>
    `;
    this.container.insertBefore(notification, this.container.firstChild);
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 500);
    }, 4000);
  }

  renderScreen(data) {
    const header = document.createElement('div');
    header.className = 'content-header';
    header.innerHTML = `
      <h2>\uD83D\uDDBC SCREEN$ Display</h2>
      <div class="subtitle">256 \u00D7 192 pixels with color attributes</div>
    `;
    this.container.appendChild(header);

    const viewer = document.createElement('div');
    viewer.className = 'viewer-screen';
    this.container.appendChild(viewer);

    const renderer = new ScreenRenderer(viewer);
    renderer.render(data);
  }

  renderHexDump(data, label) {
    const header = document.createElement('div');
    header.className = 'content-header';
    const title = label || 'Hex Dump';
    header.innerHTML = `
      <h2>\uD83D\uDD22 ${this.escapeHtml(title)}</h2>
      <div class="subtitle">${data.totalBytes} bytes total \u2022 Base address: 0x${data.baseAddress.toString(16).padStart(4, '0').toUpperCase()}</div>
    `;
    this.container.appendChild(header);

    const viewer = new HexViewer(this.container, (newOffset) => {
      this.showBlock(this.currentFilePath, this.currentBlockIndex, newOffset);
    });
    viewer.render(data);
  }

  renderStateCapture(data, label, filePath, blockIndex) {
    this.clear();
    const { base64, baseAddress, totalBytes, basic } = data;

    // Store capture data so re-renders after edits can access it
    this._captureData = data;
    this._captureLabel = label;

    const header = document.createElement('div');
    header.className = 'content-header';
    header.innerHTML = `
      <h2>\uD83D\uDCBE ${this.escapeHtml(label || 'State Capture')}</h2>
      <div class="subtitle">${totalBytes.toLocaleString()} bytes \u2022 Address range: 0x${baseAddress.toString(16).padStart(4, '0').toUpperCase()} \u2013 0x${(baseAddress + totalBytes).toString(16).padStart(4, '0').toUpperCase()}</div>
    `;
    this.container.appendChild(header);

    if (basic) {
      // Use a unique key for tracking edits on extracted BASIC from state captures
      const editKey = `capture:${blockIndex}`;
      const existingEdit = this.editedBlocks[filePath]?.[editKey];
      const lines = existingEdit?.dirty
        ? existingEdit.lines
        : basic.lines.map(l => ({ lineNumber: l.lineNumber, text: l.text, tokens: l.tokens }));
      const autostart = existingEdit?.dirty ? existingEdit.autostart : basic.autostart;
      const progName = filePath.split('/').pop().replace(/\.tap$/i, '');
      const blockDirty = existingEdit?.dirty;

      // Count modified lines
      let modifiedCount = 0;
      if (blockDirty) {
        for (let i = 0; i < lines.length; i++) {
          const orig = basic.lines[i];
          if (orig && orig.text !== lines[i].text) modifiedCount++;
        }
      }

      const panel = document.createElement('div');
      panel.className = 'extraction-panel';

      const panelHeader = document.createElement('div');
      panelHeader.className = 'extraction-header';
      panelHeader.innerHTML = `
        <h3>\uD83D\uDCDD BASIC Program Found
          ${blockDirty ? '<span class="edit-badge">' + modifiedCount + ' line' + (modifiedCount !== 1 ? 's' : '') + ' edited</span>' : ''}
        </h3>
        <div class="extraction-meta">
          ${basic.lines.length} lines \u2022 ${basic.programLength} bytes \u2022
          PROG: 0x${basic.progAddress.toString(16).toUpperCase()} \u2022
          VARS: 0x${basic.varsAddress.toString(16).toUpperCase()}
          ${basic.autostart ? ` \u2022 Autostart: line ${basic.autostart}` : ''}
          \u2022 <em>Double-click a line to edit</em>
        </div>
      `;
      panel.appendChild(panelHeader);

      // Edit banner (when edits exist)
      if (blockDirty) {
        const banner = document.createElement('div');
        banner.className = 'edit-banner';
        banner.innerHTML = `
          <span class="edit-banner-text">
            \u270F\uFE0F ${modifiedCount} line${modifiedCount !== 1 ? 's' : ''} modified.
            Edit as many lines as you need, then save when done.
          </span>
        `;

        // Save edited BASIC as TAP button
        const saveBtn = document.createElement('button');
        saveBtn.className = 'save-tap-btn';
        saveBtn.innerHTML = '\uD83D\uDCBE Save BASIC as TAP\u2026';
        saveBtn.addEventListener('click', async () => {
          const defaultName = filePath.split('/').pop().replace(/\.tap$/i, '_basic.tap');
          const savePath = await window.api.showSaveDialog(defaultName);
          if (!savePath) return;
          const saveLines = lines.map(l => ({ lineNumber: l.lineNumber, text: l.text }));
          const editedNums = existingEdit?.editedLineNumbers || [];
          const result = await window.api.saveEditedBasic(
            savePath, progName, saveLines, autostart,
            basic.variablesBase64, basic.programBase64, editedNums
          );
          if (result.error) {
            alert('Error: ' + result.error);
          } else {
            delete this.editedBlocks[filePath]?.[editKey];
            if (this.onDirtyChange) this.onDirtyChange(filePath, this.hasEdits(filePath));
            this.showSaveSuccess(result.path, result.size);
          }
        });
        banner.appendChild(saveBtn);

        // Revert all
        const revertBtn = document.createElement('button');
        revertBtn.className = 'screen-btn';
        revertBtn.textContent = '\u21A9 Revert all';
        revertBtn.addEventListener('click', () => {
          delete this.editedBlocks[filePath]?.[editKey];
          if (this.onDirtyChange) this.onDirtyChange(filePath, this.hasEdits(filePath));
          this.renderStateCapture(data, label, filePath, blockIndex);
        });
        banner.appendChild(revertBtn);

        panel.appendChild(banner);
      } else {
        // Save unedited BASIC as TAP button
        const saveBtn = document.createElement('button');
        saveBtn.className = 'save-tap-btn';
        saveBtn.innerHTML = '\uD83D\uDCBE Save BASIC as TAP\u2026';
        saveBtn.addEventListener('click', async () => {
          const defaultName = filePath.split('/').pop().replace(/\.tap$/i, '_basic.tap');
          const savePath = await window.api.showSaveDialog(defaultName);
          if (!savePath) return;
          const result = await window.api.saveBasicFromCapture(filePath, blockIndex, savePath);
          if (result.error) {
            alert('Error: ' + result.error);
          } else {
            this.showSaveSuccess(result.path, result.size);
          }
        });
        panelHeader.appendChild(saveBtn);
      }

      // Editable BASIC listing
      const listing = document.createElement('div');
      listing.className = 'viewer-basic';

      // Build originalData-like object for the editing infrastructure
      const originalData = {
        lines: basic.lines,
        autostart: basic.autostart,
        name: progName,
      };

      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const origLine = basic.lines.find(l => l.lineNumber === line.lineNumber);
        const isModified = blockDirty && origLine && origLine.text !== line.text;

        const hasDos = this.hasDosCommands(line.text);
        const lineEl = document.createElement('div');
        lineEl.className = 'basic-line' + (isModified ? ' modified' : '') + (hasDos ? ' dos-command' : '');

        const numEl = document.createElement('span');
        numEl.className = 'line-number';
        numEl.textContent = line.lineNumber;

        const contentEl = document.createElement('span');
        contentEl.className = 'line-content';
        if (line.tokens && !isModified) {
          for (const token of line.tokens) {
            const span = document.createElement('span');
            span.className = `token-${token.type}`;
            span.textContent = token.text;
            contentEl.appendChild(span);
          }
        } else {
          contentEl.textContent = line.text;
          if (isModified) contentEl.classList.add('edited-text');
        }

        if (isModified) {
          const revertBtn = document.createElement('button');
          revertBtn.className = 'line-revert-btn';
          revertBtn.textContent = '\u21A9';
          revertBtn.title = 'Revert this line';
          revertBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (origLine) {
              lines[idx] = { ...origLine };
              this.updateCaptureEditState(filePath, editKey, lines, autostart, progName, originalData);
              this.renderStateCapture(data, label, filePath, blockIndex);
            }
          });
          lineEl.appendChild(revertBtn);
        }

        // Double-click to edit
        lineEl.addEventListener('dblclick', (e) => {
          e.preventDefault();
          this.enterCaptureEditMode(lineEl, line, idx, lines, filePath, editKey, autostart, progName, originalData, data, label, blockIndex);
        });

        lineEl.appendChild(numEl);
        lineEl.appendChild(contentEl);
        listing.appendChild(lineEl);
      }

      panel.appendChild(listing);
      this.container.appendChild(panel);
    }

    const hexHeader = document.createElement('div');
    hexHeader.className = 'content-subheader';
    hexHeader.innerHTML = '<h3>\uD83D\uDD22 Memory Dump</h3>';
    this.container.appendChild(hexHeader);

    const viewer = new HexViewer(this.container, null);
    viewer.renderScrollable(base64, baseAddress, totalBytes);
  }

  /**
   * Enter edit mode for a line in the state capture extracted BASIC.
   */
  enterCaptureEditMode(lineEl, line, lineIdx, allLines, filePath, editKey, autostart, progName, originalData, captureData, captureLabel, blockIndex) {
    if (lineEl.querySelector('.line-edit-input')) return;

    lineEl.classList.add('editing');
    const contentEl = lineEl.querySelector('.line-content');
    const currentText = line.text;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'line-edit-input';
    input.value = currentText;
    input.spellcheck = false;

    contentEl.innerHTML = '';
    contentEl.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = () => {
      if (committed) return;
      committed = true;
      const newText = input.value;

      if (newText !== currentText) {
        allLines[lineIdx] = { lineNumber: line.lineNumber, text: newText };
        this.updateCaptureEditState(filePath, editKey, allLines, autostart, progName, originalData);
      }

      this.renderStateCapture(captureData, captureLabel, filePath, blockIndex);
    };

    const cancel = () => {
      if (committed) return;
      committed = true;
      lineEl.classList.remove('editing');
      contentEl.innerHTML = '';
      contentEl.textContent = currentText;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { if (!committed) commit(); }, 100);
    });
  }

  updateCaptureEditState(filePath, editKey, lines, autostart, name, originalData) {
    if (!this.editedBlocks[filePath]) {
      this.editedBlocks[filePath] = {};
    }

    const editedLineNumbers = [];
    const isDirty = lines.some((line, idx) => {
      const orig = originalData.lines[idx];
      const changed = !orig || orig.text !== line.text;
      if (changed && line.lineNumber) editedLineNumbers.push(line.lineNumber);
      return changed;
    });

    this.editedBlocks[filePath][editKey] = {
      lines: lines.map(l => ({ lineNumber: l.lineNumber, text: l.text })),
      autostart,
      name,
      dirty: isDirty,
      editedLineNumbers,
    };

    if (this.onDirtyChange) {
      this.onDirtyChange(filePath, this.hasEdits(filePath));
    }
  }

  renderArray(data) {
    let html = `
      <div class="content-header">
        <h2>\uD83D\uDCCA ${data.arrayType === 'number' ? 'Number' : 'Character'} Array</h2>
        <div class="subtitle">${this.escapeHtml(data.variableName)}</div>
      </div>
      <div class="viewer-array">
    `;
    if (data.dimensions) {
      html += `<div class="array-info">Dimensions: ${data.dimensions.join(' \u00D7 ')} (${data.totalElements} elements)</div>`;
    }
    if (data.error) {
      html += `<div class="error-message">${this.escapeHtml(data.error)}</div>`;
    }
    if (data.values && data.values.length > 0) {
      html += '<table><thead><tr><th>Index</th><th>Value</th></tr></thead><tbody>';
      for (let i = 0; i < Math.min(data.values.length, 500); i++) {
        const val = data.arrayType === 'number'
          ? (typeof data.values[i] === 'number' ? data.values[i].toString() : data.values[i])
          : `"${this.escapeHtml(String(data.values[i]))}"`;
        html += `<tr><td>${i}</td><td>${val}</td></tr>`;
      }
      if (data.values.length > 500) {
        html += `<tr><td colspan="2" style="color:var(--text-muted)">... ${data.values.length - 500} more values</td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</div>';
    this.container.innerHTML = html;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
