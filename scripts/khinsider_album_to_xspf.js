/**
 * KHInsider XSPF Playlist Generator - v4.1.0
 *
 * Run in the DevTools console on a KHInsider album page
 * (downloads.khinsider.com/game-soundtracks/album/...).
 *
 * Strategy:
 *   1. Try to fetch the same album from khinsider.squid.wtf via its
 *      /api/album and /api/download proxy endpoints. These return direct CDN
 *      links on vgmtreasurechest.com, typically including FLAC files at
 *      higher quality than the classic KHInsider MP3 links.
 *   2. If the album is not available there (or any step fails), fall back to
 *      the classic KHInsider method: visit each track page on
 *      downloads.khinsider.com and extract the direct CDN link.
 *
 * Changelog:
 *   4.1.0 (2026-10-22) - Fixed squid.wtf strategy: khinsider.squid.wtf is a
 *                        Next.js proxy (not Subsonic). Uses /api/album and
 *                        /api/download endpoints to fetch FLAC links.
 *   4.0.0 (2026-10-22) - Added squid.wtf FLAC-first strategy (incorrect
 *                        Subsonic approach, now replaced).
 *   3.3   (prior)      - Classic per-track extraction only.
 */
(async function () {
    'use strict';

    const TAG = '[KHInsider XSPF]';
    const SQUID_ORIGIN = 'https://khinsider.squid.wtf';
    const KHINSIDER_ORIGIN = 'https://downloads.khinsider.com';

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    const durationMs = (str) => {
        if (!str) return 0;
        const parts = str.split(':').map(Number);
        if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
        if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        return 0;
    };

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
    // Strategy 1: khinsider.squid.wtf proxy (FLAC quality)
    // -------------------------------------------------------------------------
    const trySquid = async () => {
        const khinsiderAlbumUrl = KHINSIDER_ORIGIN + location.pathname;
        console.log(`${TAG} Trying squid.wtf for: ${khinsiderAlbumUrl}`);

        // Fetch album metadata via the squid.wtf proxy.
        const albumResp = await fetch(SQUID_ORIGIN + '/api/album?url=' + encodeURIComponent(khinsiderAlbumUrl));
        if (!albumResp.ok) throw new Error(`squid.wtf /api/album HTTP ${albumResp.status}`);
        const album = await albumResp.json();

        const tracks = album.tracks || [];
        if (tracks.length === 0) throw new Error('No tracks returned by squid.wtf');

        const albumTitle = album.name || document.querySelector('h2')?.innerText.trim() || 'Unknown Album';
        const coverUrl = album.coverUrl || '';

        console.log(`${TAG} squid.wtf found ${tracks.length} tracks. Fetching FLAC links...`);

        const AUDIO_EXT = /\.(flac|mp3|ogg|wav)(\?|$)/i;

        const getDirectLink = async (trackPageUrl) => {
            try {
                const resp = await fetch(SQUID_ORIGIN + '/api/download?url=' + encodeURIComponent(trackPageUrl));
                if (!resp.ok) return null;
                const html = await resp.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const links = [...doc.querySelectorAll('a[href]')]
                    .map(a => a.href)
                    .filter(h => AUDIO_EXT.test(h));
                return links.find(h => /\.flac(\?|$)/i.test(h)) || links.find(h => /\.mp3(\?|$)/i.test(h)) || null;
            } catch {
                return null;
            }
        };

        const xspfTrackEntries = [];
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const trackTitle = track.title || `Track ${track.number || i + 1}`;
            console.log(`${TAG} [${i + 1}/${tracks.length}] ${trackTitle}`);

            const audioUrl = await getDirectLink(track.url);
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

        if (xspfTrackEntries.length === 0) throw new Error('No tracks successfully fetched from squid.wtf');

        let xspf = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n';
        xspf += `  <title>${esc(albumTitle)}</title>\n`;
        xspf += `  <location>${esc(location.href)}</location>\n`;
        if (coverUrl) xspf += `  <image>${esc(coverUrl)}</image>\n`;
        xspf += `  <trackList>\n${xspfTrackEntries.join('\n')}\n  </trackList>\n</playlist>`;

        const filename = `${albumTitle} [KHInsider-Squid].xspf`.replace(/[\\/:*?"<>|]/g, '_');
        downloadXspf(xspf, filename);
        console.log(`${TAG} Done via squid.wtf: ${xspfTrackEntries.length}/${tracks.length} tracks to "${filename}".`);
        return true;
    };

    // -------------------------------------------------------------------------
    // Strategy 2: Classic KHInsider per-track extraction (MP3 fallback)
    // -------------------------------------------------------------------------
    const tryClassic = async () => {
        console.log(`${TAG} Falling back to classic KHInsider extraction...`);

        const playlistTable = document.getElementById('songlist');
        if (!playlistTable) {
            console.error(`${TAG} Table #songlist not found. Ensure you are on a KHInsider album page.`);
            return false;
        }

        const albumTitle = document.querySelector('h2')?.innerText.trim() || 'Unknown Album';
        const albumImageAnchor = document.querySelector('.albumImage a');
        const albumImageUrl = albumImageAnchor ? albumImageAnchor.href : '';

        const rows = Array.from(playlistTable.querySelectorAll('tr')).filter(row =>
            row.querySelector('a[href*="/game-soundtracks/album/"]') && !row.querySelector('th')
        );

        if (rows.length === 0) {
            console.error(`${TAG} No tracks found in the playlist table.`);
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
            } catch {
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
                console.warn(`${TAG} Failed to retrieve link for: ${trackTitle}`);
                continue;
            }

            const cells = Array.from(row.querySelectorAll('td'));
            const durationCell = cells.find(td => /^\d+:\d+(:\d+)?$/.test(td.innerText.trim()));
            let ms = 0;
            if (durationCell) {
                const parts = durationCell.innerText.trim().split(':').map(Number);
                ms = parts.length === 2
                    ? (parts[0] * 60 + parts[1]) * 1000
                    : (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
            }

            xspfTrackEntries.push(`    <track>
      <location>${esc(directAudioUrl)}</location>
      <title>${esc(trackTitle)}</title>
      <album>${esc(albumTitle)}</album>
      <trackNum>${i + 1}</trackNum>
      ${ms > 0 ? `<duration>${ms}</duration>` : ''}
    </track>`);
        }

        let xspf = `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n`;
        xspf += `  <title>${esc(albumTitle)}</title>\n`;
        if (albumImageUrl) xspf += `  <image>${esc(albumImageUrl)}</image>\n`;
        xspf += `  <trackList>\n${xspfTrackEntries.join('\n')}\n  </trackList>\n</playlist>`;

        const filename = `${albumTitle} [KHInsider].xspf`.replace(/[\\/:*?"<>|]/g, '_');
        downloadXspf(xspf, filename);
        console.log(`${TAG} Done via classic: ${xspfTrackEntries.length} tracks to "${filename}".`);
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
