# GNU Unifont 18.0.01 (unmodified font data)

This package redistributes GNU Unifont font data under the **SIL Open Font
License 1.1**, choosing that license from upstream's dual-license offer. The
original compressed hexadecimal font is distributed byte-for-byte, without
renaming, subsetting, or other modification. No GPL font-conversion or rendering
utilities are included; the TypeScript bitmap reader and rasterizer are original
implementations.

- Font: [unifont_all-18.0.01.hex.gz](./unifont_all-18.0.01.hex.gz)
- SHA-256: `14c96e497466a82e46cf20032ce510e186bdc8658c9158e2290f452cda9bc498`
- Original download: <https://unifoundry.com/pub/unifont/unifont-18.0.01/font-builds/unifont_all-18.0.01.hex.gz>
- Copyright and license source: <https://unifoundry.com/unifont/index.html>
- Upstream copyright notice: [UPSTREAM-COPYRIGHT.txt](./UPSTREAM-COPYRIGHT.txt)
- Original, unedited license text: [OFL-1.1.txt](./OFL-1.1.txt), downloaded from
  <https://unifoundry.com/OFL-1.1.txt>.

The preserved upstream notice credits Roman Czyborra, Paul Hardy, Qianqian Fang,
Andrew Miller, Johnnie Weaver, David Corbett, Ælla Chiana Moskopp, Rebecca
Bettencourt, Minseo Lee, Ho-Seok Ee, and other contributors (1998–2026). The notice
is retained from the same release's BDF metadata, including its original
alternative GPL licensing statement; this package elects OFL 1.1 for the font.

The renderer verifies the compressed font checksum before reading it. It uses
native 8×16 and 16×16 glyph bitmaps, does not perform complex shaping, and rejects
missing glyphs, combining sequences, contextual scripts, variation selectors,
emoji modifiers/flags/ZWJ sequences, and decomposed Hangul. Supported standalone
emoji are monochrome. Source spaces, indentation, and LF newlines are retained;
TAB, CR, ANSI/C0/C1 controls, bidi format controls, and invisible separators are
shown as literal ASCII escapes, never interpreted. Text is not normalized.

Frames use one-based inclusive source line ranges; wrapped lines can span frames.
An empty source has one empty line, and a trailing LF creates a final empty line.
Exceeding any frame/byte/source budget rejects the entire render rather than
returning a truncated image archive. Each `createRenderer()` instance admits one
active request and four queued requests. Plugin/preset owners must keep their own
instance and register `dispose()` with that owner's lifecycle; instances do not
share queues or workers, and there is no global compatibility instance. A request's
timeout includes queue wait and worker startup and cannot exceed 15 seconds;
cancellation/timeout of an active request terminates its worker before another
worker is started. Disposing permanently closes that instance and awaits worker
termination; later render calls reject with `DISPOSED`. A new plugin/preset
lifecycle must create a new renderer instance.
