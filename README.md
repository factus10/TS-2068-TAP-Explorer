# TAP Explorer

A cross-platform desktop application for viewing, editing, and assembling ZX Spectrum and Timex/Sinclair 2068 TAP tape image files.

Built with Electron. Runs on macOS, Windows, and Linux.

## Features

### TAP File Browser
- File system navigation panel with folder tree
- TAP files expand to show their internal block structure (header + data pairs)
- Block metadata display: type, filename, data length, parameters, checksum validation

### BASIC Program Viewer & Editor
- Full detokenization of ZX Spectrum BASIC programs with syntax highlighting
- Keyword coloring: statements (blue), functions (yellow), operators (orange)
- Line wrapping for long BASIC lines
- **Inline editing**: double-click any line to edit it
- Batch editing: modify multiple lines, then save once when done
- Saves edited programs as new TAP files (original is never modified)
- Correct tokenization including:
  - ZX Spectrum floating-point number encoding
  - UDG character support (`[UDG-A]` through `[UDG-U]`)
  - Context-aware keyword matching (distinguishes `or` the variable from `OR` the operator)
  - Proper handling of `N$CODE`, `INKEY$`, and other `$`-suffixed tokens

### DOS Command Detection
- Lines containing Oliger, Larken, or AERCO disk system commands are highlighted with a red border and `DOS` badge
- Detected patterns: `OUT 244,1` (ROM switch), `LOAD /` / `SAVE /` (RST 8 trap), `MOVE`, `CAT`, `ERASE`

### State Capture Support
- Reads TS 2068 state machine captures (~49K memory dumps stored as TAP type 4)
- Extracts BASIC programs using TS 2068 system variables (PROG, VARS, E_LINE at $5C00)
- Preserves the variables area so extracted programs run correctly
- Determines autostart line from `SAVE ... LINE` statements in the source
- Scrollable hex dump with virtual scrolling and go-to-address navigation
- Tested with Oliger and Larken disk system captures

### SCREEN$ Viewer
- Renders ZX Spectrum screen data (6912 bytes at address 16384) on a Canvas element
- Correct pixel de-interleaving and color attribute decoding
- Invert toggle (swap ink/paper)
- PNG export at 1x, 2x, 4x, or 8x resolution

### Hex Viewer
- Paginated hex dump for CODE blocks with address/hex/ASCII columns
- Scrollable virtual-scroll hex dump for large state captures
- Base address display from the TAP header
- Go-to-address navigation

### TAP Assembler
- Combine blocks from multiple TAP files in a folder into a single TAP
- Select individual header+data pairs or all blocks from a file
- Reorder entries with up/down controls
- Useful for building loadable tapes: loader + SCREEN$ + BASIC + CODE in the right order

### Data Array Viewer
- Decodes ZX Spectrum number arrays and character arrays
- Displays values in a table with index numbers

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later
- npm (included with Node.js)

### Install & Run
```bash
git clone https://github.com/factus10/TS-2068-TAP-Explorer.git
cd TS-2068-TAP-Explorer
npm install
npm start
```

### Usage
1. Click **Open Folder** (or `Cmd/Ctrl+O`) to navigate to a folder containing TAP files
2. Click a TAP file in the tree to see its block summary
3. Click the expand arrow on a TAP file to see individual blocks
4. Click a **data block** to view its contents (BASIC listing, hex dump, SCREEN$, etc.)
5. **Double-click** a BASIC line to edit it; press Enter to confirm, Escape to cancel
6. When done editing, click **Save TAP As...** in the orange banner
7. Use **File > TAP Assembler** (`Cmd/Ctrl+Shift+A`) to combine blocks from multiple files

## Building Installers

Builds are automated via GitHub Actions on every release tag. To build locally:

```bash
# macOS
npm run dist:mac

# Windows
npm run dist:win

# Linux
npm run dist:linux

# All platforms
npm run dist
```

Output goes to the `dist/` folder.

## TAP File Format

TAP files are a simple container format for ZX Spectrum tape data. Each file consists of sequential blocks:

```
[2-byte LE length][flag byte][content bytes][checksum byte]
```

- **Flag** `0x00` = header block, `0xFF` = data block
- **Headers** are 17 bytes: type (1) + filename (10) + data length (2) + param1 (2) + param2 (2)
- **Types**: 0 = Program, 1 = Number array, 2 = Character array, 3 = Bytes/Code
- **Checksum** = XOR of all bytes including the flag

### TS 2068 Extensions
- **Type 4+**: State machine captures (memory dumps from Oliger/Larken disk systems)
- System variables at `$5C00` provide PROG, VARS, and E_LINE pointers for BASIC extraction

## Project Structure

```
main.js                  Electron main process
preload.js               Context bridge (IPC API)
src/
  tap-parser.js           TAP binary format parser
  basic-detokenizer.js    BASIC token table + detokenizer
  basic-tokenizer.js      Text-to-tokenized BASIC converter
  screen-decoder.js       SCREEN$ pixel de-interleaving
  hex-formatter.js        Hex dump formatter
  tap-writer.js           TAP file assembly + rebuild
  ipc-handlers.js         All IPC handler implementations
renderer/
  index.html              Application shell
  css/style.css           All styles (dark theme)
  js/
    app.js                Main controller + splitter
    tree-view.js          File tree + TAP block expansion
    content-viewer.js     Content rendering + BASIC editing
    screen-renderer.js    Canvas SCREEN$ painter + PNG export
    hex-viewer.js         Hex dump (paginated + virtual scroll)
    tap-assembler.js      TAP file combiner UI
```

## Example Files

The `examples/` folder contains sample TAP files for testing:

| File | Type | Description |
|------|------|-------------|
| `letter.tap` | Program | BASIC animation program by Paul Taylor (1985) |
| `BUTTERFLY.tap` | State capture | Oliger disk capture with 1-line BASIC loader + machine code |
| `bridge.tap` | State capture | 456-line contract bridge game with full variable state |
| `qrlt.tap` | State capture | RLE graphics editor with Oliger DOS commands |

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
