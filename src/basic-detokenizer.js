/**
 * ZX Spectrum BASIC detokenizer.
 *
 * Converts tokenized BASIC program data back to readable source code.
 * Token range 0xA5-0xFF maps to 91 BASIC keywords.
 * Verified against letter.tap (0xEA=REM, 0xE7=BORDER, 0xF1=LET, etc.)
 */

// Complete ZX Spectrum 48K BASIC token table (0xA5-0xFF)
const TOKENS = {
  0xa5: 'RND',
  0xa6: 'INKEY$',
  0xa7: 'PI',
  0xa8: 'FN ',
  0xa9: 'POINT ',
  0xaa: 'SCREEN$ ',
  0xab: 'ATTR ',
  0xac: 'AT ',
  0xad: 'TAB ',
  0xae: 'VAL$ ',
  0xaf: 'CODE ',
  0xb0: 'VAL ',
  0xb1: 'LEN ',
  0xb2: 'SIN ',
  0xb3: 'COS ',
  0xb4: 'TAN ',
  0xb5: 'ASN ',
  0xb6: 'ACS ',
  0xb7: 'ATN ',
  0xb8: 'LN ',
  0xb9: 'EXP ',
  0xba: 'INT ',
  0xbb: 'SQR ',
  0xbc: 'SGN ',
  0xbd: 'ABS ',
  0xbe: 'PEEK ',
  0xbf: 'IN ',
  0xc0: 'USR ',
  0xc1: 'STR$ ',
  0xc2: 'CHR$ ',
  0xc3: 'NOT ',
  0xc4: 'BIN ',
  0xc5: ' OR ',
  0xc6: ' AND ',
  0xc7: '<=',
  0xc8: '>=',
  0xc9: '<>',
  0xca: ' LINE ',
  0xcb: ' THEN ',
  0xcc: ' TO ',
  0xcd: ' STEP ',
  0xce: 'DEF FN ',
  0xcf: 'CAT ',
  0xd0: 'FORMAT ',
  0xd1: 'MOVE ',
  0xd2: 'ERASE ',
  0xd3: 'OPEN #',
  0xd4: 'CLOSE #',
  0xd5: 'MERGE ',
  0xd6: 'VERIFY ',
  0xd7: 'BEEP ',
  0xd8: 'CIRCLE ',
  0xd9: 'INK ',
  0xda: 'PAPER ',
  0xdb: 'FLASH ',
  0xdc: 'BRIGHT ',
  0xdd: 'INVERSE ',
  0xde: 'OVER ',
  0xdf: 'OUT ',
  0xe0: 'LPRINT ',
  0xe1: 'LLIST ',
  0xe2: 'STOP ',
  0xe3: 'READ ',
  0xe4: 'DATA ',
  0xe5: 'RESTORE ',
  0xe6: 'NEW ',
  0xe7: 'BORDER ',
  0xe8: 'CONTINUE ',
  0xe9: 'DIM ',
  0xea: 'REM ',
  0xeb: 'FOR ',
  0xec: 'GO TO ',
  0xed: 'GO SUB ',
  0xee: 'INPUT ',
  0xef: 'LOAD ',
  0xf0: 'LIST ',
  0xf1: 'LET ',
  0xf2: 'PAUSE ',
  0xf3: 'NEXT ',
  0xf4: 'POKE ',
  0xf5: 'PRINT ',
  0xf6: 'PLOT ',
  0xf7: 'RUN ',
  0xf8: 'SAVE ',
  0xf9: 'RANDOMIZE ',
  0xfa: 'IF ',
  0xfb: 'CLS ',
  0xfc: 'DRAW ',
  0xfd: 'CLEAR ',
  0xfe: 'RETURN ',
  0xff: 'COPY ',
};

// Keywords that are statements (appear at start of line or after colon)
// Used for syntax highlighting in the renderer
export const STATEMENT_KEYWORDS = new Set([
  'BEEP', 'BORDER', 'BRIGHT', 'CAT', 'CIRCLE', 'CLEAR', 'CLOSE #', 'CLS',
  'CONTINUE', 'COPY', 'DATA', 'DEF FN', 'DIM', 'DRAW', 'ERASE', 'FLASH',
  'FOR', 'FORMAT', 'GO SUB', 'GO TO', 'IF', 'INK', 'INPUT', 'INVERSE',
  'LET', 'LIST', 'LLIST', 'LOAD', 'LPRINT', 'MERGE', 'MOVE', 'NEW',
  'NEXT', 'OPEN #', 'OUT', 'OVER', 'PAPER', 'PAUSE', 'PLOT', 'POKE',
  'PRINT', 'RANDOMIZE', 'READ', 'REM', 'RESTORE', 'RETURN', 'RUN',
  'SAVE', 'STOP', 'VERIFY',
]);

export const FUNCTION_KEYWORDS = new Set([
  'ABS', 'ACS', 'AND', 'ASN', 'ATN', 'ATTR', 'BIN', 'CHR$', 'CODE',
  'COS', 'EXP', 'FN', 'IN', 'INKEY$', 'INT', 'LEN', 'LINE', 'LN',
  'NOT', 'OR', 'PEEK', 'PI', 'POINT', 'RND', 'SCREEN$', 'SGN', 'SIN',
  'SQR', 'STR$', 'TAN', 'USR', 'VAL', 'VAL$',
]);

/**
 * Detokenize a BASIC program buffer into an array of lines.
 * @param {Buffer} data - Raw BASIC program data
 * @param {number} variablesOffset - Offset where variables area starts (from header param2)
 * @returns {Array<{lineNumber: number, text: string, tokens: Array}>}
 */
export function detokenize(data, variablesOffset) {
  const lines = [];
  let pos = 0;

  // Only parse up to the variables area if specified
  const programEnd = variablesOffset && variablesOffset < data.length
    ? variablesOffset
    : data.length;

  while (pos < programEnd) {
    if (pos + 4 > programEnd) break;

    // Line number is big-endian
    const lineNumber = data.readUInt16BE(pos);
    const lineLen = data.readUInt16LE(pos + 2);

    if (lineNumber === 0 && lineLen === 0) break;
    if (lineNumber > 9999) break; // Likely hit variables area

    const lineStart = pos + 4;
    const lineEnd = Math.min(lineStart + lineLen, programEnd);

    const { text, tokens } = decodeLine(data, lineStart, lineEnd);
    lines.push({ lineNumber, text, tokens });

    pos = lineStart + lineLen;
  }

  return lines;
}

/**
 * Decode a single BASIC line from tokenized bytes.
 * @param {Buffer} data
 * @param {number} start
 * @param {number} end
 * @returns {{ text: string, tokens: Array<{type: string, text: string}> }}
 */
function decodeLine(data, start, end) {
  let text = '';
  const tokens = [];
  let i = start;
  let inRem = false;

  while (i < end) {
    const byte = data[i];

    // End of line
    if (byte === 0x0d) {
      break;
    }

    // After REM, everything is literal text (no token expansion)
    if (inRem) {
      if (byte === 0x0e) {
        // Skip embedded number in REM
        i += 6;
        continue;
      }
      const ch = mapCharacter(byte);
      text += ch;
      tokens.push({ type: 'text', text: ch });
      i++;
      continue;
    }

    // Embedded floating-point number: 0x0E + 5 bytes
    if (byte === 0x0e) {
      i += 6; // skip marker + 5 FP bytes
      continue;
    }

    // Color control codes with 1 parameter byte
    if (byte >= 0x10 && byte <= 0x15) {
      i += 2; // skip control + param
      continue;
    }

    // AT control: 2 parameter bytes
    if (byte === 0x16) {
      i += 3;
      continue;
    }

    // TAB control: 2 parameter bytes
    if (byte === 0x17) {
      i += 3;
      continue;
    }

    // Other control codes (0x00-0x09, 0x0B-0x0F, 0x18-0x1F)
    if (byte < 0x20) {
      i++;
      continue;
    }

    // Token (BASIC keyword)
    if (byte >= 0xa5) {
      const keyword = TOKENS[byte] || `[?${byte.toString(16)}]`;
      text += keyword;
      const kw = keyword.trim();
      if (STATEMENT_KEYWORDS.has(kw)) {
        tokens.push({ type: 'statement', text: keyword });
      } else if (FUNCTION_KEYWORDS.has(kw)) {
        tokens.push({ type: 'function', text: keyword });
      } else {
        tokens.push({ type: 'operator', text: keyword });
      }
      if (byte === 0xea) { // REM
        inRem = true;
      }
      i++;
      continue;
    }

    // UDG characters (0x90-0xA4)
    if (byte >= 0x90 && byte <= 0xa4) {
      const udgLetter = String.fromCharCode(0x41 + (byte - 0x90)); // A-U
      const ch = `[UDG-${udgLetter}]`;
      text += ch;
      tokens.push({ type: 'udg', text: ch });
      i++;
      continue;
    }

    // Block graphics (0x80-0x8F)
    if (byte >= 0x80 && byte <= 0x8f) {
      const ch = mapBlockGraphic(byte);
      text += ch;
      tokens.push({ type: 'graphic', text: ch });
      i++;
      continue;
    }

    // Regular printable characters
    const ch = mapCharacter(byte);
    text += ch;
    tokens.push({ type: 'text', text: ch });
    i++;
  }

  return { text, tokens };
}

/**
 * Map a ZX Spectrum character code to a display character.
 */
function mapCharacter(byte) {
  if (byte === 0x60) return '\u00A3'; // Pound sign
  if (byte === 0x7f) return '\u00A9'; // Copyright
  if (byte === 0x5e) return '\u2191'; // Up arrow (exponentiation)
  if (byte >= 0x20 && byte <= 0x7e) return String.fromCharCode(byte);
  return '';
}

/**
 * Map block graphic characters (0x80-0x8F) to Unicode block elements.
 * Each character is a 2x2 grid of quadrants.
 */
function mapBlockGraphic(byte) {
  // The 4 bits of (byte - 0x80) represent the 4 quadrants:
  // bit 0 = top-left, bit 1 = top-right, bit 2 = bottom-left, bit 3 = bottom-right
  const BLOCK_CHARS = [
    ' ',        // 0: empty
    '\u2598',   // 1: top-left
    '\u259D',   // 2: top-right
    '\u2580',   // 3: top half
    '\u2596',   // 4: bottom-left
    '\u258C',   // 5: left half
    '\u259E',   // 6: top-right + bottom-left
    '\u259B',   // 7: top + bottom-left
    '\u2597',   // 8: bottom-right
    '\u259A',   // 9: top-left + bottom-right
    '\u2590',   // 10: right half
    '\u259C',   // 11: top + bottom-right
    '\u2584',   // 12: bottom half
    '\u2599',   // 13: left + bottom-right
    '\u259F',   // 14: bottom + top-right
    '\u2588',   // 15: full block
  ];
  return BLOCK_CHARS[byte - 0x80] || '\u2588';
}
