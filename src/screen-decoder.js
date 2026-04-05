/**
 * ZX Spectrum SCREEN$ decoder.
 *
 * A SCREEN$ is 6912 bytes: 6144 bytes pixel data + 768 bytes attribute data.
 * Stored as a Code file at address 16384 (0x4000).
 *
 * Pixel data uses a non-linear interleaved layout.
 * Attributes define 8x8 character cell colors.
 */

// ZX Spectrum color palette (RGB values)
const PALETTE_NORMAL = [
  [0, 0, 0],       // 0: black
  [0, 0, 205],     // 1: blue
  [205, 0, 0],     // 2: red
  [205, 0, 205],   // 3: magenta
  [0, 205, 0],     // 4: green
  [0, 205, 205],   // 5: cyan
  [205, 205, 0],   // 6: yellow
  [205, 205, 205], // 7: white
];

const PALETTE_BRIGHT = [
  [0, 0, 0],       // 0: black
  [0, 0, 255],     // 1: bright blue
  [255, 0, 0],     // 2: bright red
  [255, 0, 255],   // 3: bright magenta
  [0, 255, 0],     // 4: bright green
  [0, 255, 255],   // 5: bright cyan
  [255, 255, 0],   // 6: bright yellow
  [255, 255, 255], // 7: bright white
];

/**
 * Decode a SCREEN$ buffer into pixel and attribute data.
 * @param {Buffer} data - 6912 bytes of SCREEN$ data
 * @returns {{ pixels: number[][], attributes: object[][], palette: { normal: number[][], bright: number[][] } }}
 */
export function decodeScreen(data) {
  if (data.length < 6912) {
    throw new Error(`SCREEN$ data too short: ${data.length} bytes (need 6912)`);
  }

  // Decode pixel data (6144 bytes) into 192 rows of 256 pixels
  const pixels = [];
  for (let y = 0; y < 192; y++) {
    const row = new Array(256);
    // ZX Spectrum screen address formula for row y:
    // offset = ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2)
    const offset = ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);

    for (let col = 0; col < 32; col++) {
      const byte = data[offset + col];
      for (let bit = 7; bit >= 0; bit--) {
        row[col * 8 + (7 - bit)] = (byte >> bit) & 1;
      }
    }
    pixels.push(row);
  }

  // Decode attribute data (768 bytes, starting at offset 6144)
  const attributes = [];
  for (let row = 0; row < 24; row++) {
    const attrRow = [];
    for (let col = 0; col < 32; col++) {
      const byte = data[6144 + row * 32 + col];
      attrRow.push({
        ink: byte & 0x07,
        paper: (byte >> 3) & 0x07,
        bright: (byte >> 6) & 0x01,
        flash: (byte >> 7) & 0x01,
      });
    }
    attributes.push(attrRow);
  }

  return {
    pixels,
    attributes,
    palette: {
      normal: PALETTE_NORMAL,
      bright: PALETTE_BRIGHT,
    },
  };
}
