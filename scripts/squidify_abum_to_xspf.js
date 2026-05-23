/**
 * Squidify.org XSPF Auto-Collector
 * * @version  1.3.0
 * @description Automatically iterates through [role=table] rows, waits for audio
 * metadata, and exports an XSPF playlist with accurate durations.
 */

(function() {
    'use strict';

    // --- State Storage ---
    window.capturedTracks = [];

    const h1Element = document.querySelector('h1');
    const playlistTitle = h1Element ? h1Element.innerText.trim() : "Squidify Playlist";

    console.clear();
    console.log(`%c 🤖 SQUIDIFY AUTO-COLLECTOR v1.3.0 `, "background: #00796B; color: white; font-weight: bold; padding: 4px; border-radius: 4px;");

    // --- UI Status Overlay ---
    const statusOverlay = document.createElement('div');
    Object.assign(statusOverlay.style, {
        position: 'fixed', top: '20px', right: '20px', zIndex: '9999999',
        padding: '15px', backgroundColor: 'rgba(15, 15, 15, 0.95)', color: '#00E676',
        borderRadius: '8px', fontFamily: 'monospace', border: '1px solid #00E676',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)', minWidth: '180px'
    });
    statusOverlay.innerHTML = `
        <div style="font-weight:bold; border-bottom:1px solid #333; margin-bottom:5px; padding-bottom:5px;">SQUIDIFY SCRAPER v1.3.0</div>
        <div id="sq-status">READY</div>
        <div id="sq-count" style="font-size: 24px; margin: 8px 0;">0</div>
        <div id="sq-progress" style="font-size: 10px; opacity: 0.7;">Waiting for trigger...</div>
    `;
    document.body.appendChild(statusOverlay);

    const updateUI = (status, count, progress) => {
        document.getElementById('sq-status').innerText = status;
        document.getElementById('sq-count').innerText = count;
        document.getElementById('sq-progress').innerText = progress;
    };

    /**
     * Promise-based wait for audio metadata with safety checks.
     * Handles loadedmetadata, error, and fallback timeout.
     */
    const waitForMetadata = () => {
        return new Promise((resolve) => {
            const audio = document.querySelector('audio');

            if (!audio) {
                console.warn("Audio element missing, retrying in 1s...");
                setTimeout(resolve, 1000);
                return;
            }

            let settled = false;

            const cleanup = () => {
                if (settled) return;
                settled = true;
                audio.removeEventListener('loadedmetadata', onLoaded);
                audio.removeEventListener('error', onError);
                clearTimeout(fallbackTimer);
            };

            const onLoaded = () => {
                cleanup();
                // Stabilization delay to avoid AbortError on next click
                setTimeout(resolve, 1000);
            };

            // Resolve quickly on audio error so we don't wait the full 12s
            const onError = () => {
                console.warn("Audio load error on this track, skipping...");
                cleanup();
                setTimeout(resolve, 500);
            };

            audio.addEventListener('loadedmetadata', onLoaded);
            audio.addEventListener('error', onError);

            // Absolute fallback: move to next track if nothing fires within 12s
            const fallbackTimer = setTimeout(() => {
                cleanup();
                resolve();
            }, 12000);
        });
    };

    /**
     * Returns the first track row whose play button has not yet been clicked.
     * Skips row[0] (header) and any button already marked data-sq-done.
     *
     * Squidify uses virtual scroll: only ~17 rows are in the DOM at a time and
     * their DOM indices shift as the user scrolls. Index-based iteration breaks
     * because i=25 may exceed the current DOM length of 17. Instead we mark each
     * button immediately before clicking (data-sq-done) and always pick the first
     * unmarked one. React may unmount and remount rows as they leave/enter the
     * viewport, losing the marker — the URL duplicate check in capturedTracks
     * handles those re-clicks without adding duplicates.
     */
    const getNextRow = () => {
        const table = document.querySelectorAll('[role=table]')[0];
        if (!table) return null;
        const rows = table.querySelectorAll('[role=row]');
        for (let j = 1; j < rows.length; j++) {
            const btn = rows[j].querySelector('button');
            if (btn && !btn.dataset.sqDone) return rows[j];
        }
        return null;
    };

    /**
     * Main Scraper Engine
     */
    const run = async () => {
        if (!getNextRow()) {
            updateUI("ERROR", 0, "No table rows found.");
            return;
        }

        // emptyScrolls counts consecutive iterations where no unprocessed row
        // was visible. After 5 such scrolls (10 s) with no new rows appearing,
        // we consider the list exhausted.
        let emptyScrolls = 0;

        while (emptyScrolls < 5) {
            const row = getNextRow();

            if (!row) {
                emptyScrolls++;
                updateUI("SCANNING", window.capturedTracks.length, `Checking for more... (${emptyScrolls}/5)`);
                console.log(`[Squidify] No unprocessed rows visible — scroll attempt ${emptyScrolls}/5`);
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            // New row found — reset the empty-scroll counter
            emptyScrolls = 0;

            const btn = row.querySelector('button');
            // Mark before clicking so re-entrant calls don't pick this row again
            btn.dataset.sqDone = 'true';

            updateUI("PROCESSING", window.capturedTracks.length, `Captured: ${window.capturedTracks.length}`);
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });

            // Let scroll settle and React re-render before clicking
            await new Promise(r => setTimeout(r, 400));

            btn.click();
            await waitForMetadata();

            const audio = document.querySelector('audio');
            const img = document.getElementById('track-song-image');
            const src = audio?.currentSrc || audio?.src;

            if (src && src.includes('stream')) {
                const info = img?.alt.split(' - ') || ["Unknown", "Unknown"];

                if (!window.capturedTracks.find(t => t.location === src)) {
                    window.capturedTracks.push({
                        location: src,
                        title: (info[1] || info[0]).trim(),
                        creator: (info[0] || "Unknown Artist").trim(),
                        duration: audio && !isNaN(audio.duration) ? Math.round(audio.duration * 1000) : 0
                    });
                    console.log(`%c 📥 Captured [v1.3.0]: ${info[1] || info[0]}`, "color: #00E676;");
                }
            }
        }

        console.log(`[Squidify] Done. Total captured: ${window.capturedTracks.length}`);
        finish();
    };

    /**
     * Export to XSPF file
     */
    const finish = () => {
        // Skip the first track as per user workflow
        const final = window.capturedTracks.slice(1);

        if (final.length === 0) {
            updateUI("EMPTY", 0, "No tracks to export.");
            return;
        }

        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n<title>${esc(playlistTitle)}</title>\n<trackList>`;
        final.forEach(t => {
            xml += `\n<track><location>${esc(t.location)}</location><title>${esc(t.title)}</title><creator>${esc(t.creator)}</creator><duration>${t.duration}</duration></track>`;
        });
        xml += `\n</trackList>\n</playlist>`;

        const blob = new Blob([xml], { type: 'application/xspf+xml' });
        const a = document.createElement('a');
        const safeName = playlistTitle.replace(/[\\/:*?"<>|]/g, '_');

        a.href = URL.createObjectURL(blob);
        a.download = `${safeName} [Squidify.org].xspf`;
        a.click();

        updateUI("COMPLETED", final.length, "File downloaded.");
        setTimeout(() => statusOverlay.remove(), 5000);
    };

    run();
})();
