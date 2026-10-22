/**
 * KHInsider-Squid XSPF Playlist Generator - v1.0.0
 *
 * Run in the DevTools console on an album page of khinsider.squid.wtf
 * (https://khinsider.squid.wtf/game-soundtracks/album/...).
 *
 * The site is a Next.js frontend that proxies KHInsider via two API endpoints:
 *   - GET /api/album?url=<khinsider_album_url>
 *       Returns JSON with album metadata and a tracks[] array. Each track has
 *       a "url" field pointing to the KHInsider per-track download page.
 *   - GET /api/download?url=<khinsider_track_page_url>
 *       Returns HTML scraped from KHInsider. The page contains direct CDN
 *       links on vgmtreasurechest.com for both MP3 and FLAC.
 *
 * This script fetches the album, then for each track fetches the download
 * page and picks the FLAC link when available (falling back to MP3).
 *
 * Changelog:
 *   1.0.0 (2026-10-22) - Initial release.
 */
(async function () {
    'use strict';

    const TAG = '[KHInsider-Squid XSPF]';
    const KHINSIDER_ORIGIN = 'https://downloads.khinsider.com';

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    // Parse "M:SS" or "H:MM:SS" to milliseconds.
    const durationMs = (str) => {
        if (!str) return 0;
        const parts = str.split(':').map(Number);
        if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
        if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        return 0;
    };

    console.log(`${TAG} Starting...`);

    // --- 1. Fetch album metadata ---
    // Build the equivalent KHInsider URL from the current pathname.
    const khinsiderAlbumUrl = KHINSIDER_ORIGIN + location.pathname;
    console.log(`${TAG} Fetching album: ${khinsiderAlbumUrl}`);

    let album;
    try {
        const resp = await fetch('/api/album?url=' + encodeURIComponent(khinsiderAlbumUrl));
        if (!resp.ok) throw new Error(`/api/album HTTP ${resp.status}`);
        album = await resp.json();
    } catch (err) {
        console.error(`${TAG} Failed to fetch album metadata: ${err.message}`);
        return;
    }

    const albumTitle = album.name || document.querySelector('h1')?.innerText?.trim() || 'Unknown Album';
    const coverUrl = album.coverUrl || '';
    const tracks = album.tracks || [];

    if (tracks.length === 0) {
        console.error(`${TAG} No tracks found for this album.`);
        return;
    }

    console.log(`${TAG} Found ${tracks.length} tracks. Fetching download links...`);

    // --- 2. Fetch direct CDN links for each track ---
    const AUDIO_EXT = /\.(flac|mp3|ogg|wav)(\?|$)/i;

    const getDirectLinks = async (trackPageUrl) => {
        try {
            const resp = await fetch('/api/download?url=' + encodeURIComponent(trackPageUrl));
            if (!resp.ok) return null;
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const links = [...doc.querySelectorAll('a[href]')]
                .map(a => a.href)
                .filter(h => AUDIO_EXT.test(h));
            const flac = links.find(h => /\.flac(\?|$)/i.test(h));
            const mp3 = links.find(h => /\.mp3(\?|$)/i.test(h));
            return flac || mp3 || null;
        } catch {
            return null;
        }
    };

    const xspfTrackEntries = [];
    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const trackPageUrl = track.url;
        const trackTitle = track.title || `Track ${track.number || i + 1}`;
        console.log(`${TAG} [${i + 1}/${tracks.length}] ${trackTitle}`);

        const audioUrl = await getDirectLinks(trackPageUrl);
        if (!audioUrl) {
            console.warn(`${TAG} Could not get link for track ${i + 1}, skipping.`);
            continue;
        }

        const ms = durationMs(track.duration);
        const isFlac = /\.flac(\?|$)/i.test(audioUrl);
        let xml = '    <track>\n';
        xml += `      <location>${esc(audioUrl)}</location>\n`;
        xml += `      <title>${esc(trackTitle)}</title>\n`;
        xml += `      <album>${esc(albumTitle)}</album>\n`;
        xml += `      <trackNum>${track.number || i + 1}</trackNum>\n`;
        if (ms > 0) xml += `      <duration>${ms}</duration>\n`;
        xml += `      <annotation>${isFlac ? 'FLAC' : 'MP3'}</annotation>\n`;
        xml += '    </track>';
        xspfTrackEntries.push(xml);
    }

    if (xspfTrackEntries.length === 0) {
        console.error(`${TAG} No tracks could be exported.`);
        return;
    }

    // --- 3. Build and download XSPF ---
    let xspf = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n';
    xspf += `  <title>${esc(albumTitle)}</title>\n`;
    xspf += `  <location>${esc(location.href)}</location>\n`;
    if (coverUrl) xspf += `  <image>${esc(coverUrl)}</image>\n`;
    xspf += `  <trackList>\n${xspfTrackEntries.join('\n')}\n  </trackList>\n</playlist>`;

    const filename = `${albumTitle} [KHInsider-Squid].xspf`.replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([xspf], { type: 'application/xspf+xml' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    console.log(`${TAG} Done: ${xspfTrackEntries.length}/${tracks.length} tracks exported to "${filename}".`);
})();
