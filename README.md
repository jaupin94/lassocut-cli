# LassoCut CLI

Remove image backgrounds in bulk from the command line with the [LassoCut API](https://www.lassocut.com/docs/).
One file, no dependencies, Node.js 18 or later.

```sh
lassocut login                                      # sign in with GitHub or Google in the browser, once

lassocut photo.jpg                                  # writes photo-removebg.png next to it
lassocut --output-directory out/ photos/            # every image in a folder
lassocut --size full --bg-color white "shots/*.jpg"
```

Coming from the remove.bg command-line tool? See the [CLI migration guide](https://www.lassocut.com/migrate/cli/). The flags are the same (`--size`, `--type`, `--format`,
`--channels`, `--bg-color`, `--bg-image-file`, `--output-directory`, `--reprocess-existing`,
`--confirm-batch-over`, `--extra-api-option`), results keep the `-removebg` file suffix, and
`REMOVE_BG_API_KEY` is read if `LASSOCUT_API_KEY` is not set. Replace the command name and the key.

The key comes from `--api-key`, then `LASSOCUT_API_KEY`, then `REMOVE_BG_API_KEY`, then the one saved by
`lassocut login` (in `%APPDATA%\lassocut\config.json` on Windows, `~/.config/lassocut/config.json` elsewhere).
`lassocut logout` removes the saved key; delete it in your account to revoke it.

New flags: `--api-url` (or `LASSOCUT_API_URL`), `--output-suffix`, `--concurrency` (default 4).
Rate limits (429) and temporary errors (503) are retried automatically.

Install: `npm install -g lassocut-cli` (or run once with `npx lassocut-cli`). Run `lassocut --help` for the full list. Tests: `npm test`.

MIT licence, copyright (c) 2026 JAUPIN Design LLC. remove.bg is a trademark of Canva Austria GmbH;
LassoCut is not affiliated with it.
