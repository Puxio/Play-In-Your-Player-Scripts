/**
 * KHInsider XSPF Playlist Generator - v4.0.0
 *
 * Run in the DevTools console on a KHInsider album page
 * (downloads.khinsider.com/game-soundtracks/album/...).
 *
 * Strategy:
 *   1. Try to fetch the same album from khinsider.squid.wtf via its Subsonic
 *      API, which typically serves FLAC files at higher quality.
 *   2. If the album is not available there (or the API call fails for any
 *      reason), fall back to the classic KHInsider method: visit each track
 *      page on downloads.khinsider.com and extract the direct CDN link.
 *
 * Changelog:
 *   4.0.0 (2026-10-22) - Added squid.wtf FLAC-first strategy with fallback
 *                        to the classic per-track extraction method.
 *   3.3   (prior)      - Classic per-track extraction only.
 */
(async function () {
    'use strict';

    const TAG = '[KHInsider XSPF]';
    const SQUID_ORIGIN = 'https://khinsider.squid.wtf';
    const DEFAULT_API_VERSION = '1.16.1';
    const DEFAULT_CLIENT = 'play-in-your-player';

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    const downloadXspf = (xspf, filename) => {
        const blob = new Blob([xspf], { type: 'application/xspf+xml' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    };

    // -------------------------------------------------------------------------
    // Strategy 1: khinsider.squid.wtf via Subsonic API (FLAC quality)
    // -------------------------------------------------------------------------
    const trySquid = async () => {
        // Fetch the equivalent album page on squid.wtf to get the cover art
        // URL that contains the guest Subsonic credentials.
        const squidPageUrl = SQUID_ORIGIN + location.pathname;
        console.log(`${TAG} Trying squid.wtf: ${squidPageUrl}`);

        const pageResp = await fetch(squidPageUrl);
        if (!pageResp.ok) throw new Error(`squid.wtf page HTTP ${pageResp.status}`);
        const pageHtml = await pageResp.text();

        // Parse the page to find the cover art URL with credentials.
        const parser = new DOMParser();
        const doc = parser.parseFromString(pageHtml, 'text/html');
        const coverImg = doc.querySelector('img[src*="/rest/getCoverArt"]');
        if (!coverImg) throw new Error('No cover art found on squid.wtf page');

        const coverUrl = new URL(coverImg.src, SQUID_ORIGIN);
        const auth = new URLSearchParams();
        for (const [key, value] of coverUrl.searchParams) {
            if (!['id', 'size', 'f'].includes(key)) auth.set(key, value);
        }
        if (!auth.has('u') || !(auth.has('t') || auth.has('p'))) {
            throw new Error('No Subsonic credentials found in cover art URL');
        }
        if (!auth.has('v')) auth.set('v', DEFAULT_API_VERSION);
        if (!auth.has('c')) auth.set('c', DEFAULT_CLIENT);

        const callApi = async (method, params) => {
            const query = new URLSearchParams(auth);
            for (const key in params) query.set(key, params[key]);
            query.set('f', 'json');
            const resp = await fetch(`${SQUID_ORIGIN}/rest/${method}?${query}`);
            if (!resp.ok) throw new Error(`${method} HTTP ${resp.status}`);
            const data = (await resp.json())['subsonic-response'];
            if (!data || data.status !== 'ok') {
                throw new Error(`${method}: ${data && data.error ? data.error.message : 'unexpected response'}`);
            }
            return data;
        };

        // Derive album id candidates from the squid.wtf page DOM.
        const squidSegments = coverUrl.pathname ? [] :
            new URL(squidPageUrl).pathname.split('/').filter(Boolean).map(decodeURIComponent);
        const pageSegments = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        const candidates = [];
        // Last path segment is usually the album slug used as id.
        candidates.push(pageSegments[pageSegments.length - 1]);
        // Cover art id like "al-<albumId>_<hex>".
        const coverMatch = (coverUrl.searchParams.get('id') || '').match(/^al-(.+?)(?:_[0-9a-f]+)?$/);
        if (coverMatch) candidates.push(coverMatch[1]);

        const ids = [...new Set(candidates.filter(Boolean))];
        let info = null;
        let songs = [];
        for (const id of ids) {
            try {
                const data = await callApi('getAlbum', { id });
                info = data.album;
                songs = (data.album.song || []).slice().sort((a, b) =>
                    ((a.discNumber || 1) - (b.discNumber || 1)) || ((a.track || 0) - (b.track || 0)));
                console.log(`${TAG} squid.wtf album id: ${id}`);
                break;
            } catch (err) {
                console.warn(`${TAG} squid.wtf id "${id}" rejected: ${err.message}`);
            }
        }

        if (!info || songs.length === 0) throw new Error('Album not found on squid.wtf');

        const title = info.name || document.querySelector('h2')?.innerText.trim() || 'Unknown Album';
        const streamUrl = (songId) => {
            const query = new URLSearchParams(auth);
            query.set('id', songId);
            return `${SQUID_ORIGIN}/rest/stream?${query}`;
        };

        const trackXml = songs.map((song, index) => {
            let xml = '    <track>\n';
            xml += `      <location>${esc(streamUrl(song.id))}</location>\n`;
            if (song.title) xml += `      <title>${esc(song.title)}</title>\n`;
            if (song.artist) xml += `      <creator>${esc(song.artist)}</creator>\n`;
            xml += `      <album>${esc(song.album || title)}</album>\n`;
            xml += `      <trackNum>${song.track || index + 1}</trackNum>\n`;
            if (song.duration) xml += `      <duration>${Math.round(song.duration * 1000)}</duration>\n`;
            xml += '    </track>';
            return xml;
        });

        let xspf = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n';
        xspf += `  <title>${esc(title)}</title>\n`;
        if (info.artist) xspf += `  <creator>${esc(info.artist)}</creator>\n`;
        xspf += `  <location>${esc(squidPageUrl)}</location>\n`;
        xspf += `  <image>${esc(coverImg.src)}</image>\n`;
        xspf += `  <trackList>\n${trackXml.join('\n')}\n  </trackList>\n</playlist>`;

        const filename = `${title} [KHInsider-Squid].xspf`.replace(/[\\/:*?"<>|]/g, '_');
        downloadXspf(xspf, filename);
        console.log(`${TAG} ✅ ${songs.length} tracks exported via squid.wtf to "${filename}".`);
        return true;
    };

    // -------------------------------------------------------------------------
    // Strategy 2: Classic KHInsider per-track extraction (MP3 fallback)
    // -------------------------------------------------------------------------
    const tryClassic = async () => {
        console.log(`${TAG} Falling back to classic KHInsider extraction...`);

        const playlistTable = document.getElementById('songlist');
        if (!playlistTable) {
            console.error(`${TAG} ❌ Table #songlist not found. Ensure you are on a KHInsider album page.`);
            return false;
        }

        const albumTitle = document.querySelector('h2')?.innerText.trim() || 'Unknown Album';
        const albumImageAnchor = document.querySelector('.albumImage a');
        const albumImageUrl = albumImageAnchor ? albumImageAnchor.href : '';

        const rows = Array.from(playlistTable.querySelectorAll('tr')).filter(row =>
            row.querySelector('a[href*="/game-soundtracks/album/"]') && !row.querySelector('th')
        );

        if (rows.length === 0) {
            console.error(`${TAG} ❌ No tracks found in the playlist table.`);
            return false;
        }

        console.log(`${TAG} Found ${rows.length} tracks. Starting classic extraction...`);

        const getDirectLink = async (pageUrl) => {
            try {
                const response = await fetch(pageUrl);
                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                return doc.querySelector('.songDownloadLink')?.closest('a')?.href || null;
            } catch (err) {
                return null;
            }
        };

        const xspfTrackEntries = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const trackLink = row.querySelector('a[href*="/game-soundtracks/album/"]');
            if (!trackLink) continue;

            const trackTitle = trackLink.innerText.trim();
            const trackPageUrl = trackLink.href;
            console.log(`${TAG} [${i + 1}/${rows.length}] Extracting: ${trackTitle}...`);

            const directAudioUrl = await getDirectLink(trackPageUrl);
            if (!directAudioUrl) {
                console.warn(`${TAG} ⚠️ Failed to retrieve link for: ${trackTitle}`);
                continue;
            }

            const cells = Array.from(row.querySelectorAll('td'));
            const durationCell = cells.find(td => /^\d+:\d+(:\d+)?$/.test(td.innerText.trim()));
            let durationMs = 0;
            if (durationCell) {
                const parts = durationCell.innerText.trim().split(':').map(Number);
                durationMs = parts.length === 2
                    ? (parts[0] * 60 + parts[1]) * 1000
                    : (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
            }

            xspfTrackEntries.push(`    <track>
      <location>${esc(directAudioUrl)}</location>
      <title>${esc(trackTitle)}</title>
      <album>${esc(albumTitle)}</album>
      <trackNum>${i + 1}</trackNum>
      ${durationMs > 0 ? `<duration>${durationMs}</duration>` : ''}
    </track>`);
        }

        let xspf = `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1.0" xmlns="http://xspf.org/ns/0/">\n`;
        xspf += `  <title>${esc(albumTitle)}</title>\n`;
        if (albumImageUrl) xspf += `  <image>${esc(albumImageUrl)}</image>\n`;
        xspf += `  <trackList>\n${xspfTrackEntries.join('\n')}\n  </trackList>\n</playlist>`;

        const filename = `${albumTitle} [KHInsider].xspf`.replace(/[\\/:*?"<>|]/g, '_');
        downloadXspf(xspf, filename);
        console.log(`${TAG} ✅ ${xspfTrackEntries.length} tracks exported via classic method to "${filename}".`);
        return true;
    };

    // -------------------------------------------------------------------------
    // Main
    // -------------------------------------------------------------------------
    console.log(`${TAG} Starting...`);
    try {
        await trySquid();
    } catch (err) {
        console.warn(`${TAG} squid.wtf strategy failed: ${err.message}`);
        await tryClassic();
    }
})();
