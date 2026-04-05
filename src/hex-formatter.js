/**
 * Hex dump formatter with pagination support.
 */

/**
 * Format a buffer as a hex dump.
 * @param {Buffer} buffer - Data to dump
 * @param {number} baseAddress - Starting address for display (default 0)
 * @param {number} offset - Byte offset to start from (for pagination)
 * @param {number} limit - Number of bytes to include (for pagination)
 * @returns {{ lines: Array, totalBytes: number, offset: number, limit: number, baseAddress: number }}
 */
export function formatHexDump(buffer, baseAddress = 0, offset = 0, limit = 512) {
  const lines = [];
  const end = Math.min(offset + limit, buffer.length);

  for (let i = offset; i < end; i += 16) {
    const address = (baseAddress + i).toString(16).padStart(4, '0').toUpperCase();
    const hex = [];
    let ascii = '';
    const lineEnd = Math.min(i + 16, end);

    for (let j = i; j < i + 16; j++) {
      if (j < lineEnd) {
        const byte = buffer[j];
        hex.push(byte.toString(16).padStart(2, '0').toUpperCase());
        ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
      } else {
        hex.push('  ');
        ascii += ' ';
      }
    }

    lines.push({ address, hex, ascii });
  }

  return {
    lines,
    totalBytes: buffer.length,
    offset,
    limit,
    baseAddress,
  };
}
