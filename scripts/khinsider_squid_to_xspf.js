/**
 * KHInsider-Squid XSPF Playlist Generator - v1.1.0
 *
 * Run in the DevTools console on an album page of khinsider.squid.wtf
 * (https://khinsider.squid.wtf/game-soundtracks/album/...).
 *
 * The site is a Next.js frontend that proxies KHInsider via two API endpoints:
 *   - GET /api/album?url=<khinsider_album_url>
 *       Returns JSON with album metadata and a tracks[] array. Each track has
 *       a "url" field pointing to the KHInsider per-track download page.
 *   - GET /api/download?url=<khinsider_track_page_url>
 *       Returns the KHInsider track page HTML. The page contains direct CDN
 *       links on vgmtreasurechest.com for each format (MP3, FLAC...).
 *
 * This script fetches the album, then for each track fetches the download
 * page and picks the FLAC link when available (falling back to MP3).
 *
 * Changelog:
 *   1.1.0 (2026-10-23) - Progress panel in the page. Track pages are read 3 at
 *                        a time with one retry, and the best format is chosen
 *                        like in khinsider_album_to_xspf.js.
 *   1.0.0 (2026-10-22) - Initial release.
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
                setTimeout(() => host.remove(), 8000);
            },
            // Failure: red line, stays until closed.
            fail(text) {
                line.textContent = `✕ ${text}`;
                line.style.color = '#ff453a';
                bar.style.display = 'none';
                detail.textContent = 'Details in the console (F12).';
                console.error(`${tag} ❌ ${text}`);
            }
        };
    };

    const TAG = '[KHInsider-Squid XSPF]';
    const ui = createPanel('KHInsider-Squid', TAG);
    try {
        await run();
    } catch (err) {
        ui.fail(`Unexpected error: ${err && err.message ? err.message : err}`);
    }

    async function run() {
        const KHINSIDER_ORIGIN = 'https://downloads.khinsider.com';
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
        const durationMs = (str) => {
            if (!str) return 0;
            const parts = str.split(':').map(Number);
            if (parts.some(isNaN)) return 0;
            if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
            if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
            return 0;
        };

        // --- 1. Album metadata ---
        // The equivalent KHInsider URL, from the current pathname.
        const khinsiderAlbumUrl = KHINSIDER_ORIGIN + location.pathname;
        ui.status('Reading the album...');

        let album;
        try {
            const resp = await fetch('/api/album?url=' + encodeURIComponent(khinsiderAlbumUrl));
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            album = await resp.json();
        } catch (err) {
            ui.fail(`Could not read the album (${err.message}). Open an album page.`);
            return;
        }

        const albumTitle = album.name || document.querySelector('h1')?.innerText?.trim() || 'Unknown Album';
        const coverUrl = album.coverUrl || '';
        const tracks = album.tracks || [];

        if (tracks.length === 0) {
            ui.fail('No tracks found for this album.');
            return;
        }
        ui.status(`Reading the download links of ${tracks.length} tracks...`);

        // --- 2. Best direct link for each track ---
        const getBestLink = async (trackPageUrl) => {
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const resp = await fetch('/api/download?url=' + encodeURIComponent(trackPageUrl));
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
                    const links = Array.from(doc.querySelectorAll('a[href]'))
                        .map((a) => {
                            try { return new URL(a.getAttribute('href'), trackPageUrl).href; } catch (e) { return ''; }
                        })
                        .filter((href) => FORMATS.includes(formatOf(href)));
                    // Track pages also end in .mp3: prefer files on the CDN host.
                    const pageHost = new URL(trackPageUrl).host;
                    const files = links.filter((href) => new URL(href).host !== pageHost);
                    const pool = files.length > 0 ? files : links;
                    for (const format of FORMATS) {
                        const hit = pool.find((href) => formatOf(href) === format);
                        if (hit) return hit;
                    }
                    return null;
                } catch (err) {
                    if (attempt === 2) ui.warn(`${trackPageUrl}: ${err.message}`);
                }
            }
            return null;
        };

        // Fetch a few tracks at a time, keeping the album order.
        const links = new Array(tracks.length);
        let next = 0;
        let done = 0;
        const worker = async () => {
            while (next < tracks.length) {
                const i = next++;
                links[i] = tracks[i].url ? await getBestLink(tracks[i].url) : null;
                done++;
                const label = links[i] ? formatOf(links[i]).toUpperCase() : 'no link';
                ui.progress(done, tracks.length, `${tracks[i].title || `Track ${i + 1}`} (${label})`);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, worker));

        // --- 3. Build the XSPF ---
        const counts = {};
        const trackXml = [];
        tracks.forEach((track, i) => {
            const trackTitle = track.title || `Track ${track.number || i + 1}`;
            if (!links[i]) {
                ui.warn(`Skipped (no download link): ${trackTitle}`);
                return;
            }
            const format = formatOf(links[i]).toUpperCase();
            counts[format] = (counts[format] || 0) + 1;
            const ms = durationMs(track.duration);
            let xml = '    <track>\n';
            xml += `      <location>${esc(links[i])}</location>\n`;
            xml += `      <title>${esc(trackTitle)}</title>\n`;
            xml += `      <album>${esc(albumTitle)}</album>\n`;
            xml += `      <trackNum>${track.number || i + 1}</trackNum>\n`;
            if (ms > 0) xml += `      <duration>${ms}</duration>\n`;
            xml += `      <annotation>${format}</annotation>\n`;
            xml += '    </track>';
            trackXml.push(xml);
        });

        if (trackXml.length === 0) {
            ui.fail('No download links found for this album.');
            return;
        }

        let xspf = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n';
        xspf += `  <title>${esc(albumTitle)}</title>\n`;
        xspf += `  <location>${esc(location.href)}</location>\n`;
        if (coverUrl) xspf += `  <image>${esc(coverUrl)}</image>\n`;
        xspf += `  <trackList>\n${trackXml.join('\n')}\n  </trackList>\n</playlist>`;

        // --- 4. Download ---
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

        const skipped = tracks.length - trackXml.length;
        const summary = Object.keys(counts).map((f) => `${counts[f]} ${f}`).join(', ')
            + (skipped ? `, ${skipped} skipped` : '');
        ui.done(`${trackXml.length} tracks exported (${summary}).`, filename);
    }
})();
