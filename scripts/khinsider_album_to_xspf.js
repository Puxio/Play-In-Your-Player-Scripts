/**
 * KHInsider XSPF Playlist Generator - v5.1.1
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
 *   5.1.1 (2026-10-23) - Progress panel: errors close by themselves after
 *                        20 s (successes after 8 s); the countdown pauses
 *                        while the mouse is over the panel.
 *   5.1.0 (2026-10-23) - Progress panel in the page: what the script is
 *                        doing, a progress bar while the track pages are
 *                        read, then the result or the error.
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

    // --- Progress panel (identical block in every script: keep them in sync) ---
    // A small box in the top right corner of the page shows what the script
    // is doing; every message also goes to the console. It is built with DOM
    // calls only (no innerHTML, no <style>), so it works on pages with a
    // strict Content-Security-Policy or Trusted Types (YouTube).
    const createPanel = (site, tag) => {
        const previous = document.getElementById('pipp-panel');
        if (previous) previous.remove();
        const add = (parent, css, text) => {
            const node = document.createElement('div');
            Object.assign(node.style, css);
            if (text) node.textContent = text;
            parent.appendChild(node);
            return node;
        };
        const host = document.createElement('div');
        host.id = 'pipp-panel';
        host.style.all = 'initial';
        Object.assign(host.style, { position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647' });
        const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
        const box = add(root, {
            width: '300px', boxSizing: 'border-box', padding: '12px 14px', borderRadius: '10px',
            background: '#1d1d1f', color: '#f5f5f7', boxShadow: '0 6px 24px rgba(0,0,0,.35)',
            font: '13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', textAlign: 'left'
        });
        const head = add(box, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' });
        add(head, { fontWeight: '600' }, `Play In My Player · ${site}`);
        const close = add(head, { cursor: 'pointer', color: '#a1a1a6', fontSize: '18px', lineHeight: '1', paddingLeft: '8px' }, '×');
        close.title = 'Close';
        close.onclick = () => host.remove();
        const line = add(box, { overflowWrap: 'anywhere' });
        const bar = add(box, { display: 'none', height: '4px', margin: '8px 0 4px', borderRadius: '2px', background: '#3a3a3c', overflow: 'hidden' });
        const fill = add(bar, { width: '0%', height: '100%', background: '#ff7a33', transition: 'width .2s' });
        const detail = add(box, { color: '#a1a1a6', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
        // Close after a delay; the countdown pauses while the mouse is over the panel.
        let timer = null;
        let delay = 0;
        const closeLater = (ms) => {
            delay = ms;
            clearTimeout(timer);
            timer = setTimeout(() => host.remove(), ms);
        };
        box.addEventListener('mouseenter', () => clearTimeout(timer));
        box.addEventListener('mouseleave', () => { if (delay) closeLater(delay); });
        (document.body || document.documentElement).appendChild(host);
        return {
            // Main line: what the script is doing now.
            status(text) {
                line.textContent = text;
                console.log(`${tag} ${text}`);
            },
            // Progress bar and counter, with the item just processed.
            progress(done, total, text) {
                bar.style.display = 'block';
                fill.style.width = `${Math.round((done / total) * 100)}%`;
                detail.textContent = `${done} / ${total}${text ? ` · ${text}` : ''}`;
                console.log(`${tag} [${done}/${total}] ${text || ''}`);
            },
            // Console only: problems that do not stop the export.
            warn(text) {
                console.warn(`${tag} ⚠️ ${text}`);
            },
            // Success: green line, closes itself after 8 seconds.
            done(text, note) {
                line.textContent = `✓ ${text}`;
                line.style.color = '#30d158';
                fill.style.width = '100%';
                detail.textContent = note || '';
                console.log(`${tag} ✅ ${text}${note ? ` ${note}` : ''}`);
                closeLater(8000);
            },
            // Failure: red line, closes itself after 20 seconds.
            fail(text) {
                line.textContent = `✕ ${text}`;
                line.style.color = '#ff453a';
                bar.style.display = 'none';
                detail.textContent = 'Details in the console (F12).';
                console.error(`${tag} ❌ ${text}`);
                closeLater(20000);
            }
        };
    };

    const TAG = '[KHInsider XSPF]';
    const ui = createPanel('KHInsider', TAG);
    try {
        await run();
    } catch (err) {
        ui.fail(`Unexpected error: ${err && err.message ? err.message : err}`);
    }

    async function run() {
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
            ui.fail('Track list not found. Open a KHInsider album page.');
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
            ui.fail('No tracks found in the track list.');
            return;
        }
        ui.status(`Reading the download links of ${tracks.length} tracks...`);

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
                    if (attempt === 2) ui.warn(`${pageUrl}: ${err.message}`);
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
                ui.progress(done, tracks.length, `${tracks[i].title} (${label})`);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, worker));

        // --- 3. Build the XSPF ---
        const counts = {};
        const trackXml = [];
        tracks.forEach((track, i) => {
            if (!links[i]) {
                ui.warn(`Skipped (no download link): ${track.title}`);
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
            ui.fail('No download links found on the track pages.');
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

        const skipped = tracks.length - trackXml.length;
        const summary = Object.keys(counts).map((f) => `${counts[f]} ${f}`).join(', ')
            + (skipped ? `, ${skipped} skipped` : '');
        ui.done(`${trackXml.length} tracks exported (${summary}).`, filename);
    }
})();
