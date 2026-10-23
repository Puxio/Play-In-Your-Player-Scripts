# Export playlist in .xspf and play them in your player

Scripts that export Musify.club, KHInsider, Squidify, KHInsider-Squid and YouTube albums or playlists to .xspf playlists, so you can stream them in your favourite player (VLC, foobar2000, AIMP, PotPlayer, MPV...).

Use them with one bookmarklet that recognises the site you are on, or paste them into the browser DevTools console.

## Supported sites

| Site | What you get | Script |
|------|--------------|--------|
| [Musify.club](https://musify.club/en) | Big catalogue, high quality music (320 kbps MP3) | `musify_album_to_xspf.js` |
| [KHInsider](https://downloads.khinsider.com/) | Video game music, gamerips and more. FLAC when the album has it, MP3 otherwise. | `khinsider_album_to_xspf.js` |
| [KHInsider-Squid](https://khinsider.squid.wtf/) | KHInsider mirror with higher quality files (typically FLAC) | `khinsider_squid_to_xspf.js` |
| [Squidify.org](https://www.squidify.org/) | Music of modern video games in HD (FLAC) | `squidify_abum_to_xspf.js` |
| [YouTube](https://youtube.com/) | Albums and playlists, read directly from YouTube | `youtube_album_to_playlist.js` |

## Quick start: the 'Play In My Player' bookmarklet

One bookmark that use play-in-your-player scripts to let you 'Play In My Player' playlists. Works on every supported site and always runs the latest version of the scripts in this repository.

### Install

Open the install page and drag the button to your bookmarks bar:

**https://puxio.github.io/Play-In-Your-Player-Scripts/**

The bookmark is named with its version (for example `Play In My Player v1.2.0`). If you cannot drag it (mobile, some browsers), the page also has the code to copy into a bookmark by hand; the same line is in [`bookmarklet/bookmarklet.txt`](bookmarklet/bookmarklet.txt).

### Updates

The site scripts are downloaded from this repository on every click, so fixes reach you without touching the bookmark. When the bookmarklet itself changes, clicking an older one shows a small notice in the corner of the page with a link to the install page: delete the old bookmark and drag the new one. Bookmarks older than v1.2.0 do not show the notice, so replace them once.

### Use

Open an album or playlist page on a supported site and click the bookmark. The .xspf file downloads automatically; open it with your player.

On YouTube, open the playlist or album page (or a video played from a playlist, with `&list=` in the URL) and click the bookmark. If YouTube blocks the injected script, the bookmarklet copies it to the clipboard instead: paste it into the console. The first time, Chrome asks you to type `allow pasting` before it accepts pasted code.

### How it works

The bookmarklet reads the hostname of the current page, looks it up in [`scripts/manifest.json`](scripts/manifest.json), downloads the matching script from this repository and runs it in the page, exactly as if you had pasted it into the console. Subdomains match their parent domain and `www.` is ignored.

Files are read from `raw.githubusercontent.com`, which caches them for about 5 minutes: a fix pushed to `main` reaches every bookmark within minutes.

Some sites restrict what their pages may load, and the bookmarklet adapts:

- if the site does not let the page run injected scripts, the bookmarklet copies the script to the clipboard and asks you to paste it into the console (F12);
- if the site does not let the page download from GitHub ("Failed to fetch"), the bookmarklet loads the script from [jsDelivr](https://www.jsdelivr.com/), which mirrors this repository (it can lag behind `main` by up to 12 hours). If that is blocked too, it opens the script in a new tab for you to copy and paste into the console.

The readable source of the bookmarklet is [`bookmarklet/launcher.js`](bookmarklet/launcher.js). Its `VERSION` line is the single source of truth: after editing it, run `npm install --no-save terser && node tools/build.mjs` to regenerate `bookmarklet.txt`. On every push to `main`, a GitHub Action rebuilds the install page from it ([`docs/index.html`](docs/index.html) is the template) and publishes it on GitHub Pages.

## Manual use (DevTools console)

Go to a supported music website and navigate to an album or playlist page. Open DevTools (F12), paste the appropriate script from [`scripts/`](scripts/) into the Console tab and press Enter: the browser downloads the .xspf file. You can then open it with your favourite player.

## Notes

- **Musify links expire.** Musify signs its stream URLs, and the signature only lasts a few hours. Play the .xspf soon after creating it, and create it again (one click on the bookmark) when it stops working.
- **YouTube** playlists are read directly from youtube.com. You need a YouTube capable player to play them (for example AIMP with the YouTube plugin, or PotPlayer).

## Adding a new site

1. Add the script to `scripts/`. It must run on its own when pasted into the console (for example as a self executing function) and download the .xspf at the end.
2. Map the site hostname to the script in `scripts/manifest.json`.
3. Commit and push to `main`. Existing bookmarks pick it up on their next click.

## License

Public domain ([The Unlicense](LICENSE)).
