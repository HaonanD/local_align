# local_align

local_align is a single-file, offline protein multiple sequence alignment tool. I built it because I use UniProt's Align service regularly, but network and server availability often turn a small alignment job into a long wait. For a handful of sequences, MSA is a small computation, the aligner is small, and all the code is open source. Running it locally is much faster. So I compiled [Clustal Omega 1.2.4](https://github.com/GSLBiotech/clustal-omega) to WebAssembly and wrapped it in one HTML file, reproducing the core UniProt Align workflow: paste FASTA, align, inspect the alignment, guide tree, and percent identity matrix, then export the result.

## Features

- Real [Clustal Omega 1.2.4](https://github.com/GSLBiotech/clustal-omega) compiled to `wasm32-wasi`; not a JavaScript reimplementation.
- **One HTML file**, fully offline. No CDN, no server, no external requests.
- Three result tabs:
  - **Alignment** — conservation-shaded alignment, gap cells, row-end residue positions.
  - **Phylogenetic tree** — SVG guide tree from Clustal Omega's Newick output.
  - **Identity matrix** — percent identity heatmap, downloadable as CSV.
- Sequence order:
  - **Input order** — keep the FASTA order.
  - **From alignment** — use Clustal Omega's tree order so similar sequences are adjacent.
- Exports: aligned FASTA, CLUSTAL alignment, Newick tree, identity matrix CSV.
- Sequence names use the first token of each FASTA header.
- Runs locally; input sequences never leave the browser.

## Quick start

Download [`local_align.html`](local_align.html), or open the deployed page: https://haonand.github.io/local_align/.

## Implementation

- Clustal Omega 1.2.4 is compiled with **Zig 0.13.0** for `wasm32-wasi`.
- OpenMP is disabled; only the CLI alignment path is used.
- A small JavaScript WASI preview1 shim provides the file, argument, clock, and stdio calls needed by the binary.
- The stripped WASM payload is embedded as base64 inside the HTML.
- The alignment view, tree, and matrix are rendered with plain DOM/SVG; there is no frontend framework.

Approximate size:

- HTML: ~1 MB
- Embedded WASM: ~686 KB

## Project layout

```text
local_align.html          # the complete application
README.md                 # this file
build/
  app-template.html       # HTML/CSS/JS template
  mini-wasi.js            # WASI preview1 shim
  clustalo-strip.wasm     # stripped Clustal Omega WASM
  build.js                # embeds the assets into local_align.html
```

## Build

```bash
cd build
node build.js
```

The output is written to `../local_align.html`.

## License

local_align bundles Clustal Omega 1.2.4, which is licensed under **GPL-2.0-or-later**. The wrapper and the combined work are distributed under the same license.

- Clustal Omega source: https://github.com/GSLBiotech/clustal-omega
- GPL-2.0 text: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html

If you redistribute `local_align.html`, provide the corresponding source and keep the license notices.
