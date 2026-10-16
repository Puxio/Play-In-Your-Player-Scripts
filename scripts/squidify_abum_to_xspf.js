/**
 * Squidify.org XSPF Playlist Generator - v2.0.0
 *
 * Run in the DevTools console on an album or playlist page of
 * www.squidify.org. It builds an XSPF playlist and downloads it.
 *
 * Squidify is a Subsonic compatible music server. The page loads its cover
 * art from /rest/getCoverArt with the guest credentials it uses for every
 * visitor (u, t, s, v, c). The script reuses those same parameters to ask
 * the Subsonic API for the track list (getAlbum / getPlaylist) and writes a
 * /rest/stream URL for each track, which streams the original file (FLAC).
 * Subsonic token authentication does not expire on its own, so the XSPF
 * keeps working until the site changes its guest credentials.
 *
 * Calls are same-origin, so they are allowed by the site's security policy.
 *
 * Changelog:
 *   2.0.0 (2026-10-16) - Rewritten for the new Squidify site (Svelte). The
 *                        [role=table] track list no longer exists; tracks
 *                        now come from the Subsonic API instead of clicking
 *                        each row and reading the <audio> element.
 *   1.0.0              - Clicked each [role=table] row and captured the
 *                        audio source and duration.
 */
(async function () {
    'use strict';

    const TAG = '[Squidify XSPF]';
    const DEFAULT_API_VERSION = '1.16.1';
    const DEFAULT_CLIENT = 'play-in-your-player';

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    // --- 1. Guest credentials, taken from the cover art URL on the page ---
    const coverImg = document.querySelector('img[src*="/rest/getCoverArt"]');
    if (!coverImg) {
        console.error(`${TAG} ❌ Cover art not found. Open an album or playlist page and wait for it to load.`);
        return;
    }
    const coverUrl = new URL(coverImg.src, location.href);
    const origin = coverUrl.origin;

    const auth = new URLSearchParams();
    for (const [key, value] of coverUrl.searchParams) {
        if (!['id', 'size', 'f'].includes(key)) auth.set(key, value);
    }
    if (!auth.has('u') || !(auth.has('t') || auth.has('p'))) {
        console.error(`${TAG} ❌ No Subsonic credentials in the cover URL:`, coverImg.src);
        return;
    }
    if (!auth.has('v')) auth.set('v', DEFAULT_API_VERSION);
    if (!auth.has('c')) auth.set('c', DEFAULT_CLIENT);

    // Call a Subsonic API method and return its "subsonic-response" object.
    const callApi = async (method, params) => {
        const query = new URLSearchParams(auth);
        for (const key in params) query.set(key, params[key]);
        query.set('f', 'json');
        const response = await fetch(`${origin}/rest/${method}?${query}`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
        const data = (await response.json())['subsonic-response'];
        if (!data || data.status !== 'ok') {
            throw new Error(`${method}: ${data && data.error ? data.error.message : 'unexpected response'}`);
        }
        return data;
    };

    // --- 2. Which album or playlist this page shows ---
    const segments = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const isPlaylist = segments.some((s) => /playlist/i.test(s));
    const segmentAfter = (pattern) => {
        const i = segments.findIndex((s) => pattern.test(s));
        return i >= 0 ? segments[i + 1] : null;
    };
    const queryId = new URLSearchParams(location.search).get('id');

    const candidates = [];
    if (isPlaylist) {
        candidates.push(segmentAfter(/playlist/i), queryId, segments[segments.length - 1]);
    } else {
        candidates.push(segmentAfter(/^albums?$/i), queryId, segments[segments.length - 1]);
        // Album cover ids look like "al-<albumId>_<hex>".
        const coverMatch = (coverUrl.searchParams.get('id') || '').match(/^al-(.+?)(?:_[0-9a-f]+)?$/);
        if (coverMatch) candidates.push(coverMatch[1]);
    }
    const ids = [...new Set(candidates.filter(Boolean))];

    let info = null;
    let songs = [];
    for (const id of ids) {
        try {
            if (isPlaylist) {
                const data = await callApi('getPlaylist', { id });
                info = { name: data.playlist.name, artist: data.playlist.owner };
                songs = data.playlist.entry || [];
            } else {
                const data = await callApi('getAlbum', { id });
                info = data.album;
                songs = (data.album.song || []).slice().sort((a, b) =>
                    ((a.discNumber || 1) - (b.discNumber || 1)) || ((a.track || 0) - (b.track || 0)));
            }
            console.log(`${TAG} ${isPlaylist ? 'Playlist' : 'Album'} id: ${id}`);
            break;
        } catch (err) {
            console.warn(`${TAG} id "${id}" rejected: ${err.message}`);
        }
    }

    if (!info) {
        console.error(`${TAG} ❌ Could not read the track list from the Subsonic API (tried: ${ids.join(', ') || 'no id found'}).`);
        return;
    }
    if (songs.length === 0) {
        console.warn(`${TAG} ❌ The ${isPlaylist ? 'playlist' : 'album'} has no tracks.`);
        return;
    }

    // --- 3. Build the XSPF ---
    const title = info.name || (document.querySelector('h1') || {}).innerText || 'Squidify Playlist';
    const streamUrl = (songId) => {
        const query = new URLSearchParams(auth);
        query.set('id', songId);
        return `${origin}/rest/stream?${query}`;
    };

    const trackXml = songs.map((song, index) => {
        let xml = '    <track>\n';
        xml += `      <location>${esc(streamUrl(song.id))}</location>\n`;
        if (song.title) xml += `      <title>${esc(song.title)}</title>\n`;
        if (song.artist) xml += `      <creator>${esc(song.artist)}</creator>\n`;
        xml += `      <album>${esc(song.album || title)}</album>\n`;
        xml += `      <trackNum>${esc(isPlaylist ? index + 1 : (song.track || index + 1))}</trackNum>\n`;
        if (song.duration) xml += `      <duration>${Math.round(song.duration * 1000)}</duration>\n`;
        xml += '    </track>';
        return xml;
    });

    let xspf = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n';
    xspf += `  <title>${esc(title)}</title>\n`;
    if (info.artist) xspf += `  <creator>${esc(info.artist)}</creator>\n`;
    xspf += `  <location>${esc(location.href)}</location>\n`;
    xspf += `  <image>${esc(coverImg.src)}</image>\n`;
    xspf += `  <trackList>\n${trackXml.join('\n')}\n  </trackList>\n</playlist>`;

    // --- 4. Download ---
    const filename = `${title} [Squidify.org].xspf`.replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([xspf], { type: 'application/xspf+xml' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    console.log(`${TAG} ✅ ${songs.length} tracks exported to "${filename}".`);
})();
