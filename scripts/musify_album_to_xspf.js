/**
 * XSPF Playlist Generator for Musify.club - v1.1.1
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
 *    so the resulting XSPF is time-limited (typically valid for several days).
 *
 * Changelog:
 *   1.1.1 (2026-06-14) - Strip query parameters (expires, sig) from stream URLs
 *                        in the XSPF <location> field.
 *   1.1.0 (2026-05-08) - Adapted to the new musify.club layout: now reads
 *                        data-track-id from each .playlist__item row and
 *                        fetches signed MP3 URLs from /api/track/{id}/stream-url.
 *   1.0.0              - Initial release.
 */
(async function() {

    // --- Configuration & Selectors ---
    const TRACK_ITEM_SELECTOR = '.playlist__item';
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

    // Extract Artist and Year (if on an album page)
    if (isAlbumPage) {
        const byArtistElement = document.querySelector(`${ALBUM_INFO_LIST_SELECTOR} [itemprop=byArtist]`);
        if (byArtistElement) { albumArtist = byArtistElement.textContent.trim(); }

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


    // --- Helper: fetch the real MP3 URL for a given track id ---
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
            return data && data.url ? data.url : null;
        } catch (err) {
            console.warn(`[track ${trackId}] stream-url fetch error:`, err);
            return null;
        }
    };
    // --- End Helper ---


    // --- Core Playlist Item Processing ---
    const allPlaylistItems = document.querySelectorAll(TRACK_ITEM_SELECTOR);
    console.log(`--- Starting XSPF Playlist Extraction for ${allPlaylistItems.length} items ---`);

    if (allPlaylistItems.length === 0) {
        console.warn(`❌ No ${TRACK_ITEM_SELECTOR} elements found on the page. Check the selector.`);
        return;
    }

    // Build per-track promises: each resolves with either a track XML string or null
    const trackPromises = Array.from(allPlaylistItems).map(async (playlistItem, index) => {

        const trackId = playlistItem.getAttribute(TRACK_ID_ATTR)
            || playlistItem.getAttribute('data-song-id');

        if (!trackId) {
            console.warn(`[Item Index ${index + 1}] Skip: no data-track-id on the row.`);
            return null;
        }

        // Fetch the real signed MP3 URL via the new API endpoint
        const url = await fetchStreamUrl(trackId);
        if (!url) {
            console.warn(`[Item Index ${index + 1}] Skip: could not resolve stream URL for track ${trackId}.`);
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

        // Construct XSPF <track> Entry
        let trackXml = '    <track>\n';
        trackXml +=     `      <location>${escapeXml(url.split('?')[0])}</location>\n`;
        if (durationInSeconds !== -1) { trackXml += `      <duration>${durationInSeconds * 1000}</duration>\n`; }
        if (trackArtist !== 'Unknown Artist') { trackXml += `      <creator>${escapeXml(trackArtist)}</creator>\n`; }
        if (trackTitle !== 'Unknown Track') { trackXml += `      <title>${escapeXml(trackTitle)}</title>\n`; }
        if (albumTitle !== 'Unknown Album') { trackXml += `      <album>${escapeXml(albumTitle)}</album>\n`; }
        if (trackNumber !== null) { trackXml += `      <trackNum>${escapeXml(trackNumber)}</trackNum>\n`; }
        trackXml += '    </track>';

        return trackXml;
    });

    // Resolve all in parallel (same-origin, fast)
    const resolved = await Promise.all(trackPromises);
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

        console.log(`🎉 XSPF file "${suggestedFilename}" downloaded successfully.`);
    } else {
        console.warn('❌ No valid XSPF tracks created. Check the API endpoint and selectors.');
    }

    console.log('--- End Processing ---');

})();
