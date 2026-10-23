/**
 * Play-In-Your-Player bookmarklet launcher
 *
 * One bookmark for every supported site. When clicked, it:
 *   1. reads the current hostname (www. is ignored, subdomains match their
 *      parent: downloads.khinsider.com matches "khinsider.com");
 *   2. downloads scripts/manifest.json from this repository and looks up the
 *      script registered for that hostname;
 *   3. downloads that script and runs it in the page, exactly as if it had
 *      been pasted into the DevTools console;
 *   4. reads the VERSION line of this file on GitHub and, if a newer
 *      launcher exists, shows a small notice linking to the install page.
 *
 * VERSION below is the single source of truth: the install page, the
 * bookmark name ("Play In My Player vX.Y.Z") and the update check all read
 * it. Bump it whenever this file changes.
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
 * This file is the readable source. The install page and
 * bookmarklet/bookmarklet.txt are generated from it by tools/build.mjs
 * (run "node tools/build.mjs" after editing; the GitHub Action does the
 * same on every push to publish the page).
 *
 * Changelog:
 *   1.2.0 (2026-10-23) - VERSION constant and update notice. Installed from
 *                        the GitHub Pages install page by drag and drop.
 *   1.1.4 (2026-10-22) - FALLBACK map: squid.wtf runs khinsider_squid_to_xspf.js.
 *   1.1.3 (2026-10-22) - FALLBACK map: squid.wtf runs squidify_abum_to_xspf.js.
 *   1.1.2 (2026-10-16) - FALLBACK map: removed the Invidious instances.
 *   1.1.1 (2026-10-16) - FALLBACK map: youtube.com runs the YouTube script
 *                        directly (the Invidious redirect is no longer used).
 *   1.1.0 (2026-10-16) - Fallbacks for sites that block downloads from
 *                        GitHub (jsDelivr <script src>, then a new tab).
 *   1.0.0 (2026-10-16) - Initial release.
 */
(function () {
    var VERSION = '1.2.0';
    var REPO = 'Puxio/Play-In-Your-Player-Scripts';
    var BASE = 'https://raw.githubusercontent.com/' + REPO + '/main/';
    var CDN = 'https://cdn.jsdelivr.net/gh/' + REPO + '@main/scripts/';
    var PAGE = 'https://puxio.github.io/Play-In-Your-Player-Scripts/';
    var FALLBACK = {
        'musify.club': 'musify_album_to_xspf.js',
        'khinsider.com': 'khinsider_album_to_xspf.js',
        'squid.wtf': 'khinsider_squid_to_xspf.js',
        'squidify.org': 'squidify_abum_to_xspf.js',
        'youtube.com': 'youtube_album_to_playlist.js'
    };
    var TAG = 'Play-In-Your-Player: ';
    var PASTE = 'open the console (F12), paste it and press Enter.';
    var host = location.hostname.replace(/^www\./, '');

    // Fetch a repository file as text, bypassing the browser cache.
    function get(path) {
        return fetch(BASE + path + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
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

    // True when version string a is greater than b ("1.10.0" > "1.9.2").
    function newer(a, b) {
        a = a.split('.');
        b = b.split('.');
        for (var i = 0; i < 3; i++) {
            var d = (+a[i] || 0) - (+b[i] || 0);
            if (d) return d > 0;
        }
        return false;
    }

    // Small dismissable banner in the corner of the page.
    function notice(latest) {
        var box = document.createElement('div');
        box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;' +
            'padding:12px 14px;border-radius:8px;background:#1d1d1f;color:#fff;font:14px/1.4 system-ui,sans-serif;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.3)';
        box.textContent = 'Play In My Player v' + latest + ' is available (you have v' + VERSION + '). ';
        var link = document.createElement('a');
        link.href = PAGE;
        link.target = '_blank';
        link.textContent = 'Update the bookmark';
        link.style.cssText = 'color:#8ab4ff;text-decoration:underline';
        box.appendChild(link);
        box.onclick = function (e) { if (e.target !== link) box.remove(); };
        (document.body || document.documentElement).appendChild(box);
        setTimeout(function () { box.remove(); }, 15000);
    }

    // Compare this launcher with the one on GitHub. Never blocks or fails.
    function checkUpdate() {
        get('bookmarklet/launcher.js').then(function (text) {
            var m = text.match(/VERSION = '([\d.]+)'/);
            if (m && newer(m[1], VERSION)) notice(m[1]);
        }).catch(function () {});
    }

    // Last resort: show the script in a new tab for a manual copy and paste.
    function openTab(file) {
        var url = BASE + 'scripts/' + file;
        if (window.open(url, '_blank')) {
            alert(TAG + 'this site blocks loading scripts.\nThe script (' + file + ') has been opened in a new tab: select all (Ctrl+A), copy it (Ctrl+C), come back to this page, ' + PASTE);
        } else {
            prompt(TAG + 'this site blocks loading scripts.\nOpen this URL, copy the script, come back to this page and ' + PASTE, url);
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

    get('scripts/manifest.json').then(function (text) {
        checkUpdate();
        var file = lookup(JSON.parse(text));
        if (!file) {
            alert(TAG + 'no script registered for ' + host + '.');
            return;
        }
        return get('scripts/' + file).then(function (code) {
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
