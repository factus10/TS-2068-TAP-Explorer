/**
 * ZX Spectrum BASIC tokenizer ("zmakebas").
 *
 * Converts plain-text BASIC lines back into tokenized binary format
 * suitable for embedding in a TAP file.
 */

// Complete reverse token map: keyword string → byte value
// Built from the detokenizer's TOKENS table, trimmed of surrounding whitespace.
// We also include variants with/without surrounding spaces so matching is flexible.
const KEYWORD_TO_BYTE = {
  'SPECTRUM': 0xa3,
  'PLAY': 0xa4,
  'RND': 0xa5,
  'INKEY$': 0xa6,
  'PI': 0xa7,
  'FN': 0xa8,
  'POINT': 0xa9,
  'SCREEN$': 0xaa,
  'ATTR': 0xab,
  'AT': 0xac,
  'TAB': 0xad,
  'VAL$': 0xae,
  'CODE': 0xaf,
  'VAL': 0xb0,
  'LEN': 0xb1,
  'SIN': 0xb2,
  'COS': 0xb3,
  'TAN': 0xb4,
  'ASN': 0xb5,
  'ACS': 0xb6,
  'ATN': 0xb7,
  'LN': 0xb8,
  'EXP': 0xb9,
  'INT': 0xba,
  'SQR': 0xbb,
  'SGN': 0xbc,
  'ABS': 0xbd,
  'PEEK': 0xbe,
  'IN': 0xbf,
  'USR': 0xc0,
  'STR$': 0xc1,
  'CHR$': 0xc2,
  'NOT': 0xc3,
  'BIN': 0xc4,
  'OR': 0xc5,
  'AND': 0xc6,
  '<=': 0xc7,
  '>=': 0xc8,
  '<>': 0xc9,
  'LINE': 0xca,
  'THEN': 0xcb,
  'TO': 0xcc,
  'STEP': 0xcd,
  'DEF FN': 0xce,
  'CAT': 0xcf,
  'FORMAT': 0xd0,
  'MOVE': 0xd1,
  'ERASE': 0xd2,
  'OPEN #': 0xd3,
  'CLOSE #': 0xd4,
  'MERGE': 0xd5,
  'VERIFY': 0xd6,
  'BEEP': 0xd7,
  'CIRCLE': 0xd8,
  'INK': 0xd9,
  'PAPER': 0xda,
  'FLASH': 0xdb,
  'BRIGHT': 0xdc,
  'INVERSE': 0xdd,
  'OVER': 0xde,
  'OUT': 0xdf,
  'LPRINT': 0xe0,
  'LLIST': 0xe1,
  'STOP': 0xe2,
  'READ': 0xe3,
  'DATA': 0xe4,
  'RESTORE': 0xe5,
  'NEW': 0xe6,
  'BORDER': 0xe7,
  'CONTINUE': 0xe8,
  'DIM': 0xe9,
  'REM': 0xea,
  'FOR': 0xeb,
  'GO TO': 0xec,
  'GO SUB': 0xed,
  'INPUT': 0xee,
  'LOAD': 0xef,
  'LIST': 0xf0,
  'LET': 0xf1,
  'PAUSE': 0xf2,
  'NEXT': 0xf3,
  'POKE': 0xf4,
  'PRINT': 0xf5,
  'PLOT': 0xf6,
  'RUN': 0xf7,
  'SAVE': 0xf8,
  'RANDOMIZE': 0xf9,
  'IF': 0xfa,
  'CLS': 0xfb,
  'DRAW': 0xfc,
  'CLEAR': 0xfd,
  'RETURN': 0xfe,
  'COPY': 0xff,
};

// Keywords sorted by length descending for longest-match-first tokenization.
// This ensures "GO TO" matches before "GO", "SCREEN$" before "SCREEN", etc.
const SORTED_KEYWORDS = Object.keys(KEYWORD_TO_BYTE)
  .sort((a, b) => b.length - a.length);

/**
 * Tokenize a single line of BASIC text (without line number).
 * Returns a Buffer of tokenized bytes (including trailing 0x0D).
 *
 * @param {string} text - The BASIC line text (e.g., 'LET x=5')
 * @returns {Buffer}
 */
export function tokenizeLine(text) {
  const bytes = [];
  let i = 0;
  let inQuote = false;
  let afterRem = false;
  // After LET/FOR/DIM/DEF FN/INPUT, the next word is a variable name, not a keyword.
  // We suppress keyword matching until we hit '=', '(', ',', ':', or end of line.
  let inVarName = false;

  while (i < text.length) {
    const ch = text[i];

    // In variable name context: emit as literal until we hit a delimiter
    if (inVarName) {
      if (ch === '=' || ch === '(' || ch === ')' || ch === ',' || ch === ':' || ch === ';' || ch === ' ') {
        inVarName = false;
        // Fall through to normal processing for this character
      } else {
        bytes.push(mapCharToByte(ch));
        i++;
        continue;
      }
    }

    // Check for [UDG-X] notation anywhere (outside quotes too)
    const udgMatch = text.substring(i).match(/^\[UDG-([A-U])\]/);
    if (udgMatch) {
      const udgByte = 0x90 + (udgMatch[1].charCodeAt(0) - 0x41);
      bytes.push(udgByte);
      i += udgMatch[0].length;
      continue;
    }

    // After REM keyword, everything is literal text
    if (afterRem) {
      bytes.push(mapCharToByte(ch));
      i++;
      continue;
    }

    // Inside a quoted string, emit raw characters
    if (inQuote) {
      // Check for [UDG-X] notation
      const udgMatch = text.substring(i).match(/^\[UDG-([A-U])\]/);
      if (udgMatch) {
        const udgByte = 0x90 + (udgMatch[1].charCodeAt(0) - 0x41);
        bytes.push(udgByte);
        i += udgMatch[0].length;
        continue;
      }
      bytes.push(mapCharToByte(ch));
      if (ch === '"') {
        inQuote = false;
      }
      i++;
      continue;
    }

    // Opening quote
    if (ch === '"') {
      inQuote = true;
      bytes.push(0x22);
      i++;
      continue;
    }

    // Try to match a keyword (case-insensitive, longest first)
    const remaining = text.substring(i);
    const upperRemaining = remaining.toUpperCase();
    let matched = false;

    for (const kw of SORTED_KEYWORDS) {
      if (upperRemaining.startsWith(kw)) {
        // Ensure we're not matching a keyword inside a longer identifier.
        // E.g., don't match "IN" inside "INPUT" - but INPUT is a longer keyword
        // so it matches first. Edge case: don't match "AT" in "DATA" - but
        // we check that the character before (if any) isn't a letter.
        const afterKw = i + kw.length;
        const charAfter = afterKw < text.length ? text[afterKw] : '';
        const charBefore = i > 0 ? text[i - 1] : '';

        // For multi-char operator tokens (<=, >=, <>), always match
        if (kw === '<=' || kw === '>=' || kw === '<>') {
          bytes.push(KEYWORD_TO_BYTE[kw]);
          i += kw.length;
          matched = true;
          break;
        }

        // For letter-based keywords, only match at word boundaries.
        // Check before: don't match if preceded by a letter (e.g., "RAND" matching "AND")
        if (/[A-Za-z]/.test(charBefore) && !/\s/.test(kw[0])) {
          continue;
        }
        // Check after: don't match if followed by a letter/digit that would
        // make this part of a variable name (e.g., "IN" inside "INV", "TO" inside "TOT")
        // Exception: keywords ending in $ (INKEY$, STR$, etc.) are always unambiguous
        if (/[A-Za-z]/.test(kw[kw.length - 1]) && /[A-Za-z0-9]/.test(charAfter)) {
          continue;
        }

        // Infix keywords (OR, AND, THEN, TO, STEP, LINE) are output by the
        // detokenizer with surrounding spaces (e.g., ' THEN '). The token byte
        // already encodes these spaces, so consume them from the source text.
        const INFIX_KEYWORDS = new Set(['OR', 'AND', 'THEN', 'TO', 'STEP', 'LINE']);
        const isInfix = INFIX_KEYWORDS.has(kw);

        // Infix keywords (OR, AND, TO, etc.) require spaces around them in source.
        // Without spaces, they're variable names (e.g., "or", "to" as variables).
        if (isInfix) {
          // Must be preceded by a space (or start of line)
          if (i > 0 && charBefore !== ' ') {
            continue;
          }
          // Must be followed by a space (or end of line)
          if (charAfter !== '' && charAfter !== ' ') {
            continue;
          }
        }

        // Short function keywords (LEN, IN, AT, FN, VAL, etc.) used as variable
        // names: if followed by an operator like =, +, -, *, /, ), they're likely
        // variables, not functions. Functions are followed by space or '('.
        const FUNCTION_KW = new Set(['LEN', 'IN', 'AT', 'FN', 'VAL', 'SGN', 'ABS',
          'INT', 'SQR', 'SIN', 'COS', 'TAN', 'ASN', 'ACS', 'ATN', 'LN', 'EXP',
          'NOT', 'BIN', 'PEEK', 'USR', 'CODE', 'STR$', 'CHR$', 'VAL$']);
        if (FUNCTION_KW.has(kw) && charAfter !== ' ' && charAfter !== '(' && charAfter !== '') {
          // Followed by an operator — likely a variable name, not a function call
          if (/[=+\-*/;,)<>]/.test(charAfter)) {
            continue;
          }
        }

        // For infix keywords, consume a leading space if present
        if (isInfix && i > 0 && text[i - 1] === ' ') {
          // Remove the trailing space we already emitted as a literal byte
          if (bytes.length > 0 && bytes[bytes.length - 1] === 0x20) {
            bytes.pop();
          }
        }

        const tokenByte = KEYWORD_TO_BYTE[kw];
        bytes.push(tokenByte);
        i += kw.length;

        // Consume trailing space after keyword if present in source
        if (i < text.length && text[i] === ' ') {
          if (isInfix) {
            // Infix: consume trailing space (token includes it)
            i++;
          } else {
            // Regular keyword: consume trailing space (detokenizer adds it)
            i++;
          }
        }

        if (kw === 'REM') {
          afterRem = true;
        }

        // After variable-assignment keywords, next word is a variable name
        if (kw === 'LET' || kw === 'FOR' || kw === 'DIM' || kw === 'DEF FN' || kw === 'READ') {
          inVarName = true;
        }

        matched = true;
        break;
      }
    }

    if (matched) continue;

    // Number literal: emit ASCII digits, then 0x0E + 5-byte float
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < text.length && /[0-9]/.test(text[i + 1]))) {
      const numStart = i;
      // Consume the number text (digits, decimal point, E notation)
      let numStr = '';
      while (i < text.length && /[0-9.eE+\-]/.test(text[i])) {
        // Be careful with E notation: only consume +/- if preceded by E/e
        if ((text[i] === '+' || text[i] === '-') && i > numStart &&
            text[i - 1] !== 'e' && text[i - 1] !== 'E') {
          break;
        }
        numStr += text[i];
        i++;
      }

      // Emit the ASCII representation
      for (const c of numStr) {
        bytes.push(c.charCodeAt(0));
      }

      // Emit 0x0E + 5-byte floating point
      const numVal = parseFloat(numStr);
      if (!isNaN(numVal)) {
        bytes.push(0x0e);
        const fpBytes = encodeZxFloat(numVal);
        bytes.push(...fpBytes);
      }

      continue;
    }

    // Regular character
    bytes.push(mapCharToByte(ch));
    i++;
  }

  // Line terminator
  bytes.push(0x0d);

  return Buffer.from(bytes);
}

/**
 * Tokenize a complete BASIC program from an array of lines.
 *
 * @param {Array<{lineNumber: number, text: string}>} lines
 * @returns {{ programBuffer: Buffer, variablesOffset: number }}
 */
export function tokenizeProgram(lines) {
  const parts = [];
  let totalLen = 0;

  for (const line of lines) {
    const tokenized = tokenizeLine(line.text);

    // Line header: line number (2 bytes BE) + line length (2 bytes LE)
    const lineHeader = Buffer.alloc(4);
    lineHeader.writeUInt16BE(line.lineNumber, 0);
    lineHeader.writeUInt16LE(tokenized.length, 2);

    parts.push(lineHeader);
    parts.push(tokenized);
    totalLen += 4 + tokenized.length;
  }

  const programBuffer = Buffer.concat(parts, totalLen);
  return {
    programBuffer,
    variablesOffset: totalLen, // No variables in a freshly tokenized program
  };
}

/**
 * Map a display character to its ZX Spectrum byte value.
 */
function mapCharToByte(ch) {
  if (ch === '\u00A3') return 0x60; // £ → pound sign position
  if (ch === '\u00A9') return 0x7f; // © → copyright position
  if (ch === '\u2191') return 0x5e; // ↑ → up arrow (exponentiation)
  const code = ch.charCodeAt(0);
  if (code >= 0x20 && code <= 0x7f) return code;
  return 0x20; // Unknown chars → space
}

/**
 * Encode a number into ZX Spectrum 5-byte floating point format.
 *
 * @param {number} num
 * @returns {number[]} 5 bytes
 */
export function encodeZxFloat(num) {
  // Special case: zero
  if (num === 0) {
    return [0x00, 0x00, 0x00, 0x00, 0x00];
  }

  // Integer shortcut: integers in range -65535..65535
  if (Number.isInteger(num) && num >= -65535 && num <= 65535) {
    const sign = num < 0 ? 0xff : 0x00;
    const absVal = Math.abs(num);
    return [0x00, sign, absVal & 0xff, (absVal >> 8) & 0xff, 0x00];
  }

  // Full floating point encoding
  const sign = num < 0 ? 1 : 0;
  let absNum = Math.abs(num);

  // Find exponent: normalize so 0.5 <= mantissa < 1.0
  let exp = 0;
  if (absNum >= 1) {
    while (absNum >= 1) {
      absNum /= 2;
      exp++;
    }
  } else {
    while (absNum < 0.5) {
      absNum *= 2;
      exp--;
    }
  }

  // Exponent byte is biased by 128 (0x80)
  const expByte = exp + 128;

  if (expByte < 0 || expByte > 255) {
    // Overflow/underflow - return zero
    return [0x00, 0x00, 0x00, 0x00, 0x00];
  }

  // Mantissa: 4 bytes
  // The leading 1 bit is implicit (replaced by sign bit)
  let m = absNum * 256; // First mantissa byte
  const m1 = Math.floor(m);
  m = (m - m1) * 256;
  const m2 = Math.floor(m);
  m = (m - m2) * 256;
  const m3 = Math.floor(m);
  m = (m - m3) * 256;
  const m4 = Math.floor(m + 0.5); // Round last byte

  // Set sign bit (bit 7 of first mantissa byte) and clear the implied 1 bit
  const byte1 = (m1 & 0x7f) | (sign ? 0x80 : 0x00);

  return [expByte, byte1, m2, m3, m4];
}
