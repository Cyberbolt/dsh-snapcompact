# Third-party notices

## GNU Unifont

The bundled, unmodified `unifont_all-18.0.01.hex.gz` font is **not MIT-licensed**. It is distributed under the SIL Open Font License 1.1, one of the upstream dual-license options. The font copyright, original OFL text, exact source URL and checksum are preserved in [the font directory](assets/fonts/README.md).

Only font data is included. No GPL Unifont utility program is copied. Generated PNG documents are not licensed under OFL merely because they use the font. Font derivatives must retain the applicable font license and satisfy any reserved-name requirements.

## Design references

The optical text-compaction concept is inspired by [oh-my-pi snapcompact](https://github.com/can1357/oh-my-pi/tree/75e7801e247d4e3263439d4cc08ccad60dc64bdd/packages/snapcompact). This project uses its own small TypeScript renderer, not the upstream Bun/native renderer or its benchmark claims.

The checkpoint `FILES` section follows the grouped, prefix-folded path-list shape used by oh-my-pi's file-operation summaries. The TypeScript extraction, parsing and rendering code in this package is local to this project.

DSH integration uses the public `BasicCompactionEngine` extension seam from DeepSeek Harness (MIT). DSH packages remain peer dependencies supplied by the host; their source and licenses are not bundled into this package.

Original application code is covered by [LICENSE](LICENSE).

## oh-my-pi snapcompact

The v5 serialization, foveated archive layout, stopword/tool-result dimming, and model-aware frame-shape ideas are adapted from [`@oh-my-pi/snapcompact`](https://github.com/can1357/oh-my-pi/tree/main/packages/snapcompact). The upstream package is MIT-licensed; this project uses its own TypeScript renderer and does not bundle the upstream Bun/native renderer.

```text
MIT License

Copyright (c) 2025-2026 Can Bölük
Copyright (c) 2026 Stencil Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
