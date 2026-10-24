/**
 * XSPF Playlist Generator for Musify.club - v1.3.0
 *
 * This script is designed to run in the DevTools console of an Album/Playlist
 * page on musify.club. It extracts track details, fetches the real MP3 URL
 * from the /api/track/{id}/stream-url endpoint, constructs the XSPF file,
 * and initiates the download.
 *
 * Updated for the 2026 Musify.club layout:
 *  - Track rows still use `.playlist__item`, but with new internal markup.
 *  - The play button no longer carries `data-play-url`; instead clicking it
 *    triggers a fetch to `/api/track/{trackId}/stream-url` which returns
 *    JSON `{ url, title, cover, trackUrl }` with a signed MP3 URL.
 *  - This script reproduces that call for every track. Calls are same-origin
 *    so there are no CORS issues. Signed URLs include an `expires` parameter,
 *    so the resulting XSPF is time-limited (the signature lasts a few hours).
 *
 * Changelog:
 *   1.3.0 (2026-10-24) - Every track carries its cover (<image>): the one
 *                        returned by the stream-url API, else the album
 *                        cover. Players that show per-track art (VLC) display it.
 *   1.2.1 (2026-10-23) - Progress panel: errors close by themselves after
 *                        20 s (successes after 8 s); the countdown pauses
 *                        while the mouse is over the panel.
 *   1.2.0 (2026-10-23) - Progress panel in the page: what the script is
 *                        doing, a progress bar while the stream links are
 *                        read, then the result or the error.
 *   1.1.5 (2026-10-23) - Ignore the "Popular tracks by <artist>" rows in the
 *                        sidebar, which use the same .playlist__item markup and
 *                        ended up appended to the playlist. Rows with a track id
 *                        already seen are skipped too.
 *   1.1.4 (2026-10-16) - Fix the filename and album title when the album page
 *                        byArtist element has no text (e.g. "_(1998) - Virgin
 *                        Steele - Invictus"). The artist is now read from its
 *                        content attribute or nested itemprop="name", then
 *                        from the H1, then from the first track row.
 *   1.1.3 (2026-10-16) - Revert the query-string strip from 1.1.1. The
 *                        `expires` and `sig` parameters authenticate the
 *                        request on the Musify CDN; without them the server
 *                        responds HTTP 404 and playback fails. The XSPF is
 *                        now time-limited but actually plays.
 *   1.1.2 (2026-06-14) - Add .tracklist__meta2 span:first-child as primary
 *                        duration selector for the 2026 layout.
 *   1.1.1 (2026-06-14) - Strip query parameters (expires, sig) from stream URLs
 *                        in the XSPF <location> field. [REVERTED in 1.1.3]
 *   1.1.0 (2026-05-08) - Adapted to the new musify.club layout: now reads
 *                        data-track-id from each .playlist__item row and
 *                        fetches signed MP3 URLs from /api/track/{id}/stream-url.
 *   1.0.0              - Initial release.
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

    const TAG = '[Musify XSPF]';
    const ui = createPanel('Musify', TAG);
    try {
        await run();
    } catch (err) {
        ui.fail(`Unexpected error: ${err && err.message ? err.message : err}`);
    }

    async function run() {
        // --- Configuration & Selectors ---
        const TRACK_ITEM_SELECTOR = '.playlist__item';
        // Sidebars hold extra track widgets ("Popular tracks by <artist>").
        const SIDEBAR_SELECTOR = 'aside, .left-sidebar, .right-sidebar';
        // The track id is on the row itself: `data-track-id` (also `id="playerDiv{id}"` and `data-song-id`).
        const TRACK_ID_ATTR = 'data-track-id';
        const STREAM_URL_ENDPOINT = (id) => `/api/track/${id}/stream-url`;

        // Per-track metadata (mostly attributes on the row itself in the new layout)
        const TRACK_ARTIST_ATTR = 'data-artist';
        const TRACK_NAME_ATTR = 'data-name';
        const TRACK_NUMBER_SELECTOR = '.tracklist__position-number, .playlist__position';
        // Duration: on the new layout the duration is inside the row, typically as "MM:SS 320 Кб/с".
        // Fallback selectors cover both old and new markup.
        const DURATION_FALLBACK_SELECTORS = [
            '.tracklist__meta2 span:first-child',
            'div.track__details:not(.track__rating) span.text-muted',
            '.tracklist__time',
            '.playlist__time',
            '.text-muted'
        ];

        // Album metadata
        const ALBUM_HEADER_SELECTOR = 'header.content__title h1, h1';
        const ALBUM_IMAGE_SELECTOR = 'img.album-img, [itemprop="image"]';
        const ALBUM_INFO_LIST_SELECTOR = 'ul.album-info';
        // --- End Selectors ---


        // --- XML Escaping Helper ---
        const escapeXml = (unsafe) => {
            if (unsafe === null || unsafe === undefined) return '';
            return unsafe.toString().replace(/[<>&'"]/g, function (c) {
                switch (c) {
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '&': return '&amp;';
                    case "'": return '&apos;';
                    case '"': return '&quot;';
                }
                return '';
            });
        };
        // --- End XML Escaping Helper ---


        // --- Album Info Extraction and Setup ---
        const albumInfoList = document.querySelector(ALBUM_INFO_LIST_SELECTOR);
        const isAlbumPage = !!albumInfoList;

        let albumArtist = 'Unknown Artist';
        let albumTitle = 'Unknown Album';
        let albumYear = 'UnknownYear';
        let albumImageUrl = null;
        let suggestedFilename = 'playlist.xspf';

        // The byArtist element can carry the name as text, as a content attribute
        // (<meta itemprop="byArtist" content="...">) or in a nested itemprop="name".
        // Returns '' when no name is found, so the fallbacks below can run.
        const readArtistName = (el) => {
            if (!el) return '';
            const nameEl = el.querySelector('[itemprop=name]');
            const linkEl = el.querySelector('a');
            const candidates = [
                el.getAttribute('content'),
                nameEl && (nameEl.getAttribute('content') || nameEl.textContent),
                linkEl && linkEl.textContent,
                el.textContent
            ];
            for (const c of candidates) {
                if (c && c.trim()) return c.trim();
            }
            return '';
        };

        // Extract Artist and Year (if on an album page)
        if (isAlbumPage) {
            const byArtistElement = document.querySelector(`${ALBUM_INFO_LIST_SELECTOR} [itemprop=byArtist]`);
            const byArtistName = readArtistName(byArtistElement);
            if (byArtistName) { albumArtist = byArtistName; }

            const datePublishedElement = document.querySelector(`${ALBUM_INFO_LIST_SELECTOR} [itemprop=datePublished]`);
            if (datePublishedElement && datePublishedElement.hasAttribute('datetime')) {
                const datetimeValue = datePublishedElement.getAttribute('datetime');
                if (datetimeValue && datetimeValue.length >= 4) { albumYear = datetimeValue.slice(0, 4); }
            }
        }

        // Fallback: parse "Artist - Title (YYYY)" from the H1 if the album-info list is missing
        const albumHeaderElement = document.querySelector(ALBUM_HEADER_SELECTOR);
        if (albumHeaderElement) {
            let potentialTitleText = albumHeaderElement.textContent.trim();

            // If we have no artist yet, try to derive it from the H1
            if (albumArtist === 'Unknown Artist') {
                const dashIdx = potentialTitleText.indexOf(' - ');
                if (dashIdx > 0) {
                    albumArtist = potentialTitleText.substring(0, dashIdx).trim();
                }
            }

            // Last resort: the artist of the first track row
            if (albumArtist === 'Unknown Artist') {
                const firstRow = document.querySelector(TRACK_ITEM_SELECTOR);
                const rowArtist = firstRow && firstRow.getAttribute(TRACK_ARTIST_ATTR);
                if (rowArtist && rowArtist.trim()) { albumArtist = rowArtist.trim(); }
            }

            // If we have no year yet, try to derive it from "(YYYY)" in the H1
            if (albumYear === 'UnknownYear') {
                const yearMatch = potentialTitleText.match(/\((\d{4})\)\s*$/);
                if (yearMatch) { albumYear = yearMatch[1]; }
            }

            // Clean up the title by removing the artist prefix and the trailing year
            if (albumArtist !== 'Unknown Artist' && potentialTitleText.startsWith(`${albumArtist} - `)) {
                potentialTitleText = potentialTitleText.substring(`${albumArtist} - `.length).trim();
            }
            if (albumYear !== 'UnknownYear') {
                potentialTitleText = potentialTitleText
                    .replace(new RegExp(`\\(${albumYear}\\)\\s*$`), '')
                    .replace(new RegExp(`\\b${albumYear}\\b\\s*$`), '')
                    .trim();
            }

            albumTitle = potentialTitleText || 'Unknown Album';

            suggestedFilename = `${albumArtist} (${albumYear}) - ${albumTitle} [Musify_club].xspf`.replace(/[\\/:*?"<>|]/g, '_');
            console.log(`Suggested filename: ${suggestedFilename}`);
        } else {
            console.warn(`Album header not found. Cannot suggest filename or populate album tag.`);
        }

        // Extract Image URL
        const albumImageElement = document.querySelector(ALBUM_IMAGE_SELECTOR);
        if (albumImageElement && albumImageElement.src) {
            albumImageUrl = albumImageElement.src;
            console.log(`[Album Image] Found album image URL.`);
        }
        // --- End Album Info Extraction ---


        // --- Helper: fetch the real MP3 URL (and cover) for a given track id ---
        // Returns { url, cover } or null; cover is '' when the API has none.
        const fetchStreamUrl = async (trackId) => {
            try {
                const response = await fetch(STREAM_URL_ENDPOINT(trackId), {
                    method: 'GET',
                    credentials: 'same-origin',
                    headers: { 'Accept': 'application/json' }
                });
                if (!response.ok) {
                    console.warn(`[track ${trackId}] stream-url returned HTTP ${response.status}`);
                    return null;
                }
                const data = await response.json();
                if (!data || !data.url) return null;
                let cover = '';
                try {
                    if (typeof data.cover === 'string' && data.cover) {
                        const coverUrl = new URL(data.cover, location.href);
                        if (/^https?:$/.test(coverUrl.protocol)) cover = coverUrl.href;
                    }
                } catch (e) { /* no usable cover */ }
                return { url: data.url, cover };
            } catch (err) {
                console.warn(`[track ${trackId}] stream-url fetch error:`, err);
                return null;
            }
        };
        // --- End Helper ---


        // --- Core Playlist Item Processing ---
        // The sidebar ("Popular tracks by <artist>") uses the same row markup as the
        // album track list: keep only rows outside it, and never the same track twice.
        const pageRows = Array.from(document.querySelectorAll(TRACK_ITEM_SELECTOR));
        const mainRows = pageRows.filter((row) => !row.closest(SIDEBAR_SELECTOR));
        const seenIds = new Set();
        const allPlaylistItems = (mainRows.length > 0 ? mainRows : pageRows).filter((row) => {
            const id = row.getAttribute(TRACK_ID_ATTR) || row.getAttribute('data-song-id');
            if (!id) return true;
            if (seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
        });
        if (allPlaylistItems.length < pageRows.length) {
            console.log(`Ignored ${pageRows.length - allPlaylistItems.length} rows outside the track list (sidebar or duplicates).`);
        }
        if (allPlaylistItems.length === 0) {
            ui.fail('No tracks found on this page. Open a Musify album or playlist page.');
            return;
        }
        ui.status(`Reading the stream links of ${allPlaylistItems.length} tracks...`);

        // Build per-track promises: each resolves with either a track XML string or null
        const trackPromises = Array.from(allPlaylistItems).map(async (playlistItem, index) => {

            const trackId = playlistItem.getAttribute(TRACK_ID_ATTR)
                || playlistItem.getAttribute('data-song-id');

            if (!trackId) {
                ui.warn(`[Item Index ${index + 1}] Skip: no data-track-id on the row.`);
                return null;
            }

            // Fetch the real signed MP3 URL via the new API endpoint.
            // IMPORTANT: keep the full URL including the ?expires=...&sig=... query
            // string. Those parameters authenticate the request on the Musify CDN;
            // without them the server returns HTTP 404 and the file will not play.
            const stream = await fetchStreamUrl(trackId);
            const url = stream && stream.url;
            // Cover shown while the track plays: the track's own, else the album's.
            const trackCover = (stream && stream.cover) || (isAlbumPage && albumImageUrl) || '';
            if (!url) {
                ui.warn(`[Item Index ${index + 1}] Skip: could not resolve stream URL for track ${trackId}.`);
                return null;
            }

            // --- Track metadata ---
            let trackArtist = playlistItem.getAttribute(TRACK_ARTIST_ATTR) || 'Unknown Artist';
            let trackTitle = playlistItem.getAttribute(TRACK_NAME_ATTR) || 'Unknown Track';

            // Fallback to old selectors if data-* attrs are absent
            if (trackArtist === 'Unknown Artist') {
                const artistLink = playlistItem.querySelector('a[href*="/artist/"]');
                if (artistLink) { trackArtist = artistLink.textContent.trim() || 'Unknown Artist'; }
            }
            if (trackTitle === 'Unknown Track') {
                const titleLink = playlistItem.querySelector('a.strong, a[href*="/track/"]');
                if (titleLink) { trackTitle = titleLink.textContent.trim() || 'Unknown Track'; }
            }

            // Track number
            let trackNumber = null;
            const trackNumElement = playlistItem.querySelector(TRACK_NUMBER_SELECTOR);
            if (trackNumElement) {
                const numText = trackNumElement.textContent.trim();
                if (numText !== '') { trackNumber = numText; }
            }
            if (!trackNumber) { trackNumber = String(index + 1); }

            // Duration: scan candidate elements for a "MM:SS" pattern
            let durationInSeconds = -1;
            for (const sel of DURATION_FALLBACK_SELECTORS) {
                const candidates = playlistItem.querySelectorAll(sel);
                for (const el of candidates) {
                    const m = el.textContent.match(/(\d{1,2}):(\d{2})/);
                    if (m) {
                        const minutes = parseInt(m[1], 10);
                        const seconds = parseInt(m[2], 10);
                        if (!isNaN(minutes) && !isNaN(seconds)) {
                            durationInSeconds = (minutes * 60) + seconds;
                            break;
                        }
                    }
                }
                if (durationInSeconds !== -1) break;
            }

            // Construct XSPF <track> Entry (keep the full signed URL)
            let trackXml = '    <track>\n';
            trackXml +=     `      <location>${escapeXml(url)}</location>\n`;
            if (durationInSeconds !== -1) { trackXml += `      <duration>${durationInSeconds * 1000}</duration>\n`; }
            if (trackArtist !== 'Unknown Artist') { trackXml += `      <creator>${escapeXml(trackArtist)}</creator>\n`; }
            if (trackTitle !== 'Unknown Track') { trackXml += `      <title>${escapeXml(trackTitle)}</title>\n`; }
            if (albumTitle !== 'Unknown Album') { trackXml += `      <album>${escapeXml(albumTitle)}</album>\n`; }
            if (trackNumber !== null) { trackXml += `      <trackNum>${escapeXml(trackNumber)}</trackNum>\n`; }
            if (trackCover) { trackXml += `      <image>${escapeXml(trackCover)}</image>\n`; }
            trackXml += '    </track>';

            return trackXml;
        });

        // Resolve all in parallel (same-origin, fast), counting them as they arrive.
        let finished = 0;
        const resolved = await Promise.all(trackPromises.map((promise, i) => promise.then((xml) => {
            finished++;
            ui.progress(finished, trackPromises.length, allPlaylistItems[i].getAttribute(TRACK_NAME_ATTR) || '');
            return xml;
        })));
        const xspfTrackEntries = resolved.filter(x => x !== null);

        if (xspfTrackEntries.length > 0) {
            console.log(`✅ Formatting complete. Found ${xspfTrackEntries.length} valid tracks.`);

            // --- Construct the full XSPF content ---
            let xspfContent = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1.0" xmlns="http://xspf.org/ns/0/">\n';

            const pageUrl = location.href;
            if (pageUrl) { xspfContent += `  <location>${escapeXml(pageUrl)}</location>\n`; }
            if (isAlbumPage && albumImageUrl) { xspfContent += `  <image>${escapeXml(albumImageUrl)}</image>\n`; }

            xspfContent += '  <trackList>\n';
            xspfContent += xspfTrackEntries.join('\n');
            xspfContent += '\n  </trackList>\n</playlist>';

            // --- Initiate Download ---
            const blob = new Blob([xspfContent], { type: 'application/xspf+xml' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = suggestedFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);

            const skipped = allPlaylistItems.length - xspfTrackEntries.length;
            ui.done(`${xspfTrackEntries.length} tracks exported${skipped ? ` (${skipped} skipped)` : ''}.`, suggestedFilename);
        } else {
            ui.fail('No stream links could be read for this page.');
        }
    }
})();
