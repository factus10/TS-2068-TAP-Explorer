/**
 * ZX Spectrum TAP file parser
 *
 * TAP format: sequential blocks, each preceded by a 2-byte LE length.
 * Block = flag(1) + content(N) + checksum(1)
 * Flag 0x00 = header, 0xFF = data
 * Checksum = XOR of all bytes in the block (including flag)
 */

const TYPE_NAMES = {
  0: 'Program',
  1: 'Number array',
  2: 'Character array',
  3: 'Bytes',
};

/**
 * Parse a TAP file buffer into an array of block descriptors.
 * @param {Buffer} buffer - Raw TAP file contents
 * @returns {Array} Array of block objects
 */
export function parseTapFile(buffer) {
  const blocks = [];
  let pos = 0;

  while (pos < buffer.length) {
    if (pos + 2 > buffer.length) break;

    const blockLen = buffer.readUInt16LE(pos);
    const blockOffset = pos;
    pos += 2;

    if (blockLen === 0 || pos + blockLen > buffer.length) {
      blocks.push({
        index: blocks.length,
        offset: blockOffset,
        rawLength: blockLen,
        truncated: true,
        error: `Block truncated: need ${blockLen} bytes, only ${buffer.length - pos} available`,
      });
      break;
    }

    const blockData = buffer.subarray(pos, pos + blockLen);
    const flag = blockData[0];

    // Verify checksum: XOR of all bytes including flag, should equal last byte
    let xor = 0;
    for (let i = 0; i < blockLen - 1; i++) {
      xor ^= blockData[i];
    }
    const checksumByte = blockData[blockLen - 1];
    const checksumValid = xor === checksumByte;

    const block = {
      index: blocks.length,
      offset: blockOffset,
      rawLength: blockLen,
      flag,
      flagLabel: flag === 0x00 ? 'Header' : flag === 0xff ? 'Data' : `Flag 0x${flag.toString(16).padStart(2, '0')}`,
      checksumValid,
    };

    if (flag === 0x00 && blockLen === 19) {
      // Standard header block
      block.isHeader = true;
      block.type = blockData[1];
      block.typeName = TYPE_NAMES[block.type] || `Unknown (${block.type})`;
      block.name = blockData.subarray(2, 12).toString('ascii').trimEnd();
      block.dataLength = blockData.readUInt16LE(12);
      block.param1 = blockData.readUInt16LE(14);
      block.param2 = blockData.readUInt16LE(16);

      // Contextual labels for params
      switch (block.type) {
        case 0: // Program
          block.param1Label = block.param1 >= 32768 ? 'No autostart' : `Autostart line ${block.param1}`;
          block.param2Label = `Variables offset: ${block.param2}`;
          break;
        case 1: // Number array
        case 2: // Character array
          {
            const varLetter = String.fromCharCode((block.param1 & 0x1f) + 0x40);
            block.param1Label = `Variable: ${varLetter}`;
            block.param2Label = 'Unused';
          }
          break;
        case 3: // Code/Bytes
          block.param1Label = `Load address: ${block.param1} (0x${block.param1.toString(16).padStart(4, '0').toUpperCase()})`;
          block.param2Label = `${block.param2}`;
          // Detect SCREEN$
          if (block.param1 === 16384 && block.dataLength === 6912) {
            block.typeName = 'SCREEN$';
          }
          break;
        default: // Non-standard (state captures etc.)
          block.param1Label = `Start address: ${block.param1} (0x${block.param1.toString(16).padStart(4, '0').toUpperCase()})`;
          block.param2Label = `${block.param2}`;
          if (block.dataLength > 40000) {
            block.typeName = 'State capture';
          }
          break;
      }
    } else if (flag === 0xff) {
      // Data block
      block.isHeader = false;
      block.contentLength = blockLen - 2; // minus flag and checksum
    } else {
      // Non-standard block
      block.isHeader = false;
      block.contentLength = blockLen - 2;
    }

    blocks.push(block);
    pos += blockLen;
  }

  return blocks;
}

/**
 * Extract the content bytes from a data block (between flag and checksum).
 * @param {Buffer} buffer - Raw TAP file
 * @param {object} block - Block descriptor from parseTapFile
 * @returns {Buffer} Content bytes
 */
export function getBlockContent(buffer, block) {
  // Block layout: [length(2)][flag(1)][content(N)][checksum(1)]
  const start = block.offset + 2 + 1; // skip length field + flag
  const contentLen = block.rawLength - 2; // minus flag and checksum
  return buffer.subarray(start, start + contentLen);
}

/**
 * Find the header block that precedes a data block (if any).
 * @param {Array} blocks - All blocks from parseTapFile
 * @param {number} dataBlockIndex - Index of the data block
 * @returns {object|null} The preceding header block, or null
 */
export function findPrecedingHeader(blocks, dataBlockIndex) {
  if (dataBlockIndex <= 0) return null;
  const prev = blocks[dataBlockIndex - 1];
  if (prev && prev.isHeader) return prev;
  return null;
}
