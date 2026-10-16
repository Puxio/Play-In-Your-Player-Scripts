/**
 * Play-In-Your-Player bookmarklet launcher - v1.0.0
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
 * Some sites forbid inline scripts (Content-Security-Policy or Trusted
 * Types). When that happens the launcher copies the script to the clipboard
 * and asks you to paste it into the console (F12) by hand.
 *
 * This file is the readable source. The one-line version to save as a
 * bookmark is bookmarklet/bookmarklet.txt (also shown in the README).
 * After editing this file, regenerate it with:
 *   npx terser bookmarklet/launcher.js -c -m | sed 's/^/javascript:/' > bookmarklet/bookmarklet.txt
 */
(function () {
    var RAW = 'https://raw.githubusercontent.com/Puxio/Play-In-Your-Player-Scripts/main/scripts/';
    var TAG = 'Play-In-Your-Player: ';
    var host = location.hostname.replace(/^www\./, '');

    // Fetch a repository file as text, bypassing the browser cache.
    function get(file) {
        return fetch(RAW + file + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error(file + ' HTTP ' + r.status);
            return r.text();
        });
    }

    // Exact hostname match, or hostname is a subdomain of a manifest key.
    function lookup(manifest) {
        for (var key in manifest) {
            if (host === key || host.slice(-key.length - 1) === '.' + key) return manifest[key];
        }
        return null;
    }

    // Site blocks injected scripts: hand the code to the user instead.
    function fallback(file, code) {
        var msg = TAG + 'this site blocks injected scripts.\n';
        var url = RAW + file;
        if (navigator.clipboard && code) {
            navigator.clipboard.writeText(code).then(function () {
                alert(msg + 'The script (' + file + ') has been copied to the clipboard: open the console (F12), paste it and press Enter.');
            }, function () {
                prompt(msg + 'Open this URL, copy the script and paste it into the console (F12):', url);
            });
        } else {
            prompt(msg + 'Open this URL, copy the script and paste it into the console (F12):', url);
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
            if (!window.__pippRan) fallback(file, code);
        });
    }).catch(function (e) {
        alert(TAG + 'could not load the scripts (' + e.message + ').');
    });
})();
