# Third-party notices

## GNU Unifont

The bundled, unmodified `unifont_all-18.0.01.hex.gz` font is **not MIT-licensed**. It is distributed under the SIL Open Font License 1.1, one of the upstream dual-license options. The font copyright, original OFL text, exact source URL and checksum are preserved in [the font directory](assets/fonts/README.md).

Only font data is included. No GPL Unifont utility program is copied. Generated PNG documents are not licensed under OFL merely because they use the font. Font derivatives must retain the applicable font license and satisfy any reserved-name requirements.

## Design references

The optical text-compaction concept is inspired by [oh-my-pi snapcompact](https://github.com/can1357/oh-my-pi/tree/75e7801e247d4e3263439d4cc08ccad60dc64bdd/packages/snapcompact). This project uses its own small TypeScript renderer, not the upstream Bun/native renderer or its benchmark claims.

DSH integration uses the public `BasicCompactionEngine` extension seam from DeepSeek Harness (MIT). DSH packages remain peer dependencies supplied by the host; their source and licenses are not bundled into this package.

Original application code is covered by [LICENSE](LICENSE).
