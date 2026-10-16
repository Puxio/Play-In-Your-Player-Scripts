# Export playlist in .xspf and play them in your player

Scripts that export Musify.club, KHinsider, Squidify and YouTube albums or playlists to .xspf playlists, so you can stream them in your favourite player (VLC, foobar2000, AIMP, PotPlayer, MPV...).

Use them with one bookmarklet that recognises the site you are on, or paste them into the browser DevTools console.

## Supported sites

| Site | What you get | Script |
|------|--------------|--------|
| [Musify.club](https://musify.club/en) | Big catalogue, high quality music (320 kbps MP3) | `musify_album_to_xspf.js` |
| [KHinsider](https://downloads.khinsider.com/) | Video game music, gamerips and more | `khinsider_album_to_xspf.js` |
| [Squidify.org](https://www.squidify.org/) | Music of modern video games in HD (FLAC) | `squidify_abum_to_xspf.js` |
| [YouTube](https://youtube.com/) | Albums and playlists, through an Invidious instance | `redirect-youtube.js` + `youtube_album_to_playlist.js` |

## Quick start: the bookmarklet

One bookmark works on every supported site and always runs the latest version of the scripts in this repository.

### Install

1. Show the bookmarks bar (Ctrl+Shift+B in Chrome, Edge and Firefox).
2. Right click the bar and choose "Add page" (Chrome, Edge) or "Add Bookmark" (Firefox).
3. Name it as you like, for example `Play In My Player`.
4. Paste this as the URL and save:

```
javascript:!function(){var t="https://raw.githubusercontent.com/Puxio/Play-In-Your-Player-Scripts/main/scripts/",n="Play-In-Your-Player: ",e=location.hostname.replace(/^www\./,"");function o(n){return fetch(t+n+"?_="+Date.now(),{cache:"no-store"}).then((function(t){if(!t.ok)throw new Error(n+" HTTP "+t.status);return t.text()}))}o("manifest.json").then((function(r){var i=function(t){for(var n in t)if(e===n||e.slice(-n.length-1)==="."+n)return t[n];return null}(JSON.parse(r));if(i)return o(i).then((function(e){window.__pippRan=!1;try{var o=document.createElement("script");o.textContent="window.__pippRan=true;\n"+e,(document.head||document.documentElement).appendChild(o),o.remove()}catch(t){}window.__pippRan||function(e,o){var r=n+"this site blocks injected scripts.\n",i=t+e;navigator.clipboard&&o?navigator.clipboard.writeText(o).then((function(){alert(r+"The script ("+e+") has been copied to the clipboard: open the console (F12), paste it and press Enter.")}),(function(){prompt(r+"Open this URL, copy the script and paste it into the console (F12):",i)})):prompt(r+"Open this URL, copy the script and paste it into the console (F12):",i)}(i,e)}));alert(n+"no script registered for "+e+".")})).catch((function(t){alert(n+"could not load the scripts ("+t.message+").")}))}();
```

The same line is in [`bookmarklet/bookmarklet.txt`](bookmarklet/bookmarklet.txt). GitHub does not allow `javascript:` links, so it has to be copied and pasted rather than dragged.

### Use

Open an album or playlist page on a supported site and click the bookmark. The .xspf file downloads automatically; open it with your player.

On YouTube it takes two clicks: the first one, on the YouTube playlist page, redirects you to the same playlist on Invidious; the second one, on the Invidious page, downloads the .xspf.

### How it works

The bookmarklet reads the hostname of the current page, looks it up in [`scripts/manifest.json`](scripts/manifest.json), downloads the matching script from this repository and runs it in the page, exactly as if you had pasted it into the console. Subdomains match their parent domain and `www.` is ignored.

Files are read from `raw.githubusercontent.com`, which caches them for about 5 minutes: a fix pushed to `main` reaches every bookmark within minutes, and the bookmark itself never needs to change.

Some sites forbid scripts injected into their pages. When that happens the bookmarklet copies the script to the clipboard and asks you to paste it into the console (F12) yourself.

The readable source of the bookmarklet is [`bookmarklet/launcher.js`](bookmarklet/launcher.js).

## Manual use (DevTools console)

Go to a supported music website and navigate to an album or playlist page. Open DevTools (F12), paste the appropriate script from [`scripts/`](scripts/) into the Console tab and press Enter: the browser downloads the .xspf file. You can then open it with your favourite player.

## Notes

- **Musify links expire.** Musify signs its stream URLs, and the signature only lasts a few hours. Play the .xspf soon after creating it, and create it again (one click on the bookmark) when it stops working.
- **YouTube** goes through a public Invidious instance; change the instance in the scripts if it is not available. Some Invidious instances do not accept CORS requests, which is why there is a redirect script. You need a YouTube capable player for YouTube playlists (for example AIMP with the YouTube plugin, or PotPlayer). If you switch to another Invidious instance, add its hostname to `scripts/manifest.json`.

## Adding a new site

1. Add the script to `scripts/`. It must run on its own when pasted into the console (for example as a self executing function) and download the .xspf at the end.
2. Map the site hostname to the script in `scripts/manifest.json`.
3. Commit and push to `main`. Existing bookmarks pick it up on their next click.

## License

Public domain ([The Unlicense](LICENSE)).
