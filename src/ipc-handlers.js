/**
 * IPC handlers for the Electron main process.
 * Provides file system access and TAP parsing to the renderer.
 */

import { ipcMain, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { parseTapFile, getBlockContent, findPrecedingHeader } from './tap-parser.js';
import { detokenize } from './basic-detokenizer.js';
import { decodeScreen } from './screen-decoder.js';
import { formatHexDump } from './hex-formatter.js';
import { rebuildTapFile } from './tap-writer.js';

export function registerIpcHandlers() {
  ipcMain.handle('get-home-path', () => {
    return os.homedir();
  });

  ipcMain.handle('open-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('list-files', async (_event, dirPath) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const items = [];

      for (const entry of entries) {
        // Skip hidden files
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          items.push({
            name: entry.name,
            type: 'directory',
            path: path.join(dirPath, entry.name),
          });
        } else if (entry.name.toLowerCase().endsWith('.tap')) {
          const stat = await fs.stat(path.join(dirPath, entry.name));
          items.push({
            name: entry.name,
            type: 'file',
            path: path.join(dirPath, entry.name),
            size: stat.size,
            extension: '.tap',
          });
        }
      }

      // Sort: directories first, then alphabetical
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      return items;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('tap-blocks', async (_event, filePath) => {
    try {
      const buffer = await fs.readFile(filePath);
      const blocks = parseTapFile(buffer);
      return blocks;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('tap-block-content', async (_event, filePath, blockIndex, offset = 0, limit = 512) => {
    try {
      const buffer = await fs.readFile(filePath);
      const blocks = parseTapFile(buffer);

      if (blockIndex < 0 || blockIndex >= blocks.length) {
        return { error: `Block ${blockIndex} not found` };
      }

      const block = blocks[blockIndex];

      // If it's a header block, return header info
      if (block.isHeader) {
        return {
          contentType: 'header',
          data: {
            type: block.type,
            typeName: block.typeName,
            name: block.name,
            dataLength: block.dataLength,
            param1: block.param1,
            param1Label: block.param1Label,
            param2: block.param2,
            param2Label: block.param2Label,
            checksumValid: block.checksumValid,
          },
        };
      }

      // It's a data block - determine content type from preceding header
      const content = getBlockContent(buffer, block);
      const header = findPrecedingHeader(blocks, blockIndex);

      if (!header) {
        // No header: raw hex dump
        return {
          contentType: 'hexdump',
          data: formatHexDump(content, 0, offset, limit),
        };
      }

      switch (header.type) {
        case 0: {
          // BASIC program
          const lines = detokenize(content, header.param2);
          if (lines.length === 0) {
            // No valid BASIC lines found — likely machine code saved as Program type
            return {
              contentType: 'hexdump',
              data: formatHexDump(content, 0, offset, limit),
              label: 'Machine code (saved as Program)',
            };
          }
          return {
            contentType: 'basic',
            data: {
              lines,
              name: header.name,
              autostart: header.param1 < 32768 ? header.param1 : null,
            },
          };
        }

        case 1:
        case 2: {
          // Number or Character array
          const arrayData = decodeArray(content, header.type);
          return {
            contentType: 'array',
            data: {
              arrayType: header.type === 1 ? 'number' : 'character',
              variableName: header.param1Label,
              ...arrayData,
            },
          };
        }

        case 3: {
          // Code/Bytes
          if (header.param1 === 16384 && header.dataLength === 6912) {
            // SCREEN$
            try {
              const screenData = decodeScreen(content);
              return {
                contentType: 'screen',
                data: screenData,
              };
            } catch (err) {
              return {
                contentType: 'hexdump',
                data: formatHexDump(content, header.param1, offset, limit),
              };
            }
          }

          // Check for word processor text content
          const textInfo = detectTextContent(content);
          if (textInfo) {
            return {
              contentType: 'text',
              data: {
                text: textInfo.text,
                lineWidth: textInfo.lineWidth,
                encoding: textInfo.encoding,
                name: header.name,
                loadAddress: header.param1,
                dataLength: content.length,
              },
            };
          }

          // Code block — scrollable hex dump for large blocks, paginated for small
          if (content.length > 1024) {
            return {
              contentType: 'state-capture',
              data: {
                base64: content.toString('base64'),
                baseAddress: header.param1,
                totalBytes: content.length,
              },
              label: `Code: "${header.name}"`,
            };
          }

          return {
            contentType: 'hexdump',
            data: formatHexDump(content, header.param1, offset, limit),
          };
        }

        default: {
          // Non-standard types (state captures, etc.)
          // Send full data as base64 for client-side scrollable rendering
          const result = {
            contentType: 'state-capture',
            data: {
              base64: content.toString('base64'),
              baseAddress: header.param1,
              totalBytes: content.length,
            },
            label: header.typeName || `Type ${header.type}`,
          };

          // Try to extract BASIC program using TS2068 system variables
          const basicInfo = extractBasicFromCapture(content, header.param1);
          if (basicInfo) {
            // Convert Buffer fields to base64 for IPC transfer
            if (basicInfo.variablesData) {
              basicInfo.variablesBase64 = basicInfo.variablesData.toString('base64');
              delete basicInfo.variablesData;
            }
            if (basicInfo.programData) {
              basicInfo.programBase64 = basicInfo.programData.toString('base64');
              delete basicInfo.programData;
            }
            result.data.basic = basicInfo;
          }

          return result;
        }
      }
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('save-tap-dialog', async (_event, defaultName) => {
    const ext = defaultName.endsWith('.png') ? 'png' : 'tap';
    const filterName = ext === 'png' ? 'PNG Images' : 'TAP Files';
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: [ext] }],
    });
    if (result.canceled) return null;
    return result.filePath;
  });

  ipcMain.handle('save-png', async (_event, savePath, base64Data) => {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(savePath, buffer);
      return { success: true, path: savePath, size: buffer.length };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('save-tap-as', async (_event, originalPath, savePath, edits) => {
    try {
      const buffer = await fs.readFile(originalPath);
      const blocks = parseTapFile(buffer);

      // Convert editedLineNumbers arrays to Sets for the writer
      const processedEdits = {};
      for (const [idx, edit] of Object.entries(edits)) {
        processedEdits[idx] = {
          ...edit,
          editedLineNumbers: edit.editedLineNumbers ? new Set(edit.editedLineNumbers) : null,
        };
      }

      const newTap = rebuildTapFile(buffer, blocks, processedEdits, getBlockContent);
      await fs.writeFile(savePath, newTap);

      return { success: true, path: savePath, size: newTap.length };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('save-basic-from-capture', async (_event, filePath, blockIndex, savePath) => {
    try {
      const buffer = await fs.readFile(filePath);
      const blocks = parseTapFile(buffer);
      const block = blocks[blockIndex];
      const header = findPrecedingHeader(blocks, blockIndex);
      if (!header) return { error: 'No header found for this block' };

      const content = getBlockContent(buffer, block);
      const basicInfo = extractBasicFromCapture(content, header.param1);
      if (!basicInfo) return { error: 'No BASIC program found in state capture' };

      // Build a TAP file with the extracted BASIC program + variables
      const { buildProgramBlocks } = await import('./tap-writer.js');
      const progName = header.name.substring(0, 10);
      const { headerBlock, dataBlock } = buildProgramBlocks(
        progName,
        basicInfo.lines,
        basicInfo.autostart,
        basicInfo.variablesData,
      );

      const tapFile = Buffer.concat([headerBlock, dataBlock]);
      await fs.writeFile(savePath, tapFile);

      return { success: true, path: savePath, size: tapFile.length };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Save edited BASIC lines as a new TAP file (for state capture editing)
  ipcMain.handle('save-edited-basic', async (_event, savePath, name, lines, autostart, variablesBase64, originalProgramBase64, editedLineNumbers) => {
    try {
      const { buildProgramBlocks } = await import('./tap-writer.js');
      const variablesData = variablesBase64 ? Buffer.from(variablesBase64, 'base64') : null;
      const originalProgramData = originalProgramBase64 ? Buffer.from(originalProgramBase64, 'base64') : null;
      const editedSet = editedLineNumbers ? new Set(editedLineNumbers) : null;
      const { headerBlock, dataBlock } = buildProgramBlocks(name, lines, autostart, variablesData, originalProgramData, editedSet);
      const tapFile = Buffer.concat([headerBlock, dataBlock]);
      await fs.writeFile(savePath, tapFile);
      return { success: true, path: savePath, size: tapFile.length };
    } catch (err) {
      return { error: err.message };
    }
  });

  // TAP Assembler: combine blocks from multiple TAP files into one
  // entries: [{ filePath, blockIndex, blockIndex2? }]
  // blockIndex is the header; blockIndex2 (if present) is the paired data block
  ipcMain.handle('assemble-tap', async (_event, entries, savePath) => {
    try {
      const outputParts = [];

      for (const entry of entries) {
        const buffer = await fs.readFile(entry.filePath);
        const blocks = parseTapFile(buffer);

        // Copy the specified block(s) verbatim
        for (const idx of entry.blockIndices) {
          const block = blocks[idx];
          if (!block) continue;
          const blockStart = block.offset;
          const blockEnd = block.offset + 2 + block.rawLength;
          outputParts.push(buffer.subarray(blockStart, blockEnd));
        }
      }

      const result = Buffer.concat(outputParts);
      await fs.writeFile(savePath, result);
      return { success: true, path: savePath, size: result.length };
    } catch (err) {
      return { error: err.message };
    }
  });
}

/**
 * Extract a BASIC program from a state machine capture using TS2068 system variables.
 *
 * TS2068 memory layout:
 *   System variables at $5C00
 *   PROG ($5C53): Start of BASIC program
 *   VARS ($5C4B): End of BASIC program / start of variables
 *   NEWPPC ($5C42): Line to jump to (autostart indicator)
 *
 * @param {Buffer} content - The capture data
 * @param {number} baseAddress - Base address of the capture
 * @returns {object|null} Extracted BASIC info or null if not found
 */
function extractBasicFromCapture(content, baseAddress) {
  const SYS_VARS_ADDR = 0x5c00;

  // Check if system variables are within the capture
  if (SYS_VARS_ADDR < baseAddress || SYS_VARS_ADDR + 0xcc > baseAddress + content.length) {
    return null;
  }

  try {
    const PROG = content.readUInt16LE(0x5c53 - baseAddress);
    const VARS = content.readUInt16LE(0x5c4b - baseAddress);
    const ELINE = content.readUInt16LE(0x5c59 - baseAddress);
    const NEWPPC = content.readUInt16LE(0x5c42 - baseAddress);

    // Validate pointers
    if (PROG < baseAddress || PROG >= baseAddress + content.length) return null;
    if (VARS < PROG || VARS > baseAddress + content.length) return null;

    const progOffset = PROG - baseAddress;
    const progLen = VARS - PROG;

    if (progLen <= 0 || progLen > 65536) return null;

    const programData = content.subarray(progOffset, progOffset + progLen);

    // Validate: first 2 bytes should be a reasonable line number (1-9999, big-endian)
    if (programData.length >= 4) {
      const firstLineNum = programData.readUInt16BE(0);
      if (firstLineNum === 0 || firstLineNum > 9999) return null;
    }

    const lines = detokenize(programData, progLen);
    if (lines.length === 0) return null;

    // Determine autostart by looking for SAVE ... LINE N in the program.
    // NEWPPC is NOT reliable — it's the line being executed at capture time,
    // not the intended autostart.
    let autostart = null;
    for (const line of lines) {
      const m = line.text.match(/SAVE\s.*\sLINE\s+(\d+)/);
      if (m) {
        autostart = parseInt(m[1], 10);
      }
    }
    // Fall back to first line if no SAVE LINE found
    if (autostart === null) {
      autostart = lines[0].lineNumber;
    }

    // Extract variables area (VARS to E_LINE) to preserve runtime state.
    // Without these, programs that use READ/DATA to initialize variables
    // will fail if they don't re-read before first use.
    let variablesData = null;
    if (ELINE > VARS && ELINE <= baseAddress + content.length) {
      const varsDataOffset = VARS - baseAddress;
      const elineOffset = ELINE - baseAddress;
      variablesData = Buffer.from(content.subarray(varsDataOffset, elineOffset));
    }

    return {
      lines,
      autostart,
      progAddress: PROG,
      varsAddress: VARS,
      elineAddress: ELINE,
      programLength: progLen,
      variablesLength: variablesData ? variablesData.length : 0,
      variablesData,
      programData: Buffer.from(programData), // Original binary for preserving unedited lines
    };
  } catch (err) {
    return null;
  }
}

/**
 * Decode a ZX Spectrum number or character array from a data block.
 */
/**
 * Detect if a Code block contains word processor text.
 * Common patterns: fixed-width lines (32 chars) padded with spaces,
 * high ratio of printable ASCII characters.
 *
 * Known formats:
 *  - MScript/Tasword: 32-char wide lines at address 0x8200
 *  - Plain text data files
 *
 * @param {Buffer} content
 * @returns {{ text: string, lineWidth: number, encoding: string }|null}
 */
function detectTextContent(content) {
  if (content.length < 32) return null;

  // Check printability ratio over entire content
  let printable = 0;
  for (let i = 0; i < content.length; i++) {
    const b = content[i];
    if ((b >= 0x20 && b <= 0x7e) || b === 0x0d || b === 0x0a) printable++;
  }
  const ratio = printable / content.length;
  if (ratio < 0.85) return null;

  // Detect line width: check if content is structured as fixed-width lines.
  // Try common widths: 32 (MScript/Tasword), 64, 40, 80
  let lineWidth = 0;
  for (const w of [32, 64, 40, 80]) {
    if (content.length % w === 0 && content.length / w >= 2) {
      // Check if lines end with spaces (padding) or have consistent structure
      let paddedLines = 0;
      const numLines = content.length / w;
      for (let line = 0; line < Math.min(numLines, 20); line++) {
        const lineEnd = content[line * w + w - 1];
        if (lineEnd === 0x20) paddedLines++;
      }
      if (paddedLines > Math.min(numLines, 20) * 0.5) {
        lineWidth = w;
        break;
      }
    }
  }

  // Extract text
  let text;
  if (lineWidth > 0) {
    // Fixed-width: split into lines and trim trailing spaces
    const lines = [];
    for (let i = 0; i < content.length; i += lineWidth) {
      const lineBytes = content.subarray(i, Math.min(i + lineWidth, content.length));
      let lineStr = '';
      for (let j = 0; j < lineBytes.length; j++) {
        const b = lineBytes[j];
        if (b >= 0x20 && b <= 0x7e) lineStr += String.fromCharCode(b);
        else if (b === 0x0d || b === 0x0a) lineStr += '\n';
        else lineStr += ' ';
      }
      lines.push(lineStr.trimEnd());
    }
    text = lines.join('\n');
  } else {
    // Variable-width: just convert bytes to text
    let str = '';
    for (let i = 0; i < content.length; i++) {
      const b = content[i];
      if (b >= 0x20 && b <= 0x7e) str += String.fromCharCode(b);
      else if (b === 0x0d || b === 0x0a) str += '\n';
      else str += ' ';
    }
    text = str;
  }

  return {
    text,
    lineWidth: lineWidth || 0,
    encoding: lineWidth === 32 ? 'MScript/Tasword (32-col)' : lineWidth ? `Fixed ${lineWidth}-col` : 'Plain text',
  };
}

function decodeArray(content, type) {
  if (content.length < 3) {
    return { error: 'Array data too short', values: [] };
  }

  try {
    // Array format in memory:
    // First 1-3 bytes: array descriptor
    // Then: dimension info + data

    // Number of dimensions
    let pos = 0;

    if (type === 1) {
      // Number array
      // Format: numDimensions(1), then dims (2 bytes each), then 5-byte FP values
      const numDims = content[pos++];
      const dims = [];
      let totalElements = 1;
      for (let d = 0; d < numDims; d++) {
        if (pos + 2 > content.length) break;
        const dimSize = content.readUInt16LE(pos);
        pos += 2;
        dims.push(dimSize);
        totalElements *= dimSize;
      }

      const values = [];
      for (let i = 0; i < totalElements && pos + 5 <= content.length; i++) {
        const val = decodeZxFloat(content, pos);
        values.push(val);
        pos += 5;
      }

      return { dimensions: dims, values, totalElements };
    } else {
      // Character array
      // Format: numDimensions(1), then dims (2 bytes each), then character data
      const numDims = content[pos++];
      const dims = [];
      let totalElements = 1;
      for (let d = 0; d < numDims; d++) {
        if (pos + 2 > content.length) break;
        const dimSize = content.readUInt16LE(pos);
        pos += 2;
        dims.push(dimSize);
        totalElements *= dimSize;
      }

      // For character arrays, the last dimension is the string length
      const stringLen = dims.length > 0 ? dims[dims.length - 1] : 1;
      const numStrings = totalElements / stringLen;
      const values = [];
      for (let i = 0; i < numStrings && pos + stringLen <= content.length; i++) {
        const str = content.subarray(pos, pos + stringLen).toString('ascii');
        values.push(str);
        pos += stringLen;
      }

      return { dimensions: dims, values, totalElements, stringLength: stringLen };
    }
  } catch (err) {
    return { error: err.message, values: [] };
  }
}

/**
 * Decode a ZX Spectrum 5-byte floating point number.
 * Format: exponent(1), mantissa(4)
 * The mantissa is normalized with an implied 1 bit.
 */
function decodeZxFloat(buffer, offset) {
  const exp = buffer[offset];

  if (exp === 0) {
    // Small integer stored in special format
    const sign = buffer[offset + 1];
    const lo = buffer[offset + 2];
    const hi = buffer[offset + 3];
    const val = lo | (hi << 8);
    return sign ? -val : val;
  }

  // Floating point
  const sign = buffer[offset + 1] & 0x80;
  // Reconstruct mantissa with implied 1 bit
  const m1 = (buffer[offset + 1] | 0x80) & 0xff;
  const m2 = buffer[offset + 2];
  const m3 = buffer[offset + 3];
  const m4 = buffer[offset + 4];

  let mantissa = ((m1 / 256 + m2 / 65536 + m3 / 16777216 + m4 / 4294967296));
  const value = mantissa * Math.pow(2, exp - 128);

  return sign ? -value : value;
}
