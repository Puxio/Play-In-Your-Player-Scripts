/**
 * Play-In-Your-Player bookmarklet launcher - v1.1.1
 *
 * One bookmark for every supported site. When clicked, it:
 *   1. reads the current hostname (www. is ignored, subdomains match their
 *      parent: downloads.khinsider.com matches "khinsider.com");
 *   2. downloads scripts/manifest.json from this repository and looks up the
 *      script registered for that hostname;
 *   3. downloads that script and runs it in the page, exactly as if it had
 *      been pasted into the DevTools console.
 *
 * Files are read from raw.githubusercontent.com, whose cache lasts about
 * 5 minutes, so a commit pushed to main reaches the bookmarklet almost
 * immediately. raw.githubusercontent.com serves files as text/plain with
 * "nosniff", so a <script src="..."> pointing there would be refused by the
 * browser: the code is fetched as text and injected as an inline script.
 *
 * Fallbacks, for sites that restrict what a page may load:
 *   - the page may download from GitHub but not run inline scripts
 *     (Content-Security-Policy, Trusted Types): the script is copied to the
 *     clipboard and you paste it into the console (F12);
 *   - the page may not download from GitHub at all ("Failed to fetch"):
 *     the script is loaded as <script src> from jsDelivr, which serves it as
 *     JavaScript (jsDelivr caches the main branch up to 12 hours, so this
 *     path can run a slightly older version); if that is blocked too, the
 *     script opens in a new tab for you to copy and paste into the console.
 *   The second case cannot read manifest.json, so it uses the FALLBACK map
 *   below. Keep it in sync with scripts/manifest.json; a site missing from
 *   it only loses this fallback, not the normal path.
 *
 * This file is the readable source. The one-line version to save as a
 * bookmark is bookmarklet/bookmarklet.txt (also shown in the README).
 * After editing this file, regenerate it with:
 *   npx terser bookmarklet/launcher.js -c -m | sed 's/^/javascript:/' > bookmarklet/bookmarklet.txt
 *
 * Changelog:
 *   1.1.1 (2026-10-16) - FALLBACK map: youtube.com runs the YouTube script
 *                        directly (the Invidious redirect is no longer used).
 *   1.1.0 (2026-10-16) - Fallbacks for sites that block downloads from
 *                        GitHub (jsDelivr <script src>, then a new tab).
 *   1.0.0 (2026-10-16) - Initial release.
 */
(function () {
    var REPO = 'Puxio/Play-In-Your-Player-Scripts';
    var RAW = 'https://raw.githubusercontent.com/' + REPO + '/main/scripts/';
    var CDN = 'https://cdn.jsdelivr.net/gh/' + REPO + '@main/scripts/';
    var FALLBACK = {
        'musify.club': 'musify_album_to_xspf.js',
        'khinsider.com': 'khinsider_album_to_xspf.js',
        'squidify.org': 'squidify_abum_to_xspf.js',
        'youtube.com': 'youtube_album_to_playlist.js',
        'yewtu.be': 'youtube_album_to_playlist.js',
        'inv.nadeko.net': 'youtube_album_to_playlist.js'
    };
    var TAG = 'Play-In-Your-Player: ';
    var PASTE = 'open the console (F12), paste it and press Enter.';
    var host = location.hostname.replace(/^www\./, '');

    // Fetch a repository file as text, bypassing the browser cache.
    function get(file) {
        return fetch(RAW + file + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error(file + ' HTTP ' + r.status);
            return r.text();
        });
    }

    // Exact hostname match, or hostname is a subdomain of a map key.
    function lookup(map) {
        for (var key in map) {
            if (host === key || host.slice(-key.length - 1) === '.' + key) return map[key];
        }
        return null;
    }

    // Last resort: show the script in a new tab for a manual copy and paste.
    function openTab(file) {
        if (window.open(RAW + file, '_blank')) {
            alert(TAG + 'this site blocks loading scripts.\nThe script (' + file + ') has been opened in a new tab: select all (Ctrl+A), copy it (Ctrl+C), come back to this page, ' + PASTE);
        } else {
            prompt(TAG + 'this site blocks loading scripts.\nOpen this URL, copy the script, come back to this page and ' + PASTE, RAW + file);
        }
    }

    // The page cannot fetch from GitHub: try jsDelivr as a script tag.
    function viaCdn() {
        var file = lookup(FALLBACK);
        if (!file) {
            alert(TAG + 'this site blocks downloads from GitHub and ' + host + ' is not in the fallback list.');
            return;
        }
        try {
            var s = document.createElement('script');
            s.onerror = function () { s.remove(); openTab(file); };
            s.onload = function () { s.remove(); };
            s.src = CDN + file;
            (document.head || document.documentElement).appendChild(s);
        } catch (e) {
            // Trusted Types sites throw on the src assignment.
            openTab(file);
        }
    }

    // The page fetched the code but may not run it: hand it to the user.
    function viaClipboard(file, code) {
        var msg = TAG + 'this site blocks injected scripts.\n';
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(function () {
                alert(msg + 'The script (' + file + ') has been copied to the clipboard: ' + PASTE);
            }, function () { openTab(file); });
        } else {
            openTab(file);
        }
    }

    get('manifest.json').then(function (text) {
        var file = lookup(JSON.parse(text));
        if (!file) {
            alert(TAG + 'no script registered for ' + host + '.');
            return;
        }
        return get(file).then(function (code) {
            window.__pippRan = false;
            try {
                var s = document.createElement('script');
                // The first statement flags that the inline script really ran.
                s.textContent = 'window.__pippRan=true;\n' + code;
                (document.head || document.documentElement).appendChild(s);
                s.remove();
            } catch (e) {
                // Trusted Types sites throw on the textContent assignment.
            }
            if (!window.__pippRan) viaClipboard(file, code);
        });
    }).catch(function (e) {
        // fetch() rejects with a TypeError when the request itself is blocked
        // (Content-Security-Policy connect-src, service worker, extension).
        if (e instanceof TypeError) {
            viaCdn();
        } else {
            alert(TAG + 'could not load the scripts (' + e.message + ').');
        }
    });
})();
