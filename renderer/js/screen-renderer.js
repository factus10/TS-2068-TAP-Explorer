/**
 * Canvas-based SCREEN$ renderer for ZX Spectrum display data.
 * Supports invert toggle and PNG export with upscaling.
 */

export class ScreenRenderer {
  constructor(container) {
    this.container = container;
    this.data = null;
    this.inverted = false;
    this.canvas = null;
    this.ctx = null;
  }

  render(data) {
    this.data = data;

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'screen-toolbar';

    // Invert toggle
    const invertBtn = document.createElement('button');
    invertBtn.className = 'screen-btn';
    invertBtn.textContent = '\u25D1 Invert';
    invertBtn.title = 'Swap ink and paper colors';
    invertBtn.addEventListener('click', () => {
      this.inverted = !this.inverted;
      invertBtn.classList.toggle('active', this.inverted);
      this.paint();
    });
    toolbar.appendChild(invertBtn);

    // Separator
    const sep = document.createElement('span');
    sep.className = 'screen-toolbar-sep';
    toolbar.appendChild(sep);

    // Export label
    const exportLabel = document.createElement('span');
    exportLabel.className = 'screen-toolbar-label';
    exportLabel.textContent = 'Export PNG:';
    toolbar.appendChild(exportLabel);

    // Export size buttons
    for (const scale of [1, 2, 4, 8]) {
      const btn = document.createElement('button');
      btn.className = 'screen-btn';
      btn.textContent = `${scale}x`;
      btn.title = `Export ${256 * scale} \u00D7 ${192 * scale} PNG`;
      btn.addEventListener('click', () => this.exportPng(scale));
      toolbar.appendChild(btn);
    }

    this.container.appendChild(toolbar);

    // Canvas wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'screen-canvas-wrapper';

    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 192;
    wrapper.appendChild(this.canvas);
    this.container.appendChild(wrapper);

    this.ctx = this.canvas.getContext('2d');
    this.paint();
  }

  /**
   * Paint the canvas with current settings.
   */
  paint() {
    const { pixels, attributes, palette } = this.data;
    const ctx = this.ctx;
    const imageData = ctx.createImageData(256, 192);
    const buf = imageData.data;

    for (let y = 0; y < 192; y++) {
      const attrY = Math.floor(y / 8);
      for (let x = 0; x < 256; x++) {
        const attrX = Math.floor(x / 8);
        const attr = attributes[attrY][attrX];
        const pal = attr.bright ? palette.bright : palette.normal;

        let color;
        if (this.inverted) {
          // Swap ink and paper
          color = pixels[y][x] === 1 ? pal[attr.paper] : pal[attr.ink];
        } else {
          color = pixels[y][x] === 1 ? pal[attr.ink] : pal[attr.paper];
        }

        const idx = (y * 256 + x) * 4;
        buf[idx] = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        buf[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Export the current canvas as a PNG at the given scale factor.
   */
  async exportPng(scale) {
    const width = 256 * scale;
    const height = 192 * scale;

    // Create an offscreen canvas at the target size
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d');

    // Disable smoothing for crisp pixel scaling
    offCtx.imageSmoothingEnabled = false;

    // Draw the 256x192 source canvas scaled up
    offCtx.drawImage(this.canvas, 0, 0, width, height);

    // Convert to PNG blob
    const blob = await new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    // Convert to base64 for IPC transfer
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);

    const defaultName = `screen_${scale}x.png`;
    const savePath = await window.api.showSaveDialog(defaultName);
    if (!savePath) return;

    const result = await window.api.savePng(savePath, base64);
    if (result.error) {
      alert('Error saving PNG: ' + result.error);
    }
  }
}
