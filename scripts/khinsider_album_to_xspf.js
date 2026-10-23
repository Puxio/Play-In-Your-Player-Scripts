/**
 * KHInsider XSPF Playlist Generator - v5.0.0
 *
 * Run in the DevTools console on a KHInsider album page
 * (downloads.khinsider.com/game-soundtracks/album/...).
 *
 * Every track has its own page on KHInsider with one direct link per format
 * the album offers ("Click here to download as MP3", "... as FLAC"), all on
 * the vgmtreasurechest.com CDN. The script visits each track page and keeps
 * the best format available: FLAC when the album has it, otherwise MP3.
 *
 * khinsider.squid.wtf serves the same files: its server reads these same
 * track pages. Its API cannot be used from downloads.khinsider.com (the
 * browser blocks cross-origin calls), and it is not needed here.
 *
 * Changelog:
 *   5.0.0 (2026-10-23) - FLAC links read directly from the KHInsider track
 *                        pages, which list every format. The squid.wtf
 *                        strategy is removed: its API calls failed from this
 *                        site (cross-origin), so every export fell back to
 *                        MP3. Track pages are fetched 3 at a time, with one
 *                        retry each.
 *   4.1.0 (2026-10-22) - squid.wtf strategy via /api/album and /api/download.
 *   4.0.0 (2026-10-22) - squid.wtf strategy via the Subsonic API (incorrect).
 *   3.3   (prior)      - Classic per-track extraction, MP3 only.
 */
(async function () {
    'use strict';

    const TAG = '[KHInsider XSPF]';
    // Formats in order of preference, best first.
    const FORMATS = ['flac', 'wav', 'mp3', 'm4a', 'ogg', 'opus', 'aac'];
    const CONCURRENCY = 3;

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    // File extension of a URL ("flac", "mp3", ...), or '' when it has none.
    const formatOf = (url) => {
        try {
            const m = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
            return m ? m[1].toLowerCase() : '';
        } catch (e) {
            return '';
        }
    };

    // "M:SS" or "H:MM:SS" to milliseconds, 0 when absent.
    const toMs = (text) => {
        const parts = (text || '').trim().split(':').map(Number);
        if (parts.some(isNaN)) return 0;
        if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
        if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        return 0;
    };

    // --- 1. Album and track rows ---
    const playlistTable = document.getElementById('songlist');
    if (!playlistTable) {
        console.error(`${TAG} ❌ Table #songlist not found. Open a KHInsider album page.`);
        return;
    }

    const albumTitle = document.querySelector('h2')?.innerText.trim() || 'Unknown Album';
    const albumImageAnchor = document.querySelector('.albumImage a');
    const albumImageUrl = albumImageAnchor ? albumImageAnchor.href : '';

    // A row links to its track page several times (title, time, sizes, download
    // icon): the title link is the one whose text is not an icon, time or size.
    const isTitleLink = (a) => {
        const text = a.innerText.trim();
        return text !== '' && !a.querySelector('i, .material-icons')
            && !/^\d+:\d{2}(:\d{2})?$/.test(text) && !/^[\d.,]+\s*[KMG]B$/i.test(text);
    };

    const tracks = Array.from(playlistTable.querySelectorAll('tr'))
        .filter((row) => row.querySelector('a[href*="/game-soundtracks/album/"]') && !row.querySelector('th'))
        .map((row) => {
            const rowLinks = Array.from(row.querySelectorAll('a[href*="/game-soundtracks/album/"]'));
            const link = rowLinks.find(isTitleLink) || rowLinks[0];
            const durationCell = Array.from(row.querySelectorAll('td'))
                .find((td) => /^\d+:\d+(:\d+)?$/.test(td.innerText.trim()));
            return {
                title: link.innerText.trim(),
                pageUrl: link.href,
                durationMs: durationCell ? toMs(durationCell.innerText) : 0
            };
        });

    if (tracks.length === 0) {
        console.error(`${TAG} ❌ No tracks found in the #songlist table.`);
        return;
    }
    console.log(`${TAG} ${tracks.length} tracks. Reading the download links...`);

    // --- 2. Best direct link on each track page ---
    const getBestLink = async (pageUrl) => {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const response = await fetch(pageUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
                const links = Array.from(doc.querySelectorAll('a[href]'))
                    .map((a) => {
                        try { return new URL(a.getAttribute('href'), pageUrl).href; } catch (e) { return ''; }
                    })
                    .filter((href) => FORMATS.includes(formatOf(href)));
                // Track pages also end in .mp3: prefer files on the CDN host.
                const pageHost = new URL(pageUrl).host;
                const files = links.filter((href) => new URL(href).host !== pageHost);
                const pool = files.length > 0 ? files : links;
                for (const format of FORMATS) {
                    const hit = pool.find((href) => formatOf(href) === format);
                    if (hit) return hit;
                }
                return null;
            } catch (err) {
                if (attempt === 2) console.warn(`${TAG} ⚠️ ${pageUrl}: ${err.message}`);
            }
        }
        return null;
    };

    // Fetch a few track pages at a time, keeping the album order.
    const links = new Array(tracks.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < tracks.length) {
            const i = next++;
            links[i] = await getBestLink(tracks[i].pageUrl);
            done++;
            const label = links[i] ? formatOf(links[i]).toUpperCase() : 'no link';
            console.log(`${TAG} [${done}/${tracks.length}] ${tracks[i].title}: ${label}`);
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, worker));

    // --- 3. Build the XSPF ---
    const counts = {};
    const trackXml = [];
    tracks.forEach((track, i) => {
        if (!links[i]) {
            console.warn(`${TAG} ⚠️ Skipped (no download link): ${track.title}`);
            return;
        }
        const format = formatOf(links[i]).toUpperCase();
        counts[format] = (counts[format] || 0) + 1;
        let xml = '    <track>\n';
        xml += `      <location>${esc(links[i])}</location>\n`;
        xml += `      <title>${esc(track.title)}</title>\n`;
        xml += `      <album>${esc(albumTitle)}</album>\n`;
        xml += `      <trackNum>${i + 1}</trackNum>\n`;
        if (track.durationMs > 0) xml += `      <duration>${track.durationMs}</duration>\n`;
        xml += '    </track>';
        trackXml.push(xml);
    });

    if (trackXml.length === 0) {
        console.error(`${TAG} ❌ No download links found on the track pages.`);
        return;
    }

    let xspf = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n';
    xspf += `  <title>${esc(albumTitle)}</title>\n`;
    xspf += `  <location>${esc(location.href)}</location>\n`;
    if (albumImageUrl) xspf += `  <image>${esc(albumImageUrl)}</image>\n`;
    xspf += `  <trackList>\n${trackXml.join('\n')}\n  </trackList>\n</playlist>`;

    // --- 4. Download ---
    const filename = `${albumTitle} [KHInsider].xspf`.replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([xspf], { type: 'application/xspf+xml' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    const summary = Object.keys(counts).map((f) => `${counts[f]} ${f}`).join(', ');
    console.log(`${TAG} ✅ ${trackXml.length}/${tracks.length} tracks (${summary}) exported to "${filename}".`);
})();
