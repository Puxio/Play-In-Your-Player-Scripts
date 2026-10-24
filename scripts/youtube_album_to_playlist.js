/**
 * YouTube Playlist / Album to XSPF - v3.2.0
 *
 * Run in the DevTools console (or with the bookmarklet) on a YouTube
 * playlist or album: https://www.youtube.com/playlist?list=... or a watch
 * page with &list=... in the URL. It builds an XSPF playlist of
 * youtube.com/watch links and downloads it. You need a player that can play
 * YouTube links (for example AIMP with the YouTube plugin, or PotPlayer).
 *
 * The track list is read from YouTube itself: the playlist
 * page data (ytInitialData) and, for playlists longer than 100 videos, the
 * same continuation requests the page makes while scrolling. Every request
 * is same-origin.
 * music.youtube.com and m.youtube.com are sent to www.youtube.com first.
 *
 * Albums (playlist ids starting with OLAK) are saved as
 * "Artist - Album [Youtube].xspf", other playlists as "Title [Youtube].xspf".
 *
 * Changelog:
 *   3.2.0 (2026-10-24) - Every track carries its video thumbnail (<image>,
 *                        i.ytimg.com/vi/<id>/hqdefault.jpg), so players such
 *                        as VLC show it while the track plays; the playlist
 *                        image is the first video's thumbnail.
 *   3.1.1 (2026-10-23) - Progress panel: errors close by themselves after
 *                        20 s (successes after 8 s); the countdown pauses
 *                        while the mouse is over the panel.
 *   3.1.0 (2026-10-23) - Progress panel in the page: what the script is
 *                        doing (videos read so far on long playlists), then
 *                        the result or the error.
 *   3.0.0 (2026-10-16) - Removed Invidious support: the script now runs on
 *                        youtube.com only.
 *   2.1.0 (2026-10-16) - Support the current playlist page layout, where each
 *                        video is a lockupViewModel instead of a
 *                        playlistVideoRenderer (2.0.0 found no videos). Album
 *                        artist taken from the header subtitle
 *                        ("Artist • Album") when present.
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

    const TAG = '[YouTube XSPF]';
    const ui = createPanel('YouTube', TAG);
    try {
        await run();
    } catch (err) {
        ui.fail(`Unexpected error: ${err && err.message ? err.message : err}`);
    }

    async function run() {
        const esc = (s) => String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

        const playlistId = (location.href.match(/[?&]list=([a-zA-Z0-9_-]+)/) || [])[1];
        if (!playlistId) {
            ui.fail('No playlist in the URL (list=...). Open a YouTube playlist or album page.');
            return;
        }

        const host = location.hostname;
        const onYouTube = /(^|\.)youtube\.com$/.test(host);

        if (!onYouTube) {
            ui.fail('Run this script on a YouTube playlist page (www.youtube.com/playlist?list=...).');
            return;
        }

        // Only www.youtube.com serves the desktop page data read below.
        if (host !== 'www.youtube.com') {
            ui.status('Opening this playlist on www.youtube.com: click the bookmark again there.');
            location.href = `https://www.youtube.com/playlist?list=${playlistId}`;
            return;
        }

        let playlistTitle = '';
        let headerArtist = '';
        let videos = []; // { videoId, title, author, position, seconds }

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

        // Older layout: one playlistVideoRenderer per video.
        const fromRenderer = (r) => ({
            videoId: r.videoId,
            title: text(r.title),
            author: text(r.shortBylineText),
            index: parseInt(text(r.index), 10) || null,
            seconds: parseInt(r.lengthSeconds, 10) || parseLength(text(r.lengthText)),
            playable: r.isPlayable !== false
        });

        // Current layout (2026): one lockupViewModel per video. Title in
        // metadata.title.content, channel in the first metadata row, duration
        // as a thumbnail badge ("4:32"), position in the watchEndpoint index.
        const fromLockup = (l) => {
            const meta = (l.metadata && l.metadata.lockupMetadataViewModel) || {};
            const rows = ((meta.metadata || {}).contentMetadataViewModel || {}).metadataRows || [];
            const firstPart = rows[0] && rows[0].metadataParts && rows[0].metadataParts[0];
            const watch = find(l.rendererContext || {}, 'watchEndpoint') || {};
            const badge = JSON.stringify(l.contentImage || {}).match(/"text":"(\d{1,2}(?::\d{2}){1,2})"/);
            return {
                videoId: l.contentId || watch.videoId,
                title: (meta.title && meta.title.content) || '',
                author: (firstPart && firstPart.text && firstPart.text.content) || '',
                index: typeof watch.index === 'number' ? watch.index + 1 : null,
                seconds: badge ? parseLength(badge[1]) : 0,
                playable: true
            };
        };

        // Collect videos and continuation tokens, in page order.
        const collect = (node, out) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return; }
            if (node.playlistVideoRenderer) { out.items.push(fromRenderer(node.playlistVideoRenderer)); return; }
            if (node.lockupViewModel) {
                const l = node.lockupViewModel;
                if (!l.contentType || l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') out.items.push(fromLockup(l));
                return;
            }
            if (node.continuationItemRenderer) {
                const m = JSON.stringify(node.continuationItemRenderer).match(/"token":"([^"]+)"/);
                if (m) out.tokens.push(m[1]);
                return;
            }
            for (const k of Object.keys(node)) collect(node[k], out);
        };

        // Fresh page data for this playlist (window.ytInitialData can be stale
        // after in-site navigation, and is missing on watch pages).
        ui.status('Reading the playlist...');
        let data = null;
        try {
            const res = await fetch(`/playlist?list=${playlistId}`, { credentials: 'same-origin' });
            const html = await res.text();
            const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
            if (m) data = JSON.parse(m[1]);
        } catch (err) {
            ui.warn(`Could not reload the playlist page (${err.message}); using the data already on this page.`);
        }
        if (!data && window.ytInitialData) data = window.ytInitialData;
        if (!data) {
            ui.fail('YouTube playlist data not found.');
            return;
        }

        const metadata = find(data, 'playlistMetadataRenderer');
        const pageHeader = find(data, 'pageHeaderRenderer');
        const playlistHeader = find(data.header || {}, 'playlistHeaderRenderer');
        playlistTitle = (metadata && metadata.title)
            || (pageHeader && pageHeader.pageTitle)
            || (playlistHeader && text(playlistHeader.title))
            || document.title.replace(/\s*-\s*YouTube\s*$/, '');

        // Album header subtitle: "Generation Steel • Album".
        if (playlistHeader && playlistHeader.subtitle) {
            headerArtist = text(playlistHeader.subtitle).split(/\s+•\s+/)[0].trim();
        }

        // The video list: playlistVideoListRenderer (older layout) or the
        // sectionListRenderer of the browse tab (current layout).
        const contents = data.contents || data;
        const out = { items: [], tokens: [] };
        collect(find(contents, 'playlistVideoListRenderer') || find(contents, 'sectionListRenderer') || contents, out);

        // Playlists longer than 100 videos: ask for the next pages like the site does.
        const context = window.ytcfg && window.ytcfg.get ? window.ytcfg.get('INNERTUBE_CONTEXT') : null;
        for (let page = 0; out.tokens.length && page < 100; page++) {
            if (!context) {
                ui.warn(`Only the first ${out.items.length} videos could be read (YouTube config not found).`);
                break;
            }
            const token = out.tokens.shift();
            ui.status(`Reading the playlist: ${out.items.length} videos so far...`);
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
                ui.warn(`Stopped after ${out.items.length} videos: ${err.message}`);
                break;
            }
        }

        let skipped = 0;
        for (const item of out.items) {
            if (!item.videoId || !item.playable) { skipped++; continue; }
            videos.push({
                videoId: item.videoId,
                title: item.title,
                author: item.author,
                position: item.index || videos.length + skipped + 1,
                seconds: item.seconds
            });
        }
        if (skipped) ui.warn(`Skipped ${skipped} unplayable video(s) (deleted or private).`);

        if (videos.length === 0) {
            ui.fail('No videos found in this playlist.');
            return;
        }

        // --- Album or plain playlist ---
        const isAlbum = playlistId.startsWith('OLAK');
        const stripTopic = (name) => (name || '').replace(/\s*-\s*Topic$/, '').trim();
        const albumArtist = isAlbum ? (headerArtist || stripTopic(videos[0].author) || 'Unknown Artist') : '';

        // Video thumbnail, derived from the id: hqdefault exists for every video.
        const thumbnail = (videoId) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

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
            xml += `      <image>${esc(thumbnail(video.videoId))}</image>\n`;
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
        xspf += `  <image>${esc(thumbnail(videos[0].videoId))}</image>\n`;
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

        ui.done(`${videos.length} videos exported${skipped ? ` (${skipped} unplayable skipped)` : ''}.`, fileName);
    }
})();
