/**
 * Squidify.org XSPF Auto-Collector
 * * @version  1.0.0
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
    console.log(`%c 🤖 SQUIDIFY AUTO-COLLECTOR v1.0.0 `, "background: #00796B; color: white; font-weight: bold; padding: 4px; border-radius: 4px;");

    // --- UI Status Overlay ---
    const statusOverlay = document.createElement('div');
    Object.assign(statusOverlay.style, {
        position: 'fixed', top: '20px', right: '20px', zIndex: '9999999',
        padding: '15px', backgroundColor: 'rgba(15, 15, 15, 0.95)', color: '#00E676',
        borderRadius: '8px', fontFamily: 'monospace', border: '1px solid #00E676', 
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)', minWidth: '180px'
    });
    statusOverlay.innerHTML = `
        <div style="font-weight:bold; border-bottom:1px solid #333; margin-bottom:5px; padding-bottom:5px;">SQUIDIFY SCRAPER v1.0.0</div>
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
     * Promise-based wait for audio metadata with safety checks
     */
    const waitForMetadata = () => {
        return new Promise((resolve) => {
            const audio = document.querySelector('audio');
            
            if (!audio) {
                console.warn("Audio element missing, retrying in 1s...");
                setTimeout(resolve, 1000);
                return;
            }

            const onLoaded = () => {
                audio.removeEventListener('loadedmetadata', onLoaded);
                // Stabilization delay to avoid AbortError on next click
                setTimeout(resolve, 1000);
            };

            audio.addEventListener('loadedmetadata', onLoaded);
            
            // Timeout: move to next track if metadata doesn't load in 12s
            setTimeout(() => {
                audio.removeEventListener('loadedmetadata', onLoaded);
                resolve();
            }, 12000);
        });
    };

    /**
     * Main Scraper Engine
     */
    const run = async () => {
        const table = document.querySelectorAll('[role=table]')[0];
        const rows = Array.from(table?.querySelectorAll('[role=row]') || []);
        
        if (rows.length === 0) {
            updateUI("ERROR", 0, "No table rows found.");
            return;
        }

        for (let i = 1; i < rows.length; i++) {
            const btn = rows[i].querySelector('button');
            if (btn) {
                updateUI("PROCESSING", window.capturedTracks.length, `Row ${i} / ${rows.length - 1}`);
                rows[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
                
                btn.click();
                await waitForMetadata();

                const audio = document.querySelector('audio');
                const img = document.getElementById('track-song-image');
                const src = audio?.currentSrc || audio?.src;

                if (src && src.includes('stream')) {
                    const info = img?.alt.split(' - ') || ["Unknown", "Unknown"];
                    
                    // Duplicate prevention
                    if (!window.capturedTracks.find(t => t.location === src)) {
                        window.capturedTracks.push({
                            location: src,
                            title: (info[1] || info[0]).trim(),
                            creator: (info[0] || "Unknown Artist").trim(),
                            duration: audio && !isNaN(audio.duration) ? Math.round(audio.duration * 1000) : 0
                        });
                        console.log(`%c 📥 Captured [v1.0.0]: ${info[1] || info[0]}`, "color: #00E676;");
                    }
                }
            }
        }
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