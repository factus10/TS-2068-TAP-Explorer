/**
 * TAP file writer.
 *
 * Assembles blocks into a valid TAP file format.
 * Used for saving edited BASIC programs back to TAP.
 */

import { tokenizeProgram } from './basic-tokenizer.js';

/**
 * Compute checksum (XOR of all bytes).
 * @param {Buffer} data - bytes to checksum (flag + content, no length prefix)
 * @returns {number} checksum byte
 */
function computeChecksum(data) {
  let xor = 0;
  for (let i = 0; i < data.length; i++) {
    xor ^= data[i];
  }
  return xor;
}

/**
 * Build a complete TAP block from flag + content.
 * Appends checksum and prepends length.
 *
 * @param {number} flag - 0x00 for header, 0xFF for data
 * @param {Buffer} content - block content (without flag or checksum)
 * @returns {Buffer} Complete TAP block: [length LE(2)][flag][content][checksum]
 */
export function buildBlock(flag, content) {
  const blockLen = 1 + content.length + 1; // flag + content + checksum
  const block = Buffer.alloc(2 + blockLen);

  block.writeUInt16LE(blockLen, 0);
  block[2] = flag;
  content.copy(block, 3);

  // Checksum of flag + content
  const checksumData = block.subarray(2, 2 + 1 + content.length);
  block[2 + blockLen - 1] = computeChecksum(checksumData);

  return block;
}

/**
 * Build a program header block.
 *
 * @param {string} name - Program name (max 10 chars, will be padded)
 * @param {number} dataLength - Length of the program data
 * @param {number} autostart - Autostart line number (use 32768+ for no autostart)
 * @param {number} variablesOffset - Offset to variables area within program data
 * @returns {Buffer} Complete header TAP block
 */
export function buildProgramHeader(name, dataLength, autostart, variablesOffset) {
  const content = Buffer.alloc(17);

  content[0] = 0; // type = Program

  // Filename: 10 chars, space-padded
  const nameStr = name.substring(0, 10).padEnd(10, ' ');
  content.write(nameStr, 1, 10, 'ascii');

  content.writeUInt16LE(dataLength, 11);
  content.writeUInt16LE(autostart, 13);
  content.writeUInt16LE(variablesOffset, 15);

  return buildBlock(0x00, content);
}

/**
 * Build a data block from raw content.
 *
 * @param {Buffer} content - The raw data
 * @returns {Buffer} Complete data TAP block
 */
export function buildDataBlock(content) {
  return buildBlock(0xff, content);
}

/**
 * Build a complete BASIC program as header + data TAP blocks.
 *
 * @param {string} name - Program name
 * @param {Array<{lineNumber: number, text: string}>} lines - BASIC lines
 * @param {number|null} autostart - Autostart line number (null = no autostart)
 * @param {Buffer|null} variablesData - Raw variables to append after the program
 * @returns {{ headerBlock: Buffer, dataBlock: Buffer }}
 */
export function buildProgramBlocks(name, lines, autostart, variablesData) {
  const { programBuffer, variablesOffset } = tokenizeProgram(lines);

  const autostartValue = autostart != null && autostart < 32768 ? autostart : 32768;

  // If we have variables data from a state capture, append it after the program
  let fullData;
  if (variablesData && variablesData.length > 0) {
    fullData = Buffer.concat([programBuffer, variablesData]);
  } else {
    fullData = programBuffer;
  }

  const headerBlock = buildProgramHeader(
    name,
    fullData.length,
    autostartValue,
    variablesOffset, // Offset where variables start within the data block
  );

  const dataBlock = buildDataBlock(fullData);

  return { headerBlock, dataBlock };
}

/**
 * Rebuild a TAP file, replacing specified BASIC blocks with edited versions.
 *
 * @param {Buffer} originalTap - Original TAP file buffer
 * @param {Array} originalBlocks - Parsed block descriptors from parseTapFile
 * @param {object} edits - Map of block indices to edited content:
 *   { [dataBlockIndex]: { lines: [{lineNumber, text}], autostart: number|null, name: string } }
 *   Each key is the index of a DATA block that contains a BASIC program.
 * @returns {Buffer} New TAP file buffer
 */
export function rebuildTapFile(originalTap, originalBlocks, edits) {
  const outputParts = [];

  let i = 0;
  while (i < originalBlocks.length) {
    const block = originalBlocks[i];

    // Check if the NEXT block (data block) has an edit
    // Edits reference the data block index, and we need to replace both header + data
    if (block.isHeader && block.type === 0 && i + 1 < originalBlocks.length) {
      const dataBlockIndex = i + 1;
      const edit = edits[dataBlockIndex];

      if (edit) {
        // Replace this header+data pair with re-tokenized version
        const { headerBlock, dataBlock } = buildProgramBlocks(
          edit.name || block.name,
          edit.lines,
          edit.autostart,
        );
        outputParts.push(headerBlock);
        outputParts.push(dataBlock);
        i += 2; // Skip both original header and data blocks
        continue;
      }
    }

    // No edit for this block - copy original bytes verbatim
    const blockStart = block.offset;
    const blockEnd = block.offset + 2 + block.rawLength; // 2-byte length prefix + block content
    outputParts.push(originalTap.subarray(blockStart, blockEnd));
    i++;
  }

  return Buffer.concat(outputParts);
}
