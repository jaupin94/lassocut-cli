# lassocut CLI

Remove image backgrounds in bulk from the command line with the [lassocut API](https://www.lassocut.com/docs/).
One file, no dependencies, Node.js 18 or later.

```sh
export LASSOCUT_API_KEY=your-key
lassocut photo.jpg                                  # writes photo-removebg.png next to it
lassocut --output-directory out/ photos/            # every image in a folder
lassocut --size full --bg-color white "shots/*.jpg"
```

Coming from the remove.bg command-line tool? The flags are the same (`--size`, `--type`, `--format`,
`--channels`, `--bg-color`, `--bg-image-file`, `--output-directory`, `--reprocess-existing`,
`--confirm-batch-over`, `--extra-api-option`), results keep the `-removebg` file suffix, and
`REMOVE_BG_API_KEY` is read if `LASSOCUT_API_KEY` is not set. Replace the command name and the key.

New flags: `--api-url` (or `LASSOCUT_API_URL`), `--output-suffix`, `--concurrency` (default 4).
Rate limits (429) and temporary errors (503) are retried automatically.

Run `lassocut --help` for the full list. Tests: `npm test`.

MIT licence, copyright (c) 2026 JAUPIN Design LLC. remove.bg is a trademark of Canva Austria GmbH;
lassocut is not affiliated with it.
