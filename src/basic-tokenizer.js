/**
 * ZX Spectrum BASIC tokenizer ("zmakebas").
 *
 * Converts plain-text BASIC lines back into tokenized binary format
 * suitable for embedding in a TAP file.
 *
 * Tokenization algorithm based on zmakebas by Russell Marks / Chris Young:
 *   https://github.com/chris-y/zmakebas
 *
 * The approach:
 *  1. Create a lowercase copy of the line with quoted strings blanked out
 *  2. Scan for keywords longest-first, only matching at non-alpha boundaries
 *  3. Replace matched keywords in-place (so shorter keywords can't match inside)
 *  4. Output pass: emit token bytes, handle numbers, UDGs, and special chars
 */

// Complete reverse token map: keyword string -> byte value
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
const SORTED_KEYWORDS = Object.keys(KEYWORD_TO_BYTE)
  .sort((a, b) => b.length - a.length);

// Infix keywords whose token representation includes surrounding spaces
// in the detokenizer output (e.g., ' THEN ', ' OR ', ' AND ')
const INFIX_KEYWORDS = new Set(['OR', 'AND', 'THEN', 'TO', 'STEP', 'LINE']);

function isAlpha(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

/**
 * Tokenize a single line of BASIC text (without line number).
 * Uses the zmakebas approach: in-place keyword replacement on a working copy,
 * then an output pass that emits the final bytes.
 *
 * @param {string} text - The BASIC line text (e.g., 'LET x=5')
 * @returns {Buffer}
 */
export function tokenizeLine(text) {
  // Phase 1: Create a working copy for keyword matching.
  // - Prepend a space so boundary checks at position 0 are safe.
  // - Lowercase for case-insensitive matching.
  // - Blank out quoted string contents (replace with spaces).
  const padded = ' ' + text;
  const chars = Array.from(padded);
  const work = Array.from(padded.toLowerCase());

  // Blank out string contents in the working copy
  let inStr = false;
  for (let i = 1; i < work.length; i++) {
    if (work[i] === '"') {
      inStr = !inStr;
    } else if (inStr) {
      work[i] = ' ';
    }
  }

  // Find REM and blank out everything after it
  let remPos = -1;
  for (let i = 1; i < work.length - 2; i++) {
    if (work[i] === 'r' && work[i + 1] === 'e' && work[i + 2] === 'm' &&
        !isAlpha(work[i - 1]) && (i + 3 >= work.length || !isAlpha(work[i + 3]))) {
      remPos = i;
      for (let j = i + 3; j < work.length; j++) {
        work[j] = ' ';
      }
      break;
    }
  }

  // Phase 2: Match and replace keywords in the working copy.
  // Array to hold token assignments: tokenMap[i] = token byte or 0 (not a token)
  // We use a parallel array to mark which positions have been consumed by tokens.
  const tokenMap = new Array(padded.length).fill(0);
  const consumed = new Array(padded.length).fill(false);

  for (const kw of SORTED_KEYWORDS) {
    const kwLower = kw.toLowerCase();
    const kwLen = kw.length;

    // Operator tokens (<=, >=, <>) don't need alpha boundary checks
    const isOperator = kw === '<=' || kw === '>=' || kw === '<>';

    let searchFrom = 1; // skip the prepended space
    while (searchFrom < work.length) {
      const pos = work.join('').indexOf(kwLower, searchFrom);
      if (pos < 1) break; // not found or at prepended space

      // Check that this position hasn't been consumed by a longer keyword
      let alreadyConsumed = false;
      for (let j = pos; j < pos + kwLen; j++) {
        if (consumed[j]) { alreadyConsumed = true; break; }
      }
      if (alreadyConsumed) {
        searchFrom = pos + 1;
        continue;
      }

      const charBefore = work[pos - 1];
      const charAfter = pos + kwLen < work.length ? work[pos + kwLen] : '';

      let match = false;
      if (isOperator) {
        match = true;
      } else {
        // zmakebas rule: match only if both adjacent chars are non-alpha
        match = !isAlpha(charBefore) && !isAlpha(charAfter);
      }

      // Immediate guard: followed by '=' means it's a variable assignment target
      // Exception: keywords ending in $ (INKEY$, STR$, CHR$, etc.) are always
      // unambiguous — they can never be variable names.
      const endsWithDollar = kw.endsWith('$');
      if (match && !isOperator && !endsWithDollar) {
        const realCharAfter = pos + kwLen < padded.length ? padded[pos + kwLen] : '';
        if (realCharAfter === '=' && (pos + kwLen + 1 >= padded.length || (padded[pos + kwLen + 1] !== '>' && padded[pos + kwLen + 1] !== '<'))) {
          match = false;
        }
        // Followed by arithmetic/punctuation = variable in expression
        if (match && /[\-+*/;)<>:]/.test(realCharAfter)) {
          match = false;
        }
        // Infix keywords need space boundaries, not operator chars
        if (match && INFIX_KEYWORDS.has(kw)) {
          if (/[(*><=]/.test(charBefore) || /[)*><=+\-,;]/.test(realCharAfter)) {
            match = false;
          }
        }
      }

      if (match) {
        tokenMap[pos] = KEYWORD_TO_BYTE[kw];
        consumed[pos] = true;
        for (let j = pos + 1; j < pos + kwLen; j++) {
          consumed[j] = true;
          work[j] = '\x01'; // destroy so shorter keywords can't match here
        }
        work[pos] = '\x01';
        searchFrom = pos + kwLen;
      } else {
        searchFrom = pos + 1;
      }
    }
  }

  // Phase 2b: Post-replacement context pass.
  // Now that ALL keywords are matched, check for context-dependent cases
  // that need to be un-matched (reverted to variable names).
  // This handles cases where the context keyword (e.g., USR) was matched
  // AFTER the variable keyword (e.g., PRINT) due to length-based ordering.
  for (let pos = 1; pos < tokenMap.length; pos++) {
    if (!tokenMap[pos]) continue;
    const tokenByte = tokenMap[pos];
    // Skip operator tokens
    if (tokenByte === 0xc7 || tokenByte === 0xc8 || tokenByte === 0xc9) continue;

    const kw = Object.keys(KEYWORD_TO_BYTE).find(k => KEYWORD_TO_BYTE[k] === tokenByte);
    if (!kw) continue;
    // Keywords ending in $ are always unambiguous — never variable names
    if (kw.endsWith('$')) continue;
    const kwLen = kw.length;

    // Check: is this keyword preceded by LET/FOR/READ/DIM? → variable name
    let inLetContext = false;
    for (let j = pos - 1; j >= 1; j--) {
      if (tokenMap[j]) {
        if (tokenMap[j] === 0xf1 || tokenMap[j] === 0xeb || // LET, FOR
            tokenMap[j] === 0xe3 || tokenMap[j] === 0xe9) { // READ, DIM
          inLetContext = true;
        }
        break;
      }
      if (padded[j] === ' ') continue;
      break;
    }
    if (inLetContext) {
      // Revert: this was a variable name, not a keyword
      tokenMap[pos] = 0;
      consumed[pos] = false;
      for (let j = pos + 1; j < pos + kwLen && j < work.length; j++) {
        consumed[j] = false;
      }
      continue;
    }

    // Check: keyword used as a value (preceded by USR, PEEK, =, +, etc.)
    // Scan backwards, skipping spaces and consumed bytes, looking for
    // the nearest meaningful context.
    const realCharAfter = pos + kwLen < padded.length ? padded[pos + kwLen] : '';
    if (realCharAfter === '' || realCharAfter === ':' || realCharAfter === '\n') {
      let revert = false;
      for (let j = pos - 1; j >= 1; j--) {
        if (padded[j] === ' ') continue;
        if (consumed[j]) {
          // This position was consumed by a keyword replacement.
          // Check if it's the START of a token (has a tokenMap entry).
          if (tokenMap[j]) {
            if (tokenMap[j] === 0xc0 || tokenMap[j] === 0xbe) { // USR, PEEK
              revert = true;
            }
            break;
          }
          // Otherwise it's a filler byte from a multi-char keyword — skip it
          continue;
        }
        // Non-consumed, non-space char
        if (/[=+\-*/,(]/.test(padded[j])) {
          revert = true;
        }
        break;
      }
      if (revert) {
        tokenMap[pos] = 0;
        consumed[pos] = false;
        for (let k = pos + 1; k < pos + kwLen && k < work.length; k++) consumed[k] = false;
      }
    }
  }

  // Phase 3: Output pass. Walk the original text (with prepended space)
  // and emit bytes.
  const bytes = [];
  let i = 1; // skip the prepended space

  while (i < chars.length) {
    // Check for [UDG-X] notation
    const remaining = padded.substring(i);
    const udgMatch = remaining.match(/^\[UDG-([A-U])\]/);
    if (udgMatch) {
      bytes.push(0x90 + (udgMatch[1].charCodeAt(0) - 0x41));
      i += udgMatch[0].length;
      continue;
    }

    // If this position is a token
    if (tokenMap[i]) {
      const tokenByte = tokenMap[i];
      const kw = Object.keys(KEYWORD_TO_BYTE).find(k => KEYWORD_TO_BYTE[k] === tokenByte);
      const kwLen = kw ? kw.length : 1;
      const isInfix = kw && INFIX_KEYWORDS.has(kw);

      // For infix keywords, consume the surrounding spaces.
      // The detokenizer adds them, so we absorb them from the source.
      if (isInfix) {
        // Remove leading space we already emitted
        if (bytes.length > 0 && bytes[bytes.length - 1] === 0x20) {
          bytes.pop();
        }
      }

      bytes.push(tokenByte);
      i += kwLen;

      // Consume trailing space after keyword if present in source
      // (the detokenizer adds a trailing space for most keywords)
      if (i < chars.length && chars[i] === ' ') {
        i++;
      }

      // After REM, everything is literal
      if (tokenByte === 0xea) {
        while (i < chars.length) {
          const udgRem = padded.substring(i).match(/^\[UDG-([A-U])\]/);
          if (udgRem) {
            bytes.push(0x90 + (udgRem[1].charCodeAt(0) - 0x41));
            i += udgRem[0].length;
          } else {
            bytes.push(mapCharToByte(chars[i]));
            i++;
          }
        }
      }

      continue;
    }

    // Skip consumed filler bytes (from multi-char keyword replacements)
    if (consumed[i]) {
      i++;
      continue;
    }

    const ch = chars[i];

    // Quoted strings: emit everything verbatim until closing quote
    if (ch === '"') {
      bytes.push(0x22);
      i++;
      while (i < chars.length) {
        const udgStr = padded.substring(i).match(/^\[UDG-([A-U])\]/);
        if (udgStr) {
          bytes.push(0x90 + (udgStr[1].charCodeAt(0) - 0x41));
          i += udgStr[0].length;
          continue;
        }
        bytes.push(mapCharToByte(chars[i]));
        if (chars[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Number literal: emit ASCII digits, then 0x0E + 5-byte float
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < chars.length && /[0-9]/.test(chars[i + 1]))) {
      // Don't treat as number if preceded by a letter (it's part of a variable name like a2)
      const prevCh = i > 1 ? chars[i - 1] : '';
      if (isAlpha(prevCh) || prevCh === '$') {
        bytes.push(mapCharToByte(ch));
        i++;
        continue;
      }

      const numStart = i;
      let numStr = '';
      while (i < chars.length && /[0-9.eE+\-]/.test(chars[i])) {
        if ((chars[i] === '+' || chars[i] === '-') && i > numStart &&
            chars[i - 1] !== 'e' && chars[i - 1] !== 'E') {
          break;
        }
        numStr += chars[i];
        i++;
      }

      // Emit ASCII representation
      for (const c of numStr) {
        bytes.push(c.charCodeAt(0));
      }

      // Emit 0x0E + 5-byte float
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
    variablesOffset: totalLen,
  };
}

/**
 * Map a display character to its ZX Spectrum byte value.
 */
function mapCharToByte(ch) {
  if (ch === '\u00A3') return 0x60; // £
  if (ch === '\u00A9') return 0x7f; // ©
  if (ch === '\u2191') return 0x5e; // ↑ (exponentiation)
  const code = ch.charCodeAt(0);
  if (code >= 0x20 && code <= 0x7f) return code;
  return 0x20;
}

/**
 * Encode a number into ZX Spectrum 5-byte floating point format.
 *
 * @param {number} num
 * @returns {number[]} 5 bytes
 */
export function encodeZxFloat(num) {
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

  const expByte = exp + 128;

  if (expByte < 0 || expByte > 255) {
    return [0x00, 0x00, 0x00, 0x00, 0x00];
  }

  let m = absNum * 256;
  const m1 = Math.floor(m);
  m = (m - m1) * 256;
  const m2 = Math.floor(m);
  m = (m - m2) * 256;
  const m3 = Math.floor(m);
  m = (m - m3) * 256;
  const m4 = Math.floor(m + 0.5);

  const byte1 = (m1 & 0x7f) | (sign ? 0x80 : 0x00);

  return [expByte, byte1, m2, m3, m4];
}
