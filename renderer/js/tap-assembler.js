/**
 * TAP Assembler - combine blocks from multiple TAP files into a single TAP.
 *
 * Users add header+data pairs from TAP files in the current folder,
 * reorder them with drag-and-drop or up/down buttons, then save.
 */

export class TapAssembler {
  constructor(container) {
    this.container = container;
    this.entries = []; // { id, filePath, fileName, blockIndices, label, typeName, size }
    this.nextId = 1;
    this.currentFolder = null;
    this.availableFiles = []; // TAP files in the current folder
  }

  async open(folderPath) {
    this.currentFolder = folderPath;
    this.entries = [];
    this.nextId = 1;

    // Load TAP files in the folder
    const items = await window.api.listFiles(folderPath);
    this.availableFiles = (items.error ? [] : items).filter(i => i.type === 'file');

    this.render();
  }

  render() {
    this.container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'content-header';
    header.innerHTML = `
      <h2>\uD83D\uDDC3 TAP Assembler</h2>
      <div class="subtitle">
        Build a new TAP file by adding blocks from TAP files in:
        <strong>${this.escapeHtml(this.currentFolder)}</strong>
      </div>
    `;
    this.container.appendChild(header);

    // Add-block area
    const addArea = document.createElement('div');
    addArea.className = 'assembler-add-area';

    const fileSelect = document.createElement('select');
    fileSelect.className = 'assembler-select';
    fileSelect.innerHTML = '<option value="">-- select a TAP file --</option>';
    for (const f of this.availableFiles) {
      const opt = document.createElement('option');
      opt.value = f.path;
      opt.textContent = f.name;
      fileSelect.appendChild(opt);
    }

    const blockSelect = document.createElement('select');
    blockSelect.className = 'assembler-select';
    blockSelect.disabled = true;
    blockSelect.innerHTML = '<option value="">-- select file first --</option>';

    const addBtn = document.createElement('button');
    addBtn.className = 'save-tap-btn';
    addBtn.textContent = '+ Add';
    addBtn.disabled = true;

    // When file is selected, load its blocks
    fileSelect.addEventListener('change', async () => {
      const filePath = fileSelect.value;
      blockSelect.innerHTML = '';
      blockSelect.disabled = true;
      addBtn.disabled = true;

      if (!filePath) {
        blockSelect.innerHTML = '<option value="">-- select file first --</option>';
        return;
      }

      const blocks = await window.api.getTapBlocks(filePath);
      if (blocks.error) {
        blockSelect.innerHTML = `<option value="">${blocks.error}</option>`;
        return;
      }

      blockSelect.innerHTML = '<option value="">-- select block(s) --</option>';

      // Offer header+data pairs and standalone blocks
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.isHeader && i + 1 < blocks.length && !blocks[i + 1].isHeader) {
          // Header + data pair
          const dataBlock = blocks[i + 1];
          const dataSize = dataBlock.contentLength || (dataBlock.rawLength - 2);
          const opt = document.createElement('option');
          opt.value = JSON.stringify({ indices: [i, i + 1], label: `${b.typeName}: "${b.name}"`, typeName: b.typeName, size: dataSize });
          opt.textContent = `${b.typeName}: "${b.name}" (${dataSize} bytes)`;
          blockSelect.appendChild(opt);
          i++; // skip the data block
        } else if (b.isHeader) {
          const opt = document.createElement('option');
          opt.value = JSON.stringify({ indices: [i], label: `Header: "${b.name}"`, typeName: 'Header', size: 17 });
          opt.textContent = `Header only: "${b.name}"`;
          blockSelect.appendChild(opt);
        } else {
          const dataSize = b.contentLength || (b.rawLength - 2);
          const opt = document.createElement('option');
          opt.value = JSON.stringify({ indices: [i], label: `Data block #${i}`, typeName: 'Data', size: dataSize });
          opt.textContent = `Data block #${i} (${dataSize} bytes)`;
          blockSelect.appendChild(opt);
        }
      }

      // "All blocks" option
      if (blocks.length > 0) {
        const allIndices = blocks.map((_, idx) => idx);
        const totalSize = blocks.reduce((s, b) => s + (b.isHeader ? 17 : (b.contentLength || b.rawLength - 2)), 0);
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ indices: allIndices, label: `All ${blocks.length} blocks`, typeName: 'All', size: totalSize });
        opt.textContent = `\u2B50 All blocks (${blocks.length} blocks, ${totalSize} bytes)`;
        blockSelect.appendChild(opt);
      }

      blockSelect.disabled = false;
    });

    blockSelect.addEventListener('change', () => {
      addBtn.disabled = !blockSelect.value;
    });

    addBtn.addEventListener('click', () => {
      if (!fileSelect.value || !blockSelect.value) return;
      const info = JSON.parse(blockSelect.value);
      this.entries.push({
        id: this.nextId++,
        filePath: fileSelect.value,
        fileName: fileSelect.options[fileSelect.selectedIndex].textContent,
        blockIndices: info.indices,
        label: info.label,
        typeName: info.typeName,
        size: info.size,
      });
      this.renderEntryList();
    });

    addArea.appendChild(fileSelect);
    addArea.appendChild(blockSelect);
    addArea.appendChild(addBtn);
    this.container.appendChild(addArea);

    // Entry list
    const listContainer = document.createElement('div');
    listContainer.id = 'assembler-entries';
    this.container.appendChild(listContainer);
    this.renderEntryList();

    // Save button area
    const saveArea = document.createElement('div');
    saveArea.id = 'assembler-save-area';
    saveArea.className = 'edit-actions';
    this.container.appendChild(saveArea);
    this.renderSaveArea();
  }

  renderEntryList() {
    const listContainer = document.getElementById('assembler-entries');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    if (this.entries.length === 0) {
      listContainer.innerHTML = '<div class="assembler-empty">No blocks added yet. Select a TAP file and block above, then click Add.</div>';
      this.renderSaveArea();
      return;
    }

    const table = document.createElement('table');
    table.className = 'assembler-table';
    table.innerHTML = `<thead><tr>
      <th>#</th><th>Source File</th><th>Block</th><th>Type</th><th>Size</th><th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td class="assembler-order">${i + 1}</td>
        <td>${this.escapeHtml(entry.fileName)}</td>
        <td>${this.escapeHtml(entry.label)}</td>
        <td>${this.escapeHtml(entry.typeName)}</td>
        <td>${entry.size.toLocaleString()} bytes</td>
      `;

      // Action buttons
      const actionTd = document.createElement('td');
      actionTd.className = 'assembler-actions';

      if (i > 0) {
        const upBtn = document.createElement('button');
        upBtn.className = 'assembler-btn';
        upBtn.textContent = '\u25B2';
        upBtn.title = 'Move up';
        upBtn.addEventListener('click', () => {
          [this.entries[i - 1], this.entries[i]] = [this.entries[i], this.entries[i - 1]];
          this.renderEntryList();
        });
        actionTd.appendChild(upBtn);
      }

      if (i < this.entries.length - 1) {
        const downBtn = document.createElement('button');
        downBtn.className = 'assembler-btn';
        downBtn.textContent = '\u25BC';
        downBtn.title = 'Move down';
        downBtn.addEventListener('click', () => {
          [this.entries[i], this.entries[i + 1]] = [this.entries[i + 1], this.entries[i]];
          this.renderEntryList();
        });
        actionTd.appendChild(downBtn);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'assembler-btn assembler-btn-remove';
      removeBtn.textContent = '\u2715';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        this.entries.splice(i, 1);
        this.renderEntryList();
      });
      actionTd.appendChild(removeBtn);

      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    listContainer.appendChild(table);
    this.renderSaveArea();
  }

  renderSaveArea() {
    const saveArea = document.getElementById('assembler-save-area');
    if (!saveArea) return;
    saveArea.innerHTML = '';

    if (this.entries.length === 0) return;

    const totalSize = this.entries.reduce((s, e) => s + e.size, 0);
    const info = document.createElement('span');
    info.className = 'assembler-info';
    info.textContent = `${this.entries.length} block group${this.entries.length !== 1 ? 's' : ''}, ~${totalSize.toLocaleString()} bytes`;
    saveArea.appendChild(info);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-tap-btn';
    saveBtn.innerHTML = '\uD83D\uDCBE Save Combined TAP\u2026';
    saveBtn.addEventListener('click', async () => {
      const defaultName = 'combined.tap';
      const savePath = await window.api.showSaveDialog(defaultName);
      if (!savePath) return;

      const assembleEntries = this.entries.map(e => ({
        filePath: e.filePath,
        blockIndices: e.blockIndices,
      }));

      const result = await window.api.assembleTap(assembleEntries, savePath);
      if (result.error) {
        alert('Error: ' + result.error);
      } else {
        // Show success
        const notification = document.createElement('div');
        notification.className = 'save-notification';
        notification.innerHTML = `
          <span class="save-notification-icon">\u2705</span>
          <span>Saved to <strong>${this.escapeHtml(savePath.split('/').pop())}</strong> (${result.size.toLocaleString()} bytes)</span>
        `;
        this.container.insertBefore(notification, this.container.firstChild);
        setTimeout(() => {
          notification.classList.add('fade-out');
          setTimeout(() => notification.remove(), 500);
        }, 4000);
      }
    });
    saveArea.appendChild(saveBtn);
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
