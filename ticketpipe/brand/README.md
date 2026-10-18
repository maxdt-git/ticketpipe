# TicketPipe logo: the Tee

A sweep tee, the pipe fitting where two runs merge into one. **T** is for Ticket; the junction is where everything screenpipe saw comes together into one ticket. It is built from screenpipe's own vocabulary: fat pipe elbows, thin flush flanges and a hairline seam.

<p>
  <img src="png/app-icon-1024.png" width="120" alt="TicketPipe app icon">
  &nbsp;
  <img src="png/lockup-ink.png" height="72" alt="TicketPipe logo">
</p>

## Files

| File | Use |
|---|---|
| `mark-ink.svg` / `mark-bone.svg` | The Tee on its own, for light / dark backgrounds |
| `lockup-ink.svg` / `lockup-bone.svg` | Tee + "TicketPipe" wordmark (Space Grotesk 600, outlined) |
| `app-icon.svg` / `app-icon-dark.svg` | macOS-style squircle icons |
| `icon.svg` | Full-bleed rounded tile: favicon, app window icon, Linux launcher |
| `icon.icns` | macOS `.app` icon (copied into the bundle by `scripts/build.ts`) |
| `icon.ico` | Windows `.exe` icon, 16–256 px |
| `png/` | 1024 px marks, lockups, app icons and 16–512 px tiles |

## Where the app uses it

- **Header**: inline SVG in `public/index.html`, drawn with `currentColor` so it follows light and dark mode.
- **Favicon / app window icon**: `icon.svg` inlined as a data URI in `public/index.html`.
- **Linux launcher**: `--install` writes `icon.svg` next to the `.desktop` entry (`src/app.ts`).
- **macOS**: `TicketPipe.app/Contents/Resources/TicketPipe.icns` + `CFBundleIconFile`.
- **Windows**: `--windows-icon=brand/icon.ico`. Bun only supports this when the build runs on Windows; builds from macOS or Linux keep Bun's default `.exe` icon.

## Colours

| Token | Hex | Use |
|---|---|---|
| Ink | `#0A0A0A` | The mark on light grounds |
| Bone | `#F6F6F3` | The mark on dark grounds, icon tiles |
| Phosphor | `#C7FF3E` | Only while the AI is actively working, never on the logo at rest |

## Rules

- Keep the two halves, the seam and the flanges together. Don't rotate, stretch, outline or add gradients.
- Smallest size: 16 px for the mark; below 24 px drop the wordmark and use the mark alone.
- Leave clear space around the mark of at least a quarter of its width.
