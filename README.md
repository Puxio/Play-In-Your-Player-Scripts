# Export playlist in .xspf and play them in your player

Scripts that export Musify.club, KHinsider, Squidify and YouTube albums or playlists to .xspf playlists, so you can stream them in your favourite player (VLC, foobar2000, AIMP, PotPlayer, MPV...).

Use them with one bookmarklet that recognises the site you are on, or paste them into the browser DevTools console.

## Supported sites

| Site | What you get | Script |
|------|--------------|--------|
| [Musify.club](https://musify.club/en) | Big catalogue, high quality music (320 kbps MP3) | `musify_album_to_xspf.js` |
| [KHinsider](https://downloads.khinsider.com/) | Video game music, gamerips and more | `khinsider_album_to_xspf.js` |
| [Squidify.org](https://www.squidify.org/) | Music of modern video games in HD (FLAC) | `squidify_abum_to_xspf.js` |
| [YouTube](https://youtube.com/) | Albums and playlists, read directly from YouTube | `youtube_album_to_playlist.js` |

## Quick start: the bookmarklet

One bookmark works on every supported site and always runs the latest version of the scripts in this repository.

### Install

1. Show the bookmarks bar (Ctrl+Shift+B in Chrome, Edge and Firefox).
2. Right click the bar and choose "Add page" (Chrome, Edge) or "Add Bookmark" (Firefox).
3. Name it as you like, for example `Play In My Player`.
4. Paste this as the URL and save:

```
javascript:!function(){var t="Puxio/Play-In-Your-Player-Scripts",e="https://raw.githubusercontent.com/"+t+"/main/scripts/",n="https://cdn.jsdelivr.net/gh/"+t+"@main/scripts/",o={"musify.club":"musify_album_to_xspf.js","khinsider.com":"khinsider_album_to_xspf.js","squidify.org":"squidify_abum_to_xspf.js","youtube.com":"youtube_album_to_playlist.js","yewtu.be":"youtube_album_to_playlist.js","inv.nadeko.net":"youtube_album_to_playlist.js"},i="Play-In-Your-Player: ",r="open the console (F12), paste it and press Enter.",s=location.hostname.replace(/^www\./,"");function a(t){return fetch(e+t+"?_="+Date.now(),{cache:"no-store"}).then((function(e){if(!e.ok)throw new Error(t+" HTTP "+e.status);return e.text()}))}function c(t){for(var e in t)if(s===e||s.slice(-e.length-1)==="."+e)return t[e];return null}function l(t){window.open(e+t,"_blank")?alert(i+"this site blocks loading scripts.\nThe script ("+t+") has been opened in a new tab: select all (Ctrl+A), copy it (Ctrl+C), come back to this page, "+r):prompt(i+"this site blocks loading scripts.\nOpen this URL, copy the script, come back to this page and "+r,e+t)}a("manifest.json").then((function(t){var e=c(JSON.parse(t));if(e)return a(e).then((function(t){window.__pippRan=!1;try{var n=document.createElement("script");n.textContent="window.__pippRan=true;\n"+t,(document.head||document.documentElement).appendChild(n),n.remove()}catch(t){}window.__pippRan||function(t,e){var n=i+"this site blocks injected scripts.\n";navigator.clipboard?navigator.clipboard.writeText(e).then((function(){alert(n+"The script ("+t+") has been copied to the clipboard: "+r)}),(function(){l(t)})):l(t)}(e,t)}));alert(i+"no script registered for "+s+".")})).catch((function(t){t instanceof TypeError?function(){var t=c(o);if(t)try{var e=document.createElement("script");e.onerror=function(){e.remove(),l(t)},e.onload=function(){e.remove()},e.src=n+t,(document.head||document.documentElement).appendChild(e)}catch(e){l(t)}else alert(i+"this site blocks downloads from GitHub and "+s+" is not in the fallback list.")}():alert(i+"could not load the scripts ("+t.message+").")}))}();
```

The same line is in [`bookmarklet/bookmarklet.txt`](bookmarklet/bookmarklet.txt). GitHub does not allow `javascript:` links, so it has to be copied and pasted rather than dragged.

Current bookmarklet version: 1.1.1. If you installed an older one, replace its URL with the line above.

### Use

Open an album or playlist page on a supported site and click the bookmark. The .xspf file downloads automatically; open it with your player.

On YouTube, open the playlist or album page (or a video played from a playlist, with `&list=` in the URL) and click the bookmark. If YouTube blocks the injected script, the bookmarklet copies it to the clipboard instead: paste it into the console. The first time, Chrome asks you to type `allow pasting` before it accepts pasted code.

### How it works

The bookmarklet reads the hostname of the current page, looks it up in [`scripts/manifest.json`](scripts/manifest.json), downloads the matching script from this repository and runs it in the page, exactly as if you had pasted it into the console. Subdomains match their parent domain and `www.` is ignored.

Files are read from `raw.githubusercontent.com`, which caches them for about 5 minutes: a fix pushed to `main` reaches every bookmark within minutes, and the bookmark itself never needs to change.

Some sites restrict what their pages may load, and the bookmarklet adapts:

- if the site does not let the page run injected scripts, the bookmarklet copies the script to the clipboard and asks you to paste it into the console (F12);
- if the site does not let the page download from GitHub ("Failed to fetch"), the bookmarklet loads the script from [jsDelivr](https://www.jsdelivr.com/), which mirrors this repository (it can lag behind `main` by up to 12 hours). If that is blocked too, it opens the script in a new tab for you to copy and paste into the console.

The readable source of the bookmarklet is [`bookmarklet/launcher.js`](bookmarklet/launcher.js).

## Manual use (DevTools console)

Go to a supported music website and navigate to an album or playlist page. Open DevTools (F12), paste the appropriate script from [`scripts/`](scripts/) into the Console tab and press Enter: the browser downloads the .xspf file. You can then open it with your favourite player.

## Notes

- **Musify links expire.** Musify signs its stream URLs, and the signature only lasts a few hours. Play the .xspf soon after creating it, and create it again (one click on the bookmark) when it stops working.
- **YouTube** playlists are read directly from youtube.com, so no Invidious instance and no redirect are needed (the script also works on the Invidious instances listed in `scripts/manifest.json`). You need a YouTube capable player for YouTube playlists (for example AIMP with the YouTube plugin, or PotPlayer). `redirect-youtube.js` is no longer used and is kept only for reference.

## Adding a new site

1. Add the script to `scripts/`. It must run on its own when pasted into the console (for example as a self executing function) and download the .xspf at the end.
2. Map the site hostname to the script in `scripts/manifest.json`.
3. Commit and push to `main`. Existing bookmarks pick it up on their next click.

## License

Public domain ([The Unlicense](LICENSE)).
