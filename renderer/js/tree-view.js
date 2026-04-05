/**
 * Tree view component for file system navigation and TAP block expansion.
 */

export class TreeView {
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.selectedNode = null;
    this.rootPath = '';
    // Map of filePath -> node element for showing dirty indicators
    this.tapFileNodes = new Map();
  }

  /**
   * Update dirty indicator on a TAP file's tree node.
   */
  setFileDirty(filePath, isDirty) {
    const node = this.tapFileNodes.get(filePath);
    if (node) {
      const badge = node.querySelector('.dirty-badge');
      if (isDirty && !badge) {
        const b = document.createElement('span');
        b.className = 'dirty-badge';
        b.textContent = '\u2022';
        b.title = 'Unsaved edits';
        node.appendChild(b);
      } else if (!isDirty && badge) {
        badge.remove();
      }
    }
  }

  async setRoot(path) {
    this.rootPath = path;
    this.container.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'tree-list';
    this.container.appendChild(ul);
    await this.loadDirectoryInto(ul, path);
  }

  async loadDirectoryInto(parentUl, dirPath) {
    const items = await window.api.listFiles(dirPath);

    if (items.error) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="tree-node error-message" style="font-size:11px">${items.error}</span>`;
      parentUl.appendChild(li);
      return;
    }

    if (items.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="tree-node" style="color:var(--text-muted);font-size:12px">(empty)</span>`;
      parentUl.appendChild(li);
      return;
    }

    for (const item of items) {
      const li = document.createElement('li');
      const node = this.createNode(item);
      li.appendChild(node);
      parentUl.appendChild(li);
    }
  }

  createNode(item) {
    const node = document.createElement('div');
    node.className = 'tree-node';

    if (item.type === 'directory') {
      node.dataset.type = 'directory';
      node.innerHTML = `
        <span class="expand-arrow">\u25B6</span>
        <span class="node-icon">\uD83D\uDCC1</span>
        <span class="node-label">${this.escapeHtml(item.name)}</span>
      `;

      const arrow = node.querySelector('.expand-arrow');
      let childUl = null;
      let expanded = false;

      node.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.selectNode(node);

        if (expanded) {
          // Collapse
          if (childUl) childUl.style.display = 'none';
          arrow.classList.remove('expanded');
          expanded = false;
        } else {
          // Expand
          arrow.classList.add('expanded');
          if (!childUl) {
            childUl = document.createElement('ul');
            childUl.className = 'tree-list';
            node.parentElement.appendChild(childUl);
            await this.loadDirectoryInto(childUl, item.path);
          } else {
            childUl.style.display = '';
          }
          expanded = true;
        }

        const entries = await window.api.listFiles(item.path);
        this.callbacks.onSelectDirectory(item.path, entries);
      });

    } else if (item.type === 'file') {
      node.dataset.type = 'tap-file';
      const sizeStr = this.formatSize(item.size);
      node.innerHTML = `
        <span class="expand-arrow">\u25B6</span>
        <span class="node-icon">\uD83D\uDCFC</span>
        <span class="node-label">${this.escapeHtml(item.name)}</span>
        <span class="node-meta">${sizeStr}</span>
      `;

      // Register for dirty tracking
      this.tapFileNodes.set(item.path, node);

      const arrow = node.querySelector('.expand-arrow');
      let childUl = null;
      let expanded = false;

      node.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.selectNode(node);

        if (expanded) {
          if (childUl) childUl.style.display = 'none';
          arrow.classList.remove('expanded');
          expanded = false;
        } else {
          arrow.classList.add('expanded');
          if (!childUl) {
            childUl = document.createElement('ul');
            childUl.className = 'tree-list';
            node.parentElement.appendChild(childUl);
            await this.loadBlocksInto(childUl, item.path);
          } else {
            childUl.style.display = '';
          }
          expanded = true;
        }

        const blocks = await window.api.getTapBlocks(item.path);
        this.callbacks.onSelectTapFile(item.path, blocks);
      });
    }

    return node;
  }

  async loadBlocksInto(parentUl, filePath) {
    const blocks = await window.api.getTapBlocks(filePath);

    if (blocks.error) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="tree-node error-message" style="font-size:11px">${blocks.error}</span>`;
      parentUl.appendChild(li);
      return;
    }

    for (const block of blocks) {
      const li = document.createElement('li');
      const node = this.createBlockNode(filePath, block);
      li.appendChild(node);
      parentUl.appendChild(li);
    }
  }

  createBlockNode(filePath, block) {
    const node = document.createElement('div');
    node.className = 'tree-node';

    if (block.isHeader) {
      node.dataset.type = 'header';
      const icon = '\u{1F4CB}'; // clipboard
      const label = `${block.typeName}: "${block.name}"`;
      const meta = `${block.dataLength} bytes`;
      node.innerHTML = `
        <span class="expand-arrow hidden"></span>
        <span class="node-icon">${icon}</span>
        <span class="node-label">${this.escapeHtml(label)}</span>
        <span class="node-meta">${meta}</span>
      `;
    } else {
      node.dataset.type = 'data';
      const icon = '\u{1F4BE}'; // floppy
      const contentLen = block.contentLength || (block.rawLength - 2);
      const label = `Data block`;
      const meta = `${contentLen} bytes`;
      const checksumIcon = block.checksumValid ? '' : ' \u26A0\uFE0F';
      node.innerHTML = `
        <span class="expand-arrow hidden"></span>
        <span class="node-icon">${icon}</span>
        <span class="node-label">${this.escapeHtml(label)}${checksumIcon}</span>
        <span class="node-meta">${meta}</span>
      `;
    }

    node.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectNode(node);
      this.callbacks.onSelectBlock(filePath, block.index);
    });

    return node;
  }

  selectNode(node) {
    if (this.selectedNode) {
      this.selectedNode.classList.remove('selected');
    }
    node.classList.add('selected');
    this.selectedNode = node;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
