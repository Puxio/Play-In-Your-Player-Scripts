/**
 * YouTube Playlist / Album to XSPF - v2.0.0
 *
 * Run in the DevTools console (or with the bookmarklet) on a YouTube
 * playlist or album: https://www.youtube.com/playlist?list=... or a watch
 * page with &list=... in the URL. It builds an XSPF playlist of
 * youtube.com/watch links and downloads it. You need a player that can play
 * YouTube links (for example AIMP with the YouTube plugin, or PotPlayer).
 *
 * On youtube.com the track list is read from YouTube itself: the playlist
 * page data (ytInitialData) and, for playlists longer than 100 videos, the
 * same continuation requests the page makes while scrolling. Every request
 * is same-origin: no Invidious instance, no redirect, no browser check.
 * music.youtube.com and m.youtube.com are sent to www.youtube.com first.
 *
 * On an Invidious instance the script still works, through that instance's
 * own /api/v1/playlists endpoint.
 *
 * Albums (playlist ids starting with OLAK) are saved as
 * "Artist - Album [Youtube].xspf", other playlists as "Title [Youtube].xspf".
 *
 * Changelog:
 *   2.0.0 (2026-10-16) - Read playlists from youtube.com directly instead of
 *                        a public Invidious instance (the redirect to
 *                        yewtu.be stopped at a browser verification).
 *                        Fixed XML escaping of &, <, > and quotes. Unplayable
 *                        (deleted or private) videos are skipped. Only a
 *                        leading "Album - " or trailing " - Album" is removed
 *                        from album titles.
 *   1.x                - Fetched the playlist from inv.nadeko.net.
 */
(async function () {
    'use strict';

    const TAG = '[YouTube XSPF]';

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    const playlistId = (location.href.match(/[?&]list=([a-zA-Z0-9_-]+)/) || [])[1];
    if (!playlistId) {
        console.error(`${TAG} ❌ No playlist id (list=...) in the URL. Open a YouTube playlist or album page.`);
        return;
    }

    const host = location.hostname;
    const onYouTube = /(^|\.)youtube\.com$/.test(host);

    // Only www.youtube.com serves the desktop page data read below.
    if (onYouTube && host !== 'www.youtube.com') {
        console.log(`${TAG} Opening this playlist on www.youtube.com: run the script again there.`);
        location.href = `https://www.youtube.com/playlist?list=${playlistId}`;
        return;
    }

    let playlistTitle = '';
    let videos = []; // { videoId, title, author, position, seconds }

    if (onYouTube) {
        // Text of a YouTube text object: { simpleText } or { runs: [{ text }] }.
        const text = (t) => !t ? '' : (t.simpleText !== undefined ? t.simpleText : (t.runs || []).map((r) => r.text).join(''));

        // "4:16" or "1:02:03" to seconds.
        const parseLength = (s) => (s || '').split(':').reduce((acc, part) => acc * 60 + (parseInt(part, 10) || 0), 0);

        // First object stored under `key` anywhere in the tree.
        const find = (node, key) => {
            if (!node || typeof node !== 'object') return null;
            if (!Array.isArray(node) && node[key]) return node[key];
            for (const k of Object.keys(node)) {
                const found = find(node[k], key);
                if (found) return found;
            }
            return null;
        };

        // Collect playlist video renderers and continuation tokens, in page order.
        const collect = (node, out) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return; }
            if (node.playlistVideoRenderer) { out.items.push(node.playlistVideoRenderer); return; }
            if (node.continuationItemRenderer) {
                const m = JSON.stringify(node.continuationItemRenderer).match(/"token":"([^"]+)"/);
                if (m) out.tokens.push(m[1]);
                return;
            }
            for (const k of Object.keys(node)) collect(node[k], out);
        };

        // Fresh page data for this playlist (window.ytInitialData can be stale
        // after in-site navigation, and is missing on watch pages).
        let data = null;
        try {
            const res = await fetch(`/playlist?list=${playlistId}`, { credentials: 'same-origin' });
            const html = await res.text();
            const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
            if (m) data = JSON.parse(m[1]);
        } catch (err) {
            console.warn(`${TAG} Could not reload the playlist page (${err.message}); using the data already on this page.`);
        }
        if (!data && window.ytInitialData) data = window.ytInitialData;
        if (!data) {
            console.error(`${TAG} ❌ YouTube playlist data not found.`);
            return;
        }

        const metadata = find(data, 'playlistMetadataRenderer');
        const pageHeader = find(data, 'pageHeaderRenderer');
        const oldHeader = find(data, 'playlistHeaderRenderer');
        playlistTitle = (metadata && metadata.title)
            || (pageHeader && pageHeader.pageTitle)
            || (oldHeader && text(oldHeader.title))
            || document.title.replace(/\s*-\s*YouTube\s*$/, '');

        const out = { items: [], tokens: [] };
        collect(find(data, 'playlistVideoListRenderer') || data, out);

        // Playlists longer than 100 videos: ask for the next pages like the site does.
        const context = window.ytcfg && window.ytcfg.get ? window.ytcfg.get('INNERTUBE_CONTEXT') : null;
        for (let page = 0; out.tokens.length && page < 100; page++) {
            if (!context) {
                console.warn(`${TAG} ⚠️ Only the first ${out.items.length} videos could be read (YouTube config not found).`);
                break;
            }
            const token = out.tokens.shift();
            try {
                const res = await fetch('/youtubei/v1/browse?prettyPrint=false', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ context, continuation: token })
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                collect(json.onResponseReceivedActions || json, out);
            } catch (err) {
                console.warn(`${TAG} ⚠️ Stopped after ${out.items.length} videos: ${err.message}`);
                break;
            }
        }

        let skipped = 0;
        for (const r of out.items) {
            if (!r.videoId || r.isPlayable === false) { skipped++; continue; }
            videos.push({
                videoId: r.videoId,
                title: text(r.title),
                author: text(r.shortBylineText),
                position: parseInt(text(r.index), 10) || videos.length + skipped + 1,
                seconds: parseInt(r.lengthSeconds, 10) || parseLength(text(r.lengthText))
            });
        }
        if (skipped) console.log(`${TAG} Skipped ${skipped} unplayable video(s) (deleted or private).`);
    } else {
        // Invidious instance: use its own API (same origin, no CORS issues).
        try {
            const res = await fetch(`${location.origin}/api/v1/playlists/${playlistId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            playlistTitle = data.title || '';
            videos = (data.videos || []).map((v, i) => ({
                videoId: v.videoId,
                title: v.title,
                author: v.author,
                position: v.index !== undefined ? v.index + 1 : i + 1,
                seconds: v.lengthSeconds
            }));
        } catch (err) {
            console.error(`${TAG} ❌ Invidious API error: ${err.message}. Is this an Invidious instance with the API enabled?`);
            return;
        }
    }

    if (videos.length === 0) {
        console.warn(`${TAG} ❌ No videos found in this playlist.`);
        return;
    }

    // --- Album or plain playlist ---
    const isAlbum = playlistId.startsWith('OLAK');
    const stripTopic = (name) => (name || '').replace(/\s*-\s*Topic$/, '').trim();
    const albumArtist = isAlbum ? (stripTopic(videos[0].author) || 'Unknown Artist') : '';

    const trackXml = videos.map((video) => {
        let title = video.title || 'Unknown Title';
        let artist = video.author || 'Unknown Artist';

        // Uploads that are not "Artist - Topic" channels usually carry the
        // artist in the title: "Artist - 01. Title" or "Artist - Title".
        if (!isAlbum && !/\s-\sTopic$/.test(artist)) {
            const match = title.match(/^(.+?)\s*-\s*\d+\s*[.-]\s*(.+)$/);
            if (match) {
                artist = match[1].trim();
                title = match[2].trim();
            } else {
                const parts = title.split(' - ');
                if (parts.length === 2) {
                    artist = parts[0].trim();
                    title = parts[1].trim();
                }
            }
        }
        artist = stripTopic(artist);

        let xml = '    <track>\n';
        xml += `      <trackNum>${esc(video.position)}</trackNum>\n`;
        xml += `      <title>${esc(title)}</title>\n`;
        xml += `      <creator>${esc(artist)}</creator>\n`;
        xml += `      <location>${esc('https://www.youtube.com/watch?v=' + video.videoId)}</location>\n`;
        if (video.seconds) xml += `      <duration>${video.seconds * 1000}</duration>\n`;
        xml += '    </track>';
        return xml;
    });

    let name = playlistTitle || 'Unknown Playlist';
    let fileName;
    if (isAlbum) {
        name = name.replace(/^\s*Album\s*-\s*/i, '').replace(/\s*-\s*Album\s*$/i, '').trim();
        fileName = `${albumArtist} - ${name} [Youtube].xspf`;
    } else {
        fileName = `${name} [Youtube].xspf`;
    }
    fileName = fileName.replace(/[\\/:*?"<>|]/g, '_').replace(/\s{2,}/g, ' ').trim();

    let xspf = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n';
    xspf += `  <title>${esc(name)}</title>\n`;
    if (isAlbum) xspf += `  <creator>${esc(albumArtist)}</creator>\n`;
    xspf += `  <trackList>\n${trackXml.join('\n')}\n  </trackList>\n</playlist>`;

    // --- Download ---
    const blob = new Blob([xspf], { type: 'application/xspf+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    console.log(`${TAG} ✅ ${videos.length} videos exported to "${fileName}".`);
})();
