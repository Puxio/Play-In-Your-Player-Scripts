/**
 * Squidify XSPF Playlist Generator - v3.3.0
 *
 * Run in the DevTools console on an album or playlist page of:
 *   - www.squidify.org
 *
 * Squidify loads cover art from /rest/getCoverArt with guest Subsonic
 * credentials (u, t, s, v, c). The script reuses those parameters to call
 * the Subsonic API for the track list and writes /rest/stream URLs for each
 * track (typically FLAC). Subsonic token authentication does not expire on
 * its own, so the XSPF keeps working until the site changes its credentials.
 *
 * Note: khinsider.squid.wtf is a different site (Next.js, not Subsonic).
 * Use khinsider_squid_to_xspf.js for that site instead.
 *
 * Changelog:
 *   3.3.0 (2026-10-23) - Progress panel in the page: what the script is
 *                        doing, then the result or the error.
 *   3.2.0 (2026-10-22) - Scope narrowed to squidify.org only. khinsider.squid.wtf
 *                        is not Subsonic and is handled by its own script.
 *   3.1.0 (2026-10-22) - Wait up to 10 s for the cover art to appear in
 *                        the DOM (SPA pages render it asynchronously).
 *                        Added startup log so the user sees the script ran.
 *   3.0.0 (2026-10-22) - Unified script: supports squidify.org and
 *                        khinsider.squid.wtf. Filename tag reflects the
 *                        source site. Renamed from "Squidify.org XSPF
 *                        Playlist Generator".
 *   2.0.0 (2026-10-16) - Rewritten for the new Squidify site (Svelte). The
 *                        [role=table] track list no longer exists; tracks
 *                        now come from the Subsonic API instead of clicking
 *                        each row and reading the <audio> element.
 *   1.0.0              - Clicked each [role=table] row and captured the
 *                        audio source and duration.
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

    const TAG = '[Squidify XSPF]';
    const ui = createPanel('Squidify', TAG);
    try {
        await run();
    } catch (err) {
        ui.fail(`Unexpected error: ${err && err.message ? err.message : err}`);
    }

    async function run() {
        const DEFAULT_API_VERSION = '1.16.1';
        const DEFAULT_CLIENT = 'play-in-your-player';
        const siteTag = 'Squidify';

        const esc = (s) => String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

        // Poll for a DOM element matching a selector, up to timeoutMs.
        const waitFor = (selector, timeoutMs = 10000) => new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) { resolve(el); return; }
            const observer = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) { observer.disconnect(); clearTimeout(timer); resolve(found); }
            });
            const timer = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timed out waiting for "${selector}" after ${timeoutMs}ms`));
            }, timeoutMs);
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        });

        // --- 1. Guest credentials, taken from the cover art URL on the page ---
        ui.status('Waiting for the page to show the album...');
        let coverImg;
        try {
            coverImg = await waitFor('img[src*="/rest/getCoverArt"]', 10000);
        } catch (e) {
            ui.fail('Cover art not found after 10 s. Open an album or playlist page and wait for it to load.');
            return;
        }
        const coverUrl = new URL(coverImg.src, location.href);
        const origin = coverUrl.origin;

        const auth = new URLSearchParams();
        for (const [key, value] of coverUrl.searchParams) {
            if (!['id', 'size', 'f'].includes(key)) auth.set(key, value);
        }
        if (!auth.has('u') || !(auth.has('t') || auth.has('p'))) {
            console.log(`${TAG} Cover URL: ${coverImg.src}`);
            ui.fail('No Subsonic credentials in the cover art URL.');
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

        ui.status('Reading the track list...');
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
                ui.warn(`id "${id}" rejected: ${err.message}`);
            }
        }

        if (!info) {
            ui.fail(`Could not read the track list from the Subsonic API (tried: ${ids.join(', ') || 'no id found'}).`);
            return;
        }
        if (songs.length === 0) {
            ui.fail(`The ${isPlaylist ? 'playlist' : 'album'} has no tracks.`);
            return;
        }

        // --- 3. Build the XSPF ---
        const title = info.name || (document.querySelector('h1') || {}).innerText || `${siteTag} Playlist`;
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
        const filename = `${title} [${siteTag}].xspf`.replace(/[\\/:*?"<>|]/g, '_');
        const blob = new Blob([xspf], { type: 'application/xspf+xml' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

        ui.done(`${songs.length} tracks exported.`, filename);
    }
})();
