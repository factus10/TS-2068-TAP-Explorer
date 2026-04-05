/**
 * TAP file writer.
 *
 * Assembles blocks into a valid TAP file format.
 * Used for saving edited BASIC programs back to TAP.
 *
 * Key design: unedited BASIC lines are preserved as original binary bytes.
 * Only lines the user actually changed are re-tokenized. This avoids
 * keyword-as-variable-name ambiguities that arise from re-tokenizing
 * programs extracted from state captures.
 */

import { tokenizeLine } from './basic-tokenizer.js';

/**
 * Compute checksum (XOR of all bytes).
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
 */
export function buildBlock(flag, content) {
  const blockLen = 1 + content.length + 1;
  const block = Buffer.alloc(2 + blockLen);
  block.writeUInt16LE(blockLen, 0);
  block[2] = flag;
  content.copy(block, 3);
  const checksumData = block.subarray(2, 2 + 1 + content.length);
  block[2 + blockLen - 1] = computeChecksum(checksumData);
  return block;
}

/**
 * Build a program header block.
 */
export function buildProgramHeader(name, dataLength, autostart, variablesOffset) {
  const content = Buffer.alloc(17);
  content[0] = 0;
  const nameStr = name.substring(0, 10).padEnd(10, ' ');
  content.write(nameStr, 1, 10, 'ascii');
  content.writeUInt16LE(dataLength, 11);
  content.writeUInt16LE(autostart, 13);
  content.writeUInt16LE(variablesOffset, 15);
  return buildBlock(0x00, content);
}

/**
 * Build a data block from raw content.
 */
export function buildDataBlock(content) {
  return buildBlock(0xff, content);
}

/**
 * Parse original BASIC program binary into a map of line number → raw bytes.
 * Each entry contains the complete line: [lineNum BE(2)][lineLen LE(2)][content + 0x0D]
 *
 * @param {Buffer} programData - Raw BASIC program bytes (PROG to VARS)
 * @returns {Map<number, Buffer>} Map of lineNumber → complete line bytes
 */
function parseOriginalLines(programData) {
  const lineMap = new Map();
  let pos = 0;

  while (pos + 4 <= programData.length) {
    const lineNum = programData.readUInt16BE(pos);
    const lineLen = programData.readUInt16LE(pos + 2);

    if (lineNum === 0 && lineLen === 0) break;
    if (lineNum > 9999) break;

    const totalLineSize = 4 + lineLen;
    if (pos + totalLineSize > programData.length) break;

    lineMap.set(lineNum, Buffer.from(programData.subarray(pos, pos + totalLineSize)));
    pos += totalLineSize;
  }

  return lineMap;
}

/**
 * Build a complete BASIC program as header + data TAP blocks.
 * Preserves original binary for unedited lines; only re-tokenizes changed lines.
 *
 * @param {string} name - Program name
 * @param {Array<{lineNumber: number, text: string}>} lines - All lines (edited + unedited)
 * @param {number|null} autostart - Autostart line number (null = no autostart)
 * @param {Buffer|null} variablesData - Raw variables to append after the program
 * @param {Buffer|null} originalProgramData - Original BASIC program binary (for preserving unedited lines)
 * @param {Set<number>|null} editedLineNumbers - Set of line numbers that were actually changed
 * @returns {{ headerBlock: Buffer, dataBlock: Buffer }}
 */
export function buildProgramBlocks(name, lines, autostart, variablesData, originalProgramData, editedLineNumbers) {
  let programParts;
  let totalProgramLen = 0;

  if (originalProgramData && editedLineNumbers) {
    // Selective re-tokenization: preserve original bytes for unedited lines
    const origLineMap = parseOriginalLines(originalProgramData);
    programParts = [];

    for (const line of lines) {
      if (editedLineNumbers.has(line.lineNumber) || !origLineMap.has(line.lineNumber)) {
        // This line was edited (or is new) — re-tokenize it
        const tokenized = tokenizeLine(line.text);
        const lineHeader = Buffer.alloc(4);
        lineHeader.writeUInt16BE(line.lineNumber, 0);
        lineHeader.writeUInt16LE(tokenized.length, 2);
        programParts.push(lineHeader);
        programParts.push(tokenized);
        totalProgramLen += 4 + tokenized.length;
      } else {
        // Unedited — copy original binary verbatim
        const origBytes = origLineMap.get(line.lineNumber);
        programParts.push(origBytes);
        totalProgramLen += origBytes.length;
      }
    }
  } else {
    // No original data — tokenize everything (fallback, used for new programs)
    programParts = [];
    for (const line of lines) {
      const tokenized = tokenizeLine(line.text);
      const lineHeader = Buffer.alloc(4);
      lineHeader.writeUInt16BE(line.lineNumber, 0);
      lineHeader.writeUInt16LE(tokenized.length, 2);
      programParts.push(lineHeader);
      programParts.push(tokenized);
      totalProgramLen += 4 + tokenized.length;
    }
  }

  const programBuffer = Buffer.concat(programParts, totalProgramLen);
  const variablesOffset = totalProgramLen;
  const autostartValue = autostart != null && autostart < 32768 ? autostart : 32768;

  let fullData;
  if (variablesData && variablesData.length > 0) {
    fullData = Buffer.concat([programBuffer, variablesData]);
  } else {
    fullData = programBuffer;
  }

  const headerBlock = buildProgramHeader(name, fullData.length, autostartValue, variablesOffset);
  const dataBlock = buildDataBlock(fullData);

  return { headerBlock, dataBlock };
}

/**
 * Rebuild a TAP file, replacing specified BASIC blocks with edited versions.
 * Preserves original binary for unedited lines within each edited block.
 *
 * @param {Buffer} originalTap - Original TAP file buffer
 * @param {Array} originalBlocks - Parsed block descriptors from parseTapFile
 * @param {object} edits - Map of block indices to edited content:
 *   { [dataBlockIndex]: { lines, autostart, name, editedLineNumbers } }
 * @param {Function} getBlockContent - Function to extract block content from TAP buffer
 * @returns {Buffer} New TAP file buffer
 */
export function rebuildTapFile(originalTap, originalBlocks, edits, getBlockContent) {
  const outputParts = [];

  let i = 0;
  while (i < originalBlocks.length) {
    const block = originalBlocks[i];

    if (block.isHeader && block.type === 0 && i + 1 < originalBlocks.length) {
      const dataBlockIndex = i + 1;
      const edit = edits[dataBlockIndex];

      if (edit) {
        // Get original program binary for preserving unedited lines
        const dataBlock = originalBlocks[dataBlockIndex];
        const originalContent = getBlockContent(originalTap, dataBlock);
        const originalProgramData = originalContent.subarray(0, block.param2 || originalContent.length);

        const { headerBlock, dataBlock: newDataBlock } = buildProgramBlocks(
          edit.name || block.name,
          edit.lines,
          edit.autostart,
          null, // no separate variables for regular TAP edits
          originalProgramData,
          edit.editedLineNumbers || null,
        );
        outputParts.push(headerBlock);
        outputParts.push(newDataBlock);
        i += 2;
        continue;
      }
    }

    // No edit for this block — copy original bytes verbatim
    const blockStart = block.offset;
    const blockEnd = block.offset + 2 + block.rawLength;
    outputParts.push(originalTap.subarray(blockStart, blockEnd));
    i++;
  }

  return Buffer.concat(outputParts);
}
