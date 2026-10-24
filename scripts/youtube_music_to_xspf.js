/**
 * YouTube Music Album / Playlist to XSPF - v1.0.0
 *
 * Run in the DevTools console (or with the bookmarklet) on music.youtube.com:
 *   - an album page:     music.youtube.com/browse/MPREb_...
 *   - a playlist:        music.youtube.com/playlist?list=...
 *   - a watch page with &list=... in the URL
 * It builds an XSPF playlist and downloads it, without going through
 * www.youtube.com. Track locations are youtube.com/watch links (YouTube
 * Music uses the same video ids), so you need a player that can play YouTube
 * links (for example AIMP with the YouTube plugin, or PotPlayer).
 *
 * The track list comes from the data YouTube Music embeds in its pages
 * (initialData), read with a same-origin request for the album or playlist
 * page; if it is not there, from the same InnerTube "browse" request the app
 * makes. Long playlists are read page by page with the continuation requests
 * the app uses while scrolling. Every request is same-origin.
 *
 * Every track carries square cover art (<image>): the song's own artwork in
 * playlists, the album cover on album pages, enlarged to 544x544.
 *
 * Albums are saved as "Artist - Album [YouTube Music].xspf", other playlists
 * as "Title [YouTube Music].xspf". Radios and mixes (list=RD...) are built on
 * the fly and cannot be exported.
 *
 * Changelog:
 *   1.0.0 (2026-10-24) - First version.
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

    const TAG = '[YouTube Music XSPF]';
    const ui = createPanel('YouTube Music', TAG);
    try {
        await run();
    } catch (err) {
        ui.fail(`Unexpected error: ${err && err.message ? err.message : err}`);
    }

    async function run() {
        const esc = (s) => String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

        if (location.hostname !== 'music.youtube.com') {
            ui.fail('Run this script on music.youtube.com (for www.youtube.com use youtube_album_to_playlist.js).');
            return;
        }

        // --- 1. Which album or playlist ---
        const pageUrlObj = new URL(location.href);
        const listId = pageUrlObj.searchParams.get('list');
        const browseMatch = pageUrlObj.pathname.match(/^\/browse\/([^/?#]+)/);
        let browseId = browseMatch ? decodeURIComponent(browseMatch[1]) : (listId ? `VL${listId}` : null);
        if (!browseId) {
            ui.fail('Open an album or a playlist (music.youtube.com/playlist?list=... or /browse/MPREb_...).');
            return;
        }
        if (/^VLRD/.test(browseId)) {
            ui.fail('Radios and mixes are generated on the fly and cannot be exported. Open an album or a saved playlist.');
            return;
        }
        const pagePath = browseId.startsWith('VL') ? `/playlist?list=${encodeURIComponent(browseId.slice(2))}` : `/browse/${encodeURIComponent(browseId)}`;

        // --- Helpers for YouTube Music data ---
        // Text of a text object: { simpleText } or { runs: [{ text }] }.
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

        // Largest image of a thumbnail object.
        const bestThumb = (node) => {
            const list = find(node, 'thumbnails');
            if (!Array.isArray(list) || list.length === 0) return '';
            return list.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)).url || '';
        };

        // YouTube Music artwork (googleusercontent) can be asked at any size.
        const enlarge = (url) => (url || '').replace(/=w\d+-h\d+/, '=w544-h544').replace(/=s\d+(?=[-&]|$)/, '=s544');

        // --- 2. Page data ---
        // Body of a single-quoted JavaScript string literal: \xNN, \uNNNN, \\ ...
        const unescapeJs = (s) => s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (all, e) => {
            if (e.length === 3 && e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
            if (e.length === 5 && e[0] === 'u') return String.fromCharCode(parseInt(e.slice(1), 16));
            const named = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
            return Object.prototype.hasOwnProperty.call(named, e) ? named[e] : e;
        });

        // The single-quoted string starting at html[start] (the opening quote).
        const readQuoted = (html, start) => {
            let i = start + 1;
            while (i < html.length && html[i] !== "'") i += html[i] === '\\' ? 2 : 1;
            return html.slice(start + 1, i);
        };

        // The page HTML carries: initialData.push({path: '\/browse', params: JSON.parse('...'), data: '...'});
        const readInitialData = (html) => {
            const entries = [];
            const marker = /initialData\.push\(\{\s*path:\s*'/g;
            let m;
            while ((m = marker.exec(html))) {
                const pathQuote = m.index + m[0].length - 1;
                const path = unescapeJs(readQuoted(html, pathQuote));
                const dataMarker = /data:\s*'/g;
                dataMarker.lastIndex = pathQuote;
                const dm = dataMarker.exec(html);
                if (!dm) break;
                const raw = readQuoted(html, dm.index + dm[0].length - 1);
                marker.lastIndex = dm.index + dm[0].length + raw.length;
                try {
                    entries.push({ path, data: JSON.parse(unescapeJs(raw)) });
                } catch (err) {
                    // Not JSON: skip it.
                }
            }
            return entries;
        };

        const context = window.ytcfg && window.ytcfg.get ? window.ytcfg.get('INNERTUBE_CONTEXT') : null;
        const api = async (path, body) => {
            if (!context) throw new Error('YouTube Music config (ytcfg) not found');
            const res = await fetch(path, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ context }, body))
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        };

        ui.status('Reading the album or playlist...');
        let data = null;
        try {
            const res = await fetch(pagePath, { credentials: 'same-origin' });
            const entries = readInitialData(await res.text());
            const hit = entries.find((e) => /browse/.test(e.path) && e.data && e.data.contents)
                || entries.find((e) => e.data && e.data.contents);
            if (hit) data = hit.data;
        } catch (err) {
            ui.warn(`Could not read the page data (${err.message}); asking the API instead.`);
        }
        if (!data) {
            try {
                data = await api('/youtubei/v1/browse?prettyPrint=false', { browseId });
            } catch (err) {
                ui.fail(`Could not read the album or playlist: ${err.message}.`);
                return;
            }
        }

        // --- 3. Header: title, album artist, cover ---
        const header = find(data, 'musicResponsiveHeaderRenderer')
            || find(data, 'musicDetailHeaderRenderer')
            || find(data, 'musicImmersiveHeaderRenderer')
            || find(data, 'musicVisualHeaderRenderer')
            || {};
        const isArtistRun = (run) => /MUSIC_PAGE_TYPE_ARTIST|MUSIC_PAGE_TYPE_USER_CHANNEL/.test(JSON.stringify(run.navigationEndpoint || {}));
        const listTitle = text(header.title) || document.title.replace(/\s*-\s*YouTube Music\s*$/, '');
        const subtitle = text(header.subtitle);
        const headerArtist = text(header.straplineTextOne)
            || ((header.subtitle && header.subtitle.runs) || []).filter(isArtistRun).map((r) => r.text).join(', ');
        const cover = enlarge(bestThumb(header.thumbnail));
        const isAlbum = browseId.startsWith('MPREb') || (listId || '').startsWith('OLAK')
            || /^(Album|EP|Single|Singolo)\b/i.test(subtitle);

        // --- 4. Track list, then the next pages for long playlists ---
        const contents = data.contents || data;
        const shelf = find(contents, 'musicPlaylistShelfRenderer') || find(contents, 'musicShelfRenderer');
        const out = { items: [], tokens: [] };
        const collect = (node) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(collect); return; }
            if (node.musicResponsiveListItemRenderer) { out.items.push(node.musicResponsiveListItemRenderer); return; }
            if (node.continuationItemRenderer) {
                const m = JSON.stringify(node.continuationItemRenderer).match(/"token":"([^"]+)"/);
                if (m) out.tokens.push({ token: m[1], legacy: false });
                return;
            }
            if (node.nextContinuationData && node.nextContinuationData.continuation) {
                out.tokens.push({ token: node.nextContinuationData.continuation, legacy: true });
                return;
            }
            for (const k of Object.keys(node)) collect(node[k]);
        };
        collect(shelf || contents);

        for (let page = 0; out.tokens.length && page < 100; page++) {
            const { token, legacy } = out.tokens.shift();
            ui.status(`Reading the track list... ${out.items.length} tracks so far`);
            try {
                const json = legacy
                    ? await api(`/youtubei/v1/browse?ctoken=${encodeURIComponent(token)}&continuation=${encodeURIComponent(token)}&type=next&prettyPrint=false`, {})
                    : await api('/youtubei/v1/browse?prettyPrint=false', { continuation: token });
                collect(json.continuationContents || json.onResponseReceivedActions || json);
            } catch (err) {
                ui.warn(`Stopped after ${out.items.length} tracks: ${err.message}`);
                break;
            }
        }

        // --- 5. One entry per track ---
        const flex = (item, i) => {
            const col = item.flexColumns && item.flexColumns[i];
            return col && col.musicResponsiveListItemFlexColumnRenderer ? col.musicResponsiveListItemFlexColumnRenderer.text : null;
        };
        const fixedText = (item) => (item.fixedColumns || [])
            .map((c) => text(c.musicResponsiveListItemFixedColumnRenderer && c.musicResponsiveListItemFixedColumnRenderer.text)).join(' ');

        const tracks = [];
        let skipped = 0;
        for (const item of out.items) {
            const watch = find(item, 'watchEndpoint') || {};
            const videoId = (item.playlistItemData && item.playlistItemData.videoId) || watch.videoId;
            const greyed = item.musicItemRendererDisplayPolicy === 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT';
            if (!videoId || greyed) { skipped++; continue; }

            const second = flex(item, 1);
            let artist = ((second && second.runs) || []).filter(isArtistRun).map((r) => r.text).join(', ');
            if (!artist && !isAlbum) artist = text(second).split(' • ')[0].trim();
            if (!artist) artist = headerArtist;

            const length = (fixedText(item).match(/\d+(?::\d{2}){1,2}/) || [])[0];
            tracks.push({
                videoId,
                title: text(flex(item, 0)) || 'Unknown Title',
                artist: artist || 'Unknown Artist',
                position: parseInt(text(item.index), 10) || tracks.length + skipped + 1,
                seconds: length ? parseLength(length) : 0,
                image: enlarge(item.thumbnail ? bestThumb(item.thumbnail) : '') || cover
            });
        }
        if (skipped) ui.warn(`Skipped ${skipped} unavailable track(s).`);

        if (tracks.length === 0) {
            ui.fail('No tracks found on this page.');
            return;
        }

        // --- 6. XSPF ---
        const albumArtist = isAlbum ? (headerArtist || tracks[0].artist) : '';
        const trackXml = tracks.map((t) => {
            let xml = '    <track>\n';
            xml += `      <trackNum>${esc(t.position)}</trackNum>\n`;
            xml += `      <title>${esc(t.title)}</title>\n`;
            xml += `      <creator>${esc(t.artist)}</creator>\n`;
            if (isAlbum) xml += `      <album>${esc(listTitle)}</album>\n`;
            xml += `      <location>${esc('https://www.youtube.com/watch?v=' + t.videoId)}</location>\n`;
            const image = t.image || `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg`;
            xml += `      <image>${esc(image)}</image>\n`;
            if (t.seconds) xml += `      <duration>${t.seconds * 1000}</duration>\n`;
            xml += '    </track>';
            return xml;
        });

        const name = listTitle || 'Unknown Playlist';
        const fileName = (isAlbum ? `${albumArtist} - ${name} [YouTube Music].xspf` : `${name} [YouTube Music].xspf`)
            .replace(/[\\/:*?"<>|]/g, '_').replace(/\s{2,}/g, ' ').trim();

        let xspf = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n';
        xspf += `  <title>${esc(name)}</title>\n`;
        if (albumArtist) xspf += `  <creator>${esc(albumArtist)}</creator>\n`;
        xspf += `  <location>${esc(location.href)}</location>\n`;
        const playlistImage = cover || tracks[0].image;
        if (playlistImage) xspf += `  <image>${esc(playlistImage)}</image>\n`;
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

        ui.done(`${tracks.length} tracks exported${skipped ? ` (${skipped} unavailable skipped)` : ''}.`, fileName);
    }
})();
