/**
 * Hex dump viewer component.
 * Supports two modes:
 *   - Paginated (original): server sends pre-formatted pages
 *   - Scrollable (new): client receives full base64 data, renders with virtual scrolling
 */

export class HexViewer {
  constructor(container, onNavigate) {
    this.container = container;
    this.onNavigate = onNavigate;
  }

  /**
   * Render paginated hex dump (original mode for CODE blocks etc.)
   */
  render(data) {
    const { lines, totalBytes, offset, limit, baseAddress } = data;

    const viewer = document.createElement('div');
    viewer.className = 'viewer-hex';

    for (const line of lines) {
      viewer.appendChild(this.createLineElement(line));
    }

    this.container.appendChild(viewer);

    // Pagination
    if (totalBytes > limit) {
      const totalPages = Math.ceil(totalBytes / limit);
      const currentPage = Math.floor(offset / limit) + 1;

      const pag = document.createElement('div');
      pag.className = 'hex-pagination';

      const prevBtn = document.createElement('button');
      prevBtn.textContent = '\u25C0 Previous';
      prevBtn.disabled = offset === 0;
      prevBtn.addEventListener('click', () => {
        this.onNavigate(Math.max(0, offset - limit));
      });

      const pageInfo = document.createElement('span');
      pageInfo.className = 'page-info';
      pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

      const nextBtn = document.createElement('button');
      nextBtn.textContent = 'Next \u25B6';
      nextBtn.disabled = offset + limit >= totalBytes;
      nextBtn.addEventListener('click', () => {
        this.onNavigate(offset + limit);
      });

      const gotoGroup = document.createElement('div');
      gotoGroup.className = 'goto-group';

      const gotoLabel = document.createElement('label');
      gotoLabel.textContent = 'Go to:';

      const gotoInput = document.createElement('input');
      gotoInput.type = 'text';
      gotoInput.placeholder = '0x0000';
      gotoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          let addr = gotoInput.value.trim();
          let byteOffset;
          if (addr.startsWith('0x') || addr.startsWith('0X')) {
            byteOffset = parseInt(addr, 16) - baseAddress;
          } else {
            byteOffset = parseInt(addr, 10) - baseAddress;
          }
          if (!isNaN(byteOffset) && byteOffset >= 0 && byteOffset < totalBytes) {
            const pageStart = Math.floor(byteOffset / limit) * limit;
            this.onNavigate(pageStart);
          }
        }
      });

      gotoGroup.appendChild(gotoLabel);
      gotoGroup.appendChild(gotoInput);

      pag.appendChild(prevBtn);
      pag.appendChild(pageInfo);
      pag.appendChild(nextBtn);
      pag.appendChild(gotoGroup);

      this.container.appendChild(pag);
    }
  }

  /**
   * Render a scrollable hex dump from raw base64 data.
   * Uses virtual scrolling: only renders visible rows.
   */
  renderScrollable(base64Data, baseAddress, totalBytes) {
    // Decode base64 to Uint8Array
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const ROW_HEIGHT = 20; // px per row
    const BYTES_PER_ROW = 16;
    const totalRows = Math.ceil(bytes.length / BYTES_PER_ROW);
    const totalHeight = totalRows * ROW_HEIGHT;

    // Go-to-address bar
    const toolbar = document.createElement('div');
    toolbar.className = 'hex-toolbar';

    const gotoLabel = document.createElement('label');
    gotoLabel.textContent = 'Go to address:';
    const gotoInput = document.createElement('input');
    gotoInput.type = 'text';
    gotoInput.placeholder = '0x' + baseAddress.toString(16).toUpperCase();
    gotoInput.className = 'goto-input';

    toolbar.appendChild(gotoLabel);
    toolbar.appendChild(gotoInput);
    this.container.appendChild(toolbar);

    // Scrollable container
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'viewer-hex hex-scroll-container';

    // Inner spacer to create correct scroll height
    const spacer = document.createElement('div');
    spacer.style.height = totalHeight + 'px';
    spacer.style.position = 'relative';

    // Visible rows container (absolutely positioned within spacer)
    const rowsContainer = document.createElement('div');
    rowsContainer.style.position = 'absolute';
    rowsContainer.style.left = '0';
    rowsContainer.style.right = '0';

    spacer.appendChild(rowsContainer);
    scrollContainer.appendChild(spacer);
    this.container.appendChild(scrollContainer);

    // Virtual scrolling: render only visible rows
    const renderVisibleRows = () => {
      const scrollTop = scrollContainer.scrollTop;
      const viewHeight = scrollContainer.clientHeight;
      const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
      const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT) + 2; // buffer
      const lastRow = Math.min(firstRow + visibleCount, totalRows);

      rowsContainer.style.top = (firstRow * ROW_HEIGHT) + 'px';
      rowsContainer.innerHTML = '';

      for (let row = firstRow; row < lastRow; row++) {
        const byteOffset = row * BYTES_PER_ROW;
        const address = (baseAddress + byteOffset).toString(16).padStart(4, '0').toUpperCase();

        const hex = [];
        let ascii = '';
        const rowEnd = Math.min(byteOffset + BYTES_PER_ROW, bytes.length);

        for (let j = byteOffset; j < byteOffset + BYTES_PER_ROW; j++) {
          if (j < rowEnd) {
            const byte = bytes[j];
            hex.push(byte.toString(16).padStart(2, '0').toUpperCase());
            ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
          } else {
            hex.push('  ');
            ascii += ' ';
          }
        }

        const lineEl = this.createLineElement({ address, hex, ascii });
        lineEl.dataset.offset = byteOffset;
        rowsContainer.appendChild(lineEl);
      }
    };

    scrollContainer.addEventListener('scroll', renderVisibleRows);
    // Initial render
    requestAnimationFrame(renderVisibleRows);

    // Go-to-address handler
    gotoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let addr = gotoInput.value.trim();
        let targetAddr;
        if (addr.startsWith('0x') || addr.startsWith('0X')) {
          targetAddr = parseInt(addr, 16);
        } else {
          targetAddr = parseInt(addr, 10);
        }
        if (!isNaN(targetAddr)) {
          const byteOffset = targetAddr - baseAddress;
          if (byteOffset >= 0 && byteOffset < bytes.length) {
            const row = Math.floor(byteOffset / BYTES_PER_ROW);
            scrollContainer.scrollTop = row * ROW_HEIGHT;
          }
        }
      }
    });

    return scrollContainer;
  }

  /**
   * Create a single hex line DOM element.
   */
  createLineElement(line) {
    const lineEl = document.createElement('div');
    lineEl.className = 'hex-line';

    const addrEl = document.createElement('span');
    addrEl.className = 'hex-address';
    addrEl.textContent = line.address;

    const bytesEl = document.createElement('span');
    bytesEl.className = 'hex-bytes';
    let hexStr = '';
    for (let i = 0; i < line.hex.length; i++) {
      if (i === 8) hexStr += '  ';
      else if (i > 0) hexStr += ' ';
      hexStr += line.hex[i];
    }
    bytesEl.textContent = hexStr;

    const asciiEl = document.createElement('span');
    asciiEl.className = 'hex-ascii';
    asciiEl.textContent = line.ascii;

    lineEl.appendChild(addrEl);
    lineEl.appendChild(bytesEl);
    lineEl.appendChild(asciiEl);
    return lineEl;
  }
}
