"""Browser-Session: alle Anfragen laufen als fetch() INNERHALB der DAGR-Seite.

Damit verhält sich der Worker wie ein normaler Besucher der Webseite
(gleicher Ursprung, Cookies, Browser-Header) – genau der Zugriffsweg,
für den die Freigabe gilt. Es wird nichts verschleiert oder umgangen.
"""
from __future__ import annotations

import time
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright, Error as PWError

FETCH_JS = """
async ([url, timeoutMs]) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {credentials: 'include', cache: 'no-store', signal: ctl.signal});
    return {status: r.status, text: await r.text()};
  } catch (e) {
    return {status: -1, text: String(e)};
  } finally { clearTimeout(t); }
}
"""

DETECT_WMS_JS = """
() => {
  try {
    const out = [];
    const walk = (lg) => lg.getLayers().forEach(l => {
      if (l.getLayers) return walk(l);
      const s = l.getSource && l.getSource();
      if (s && s.getParams && String(s.getParams().LAYERS || '').includes('all_limitation_layer')) {
        out.push(s.getUrls ? s.getUrls()[0] : s.getUrl());
      }
    });
    walk(window.map);
    return out[0] || null;
  } catch (e) { return null; }
}
"""


class BlockedError(RuntimeError):
    """Server verweigert den Zugriff (403/Geo-Block) – nicht weiter anfragen."""


class DagrSession:
    def __init__(self, cfg, log):
        self.cfg = cfg
        self.log = log
        self._pw = self._browser = self._page = None
        self.wms_url = None
        self.requests = 0

    # -------------------------------------------------------------- lifecycle
    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        self.close()

    def open(self):
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=self.cfg.headless)
        self._new_page()

    def _new_page(self):
        if self._page:
            try:
                self._page.close()
            except PWError:
                pass
        ctx = self._browser.new_context(locale="en-GB", timezone_id="Europe/Athens")
        self._page = ctx.new_page()
        resp = self._page.goto(self.cfg.page_url, wait_until="load", timeout=90_000)
        status = resp.status if resp else None
        self.log("session", "page_loaded", url=self.cfg.page_url, http=status)
        if status in (401, 403, 451):
            raise BlockedError(f"Startseite antwortet mit HTTP {status} – Zugriff gesperrt "
                               f"(Standort/IP prüfen, Whitelisting bei HASP anfragen)")
        detected = None
        if not self.cfg.wms_url:
            try:
                self._page.wait_for_function("() => window.map && window.map.getLayers", timeout=20_000)
                detected = self._page.evaluate(DETECT_WMS_JS)
            except PWError:
                detected = None
        self.wms_url = self.cfg.wms_url or detected or self.cfg.wms_url_fallback
        self.log("session", "wms_endpoint", url=self.wms_url,
                 source="config" if self.cfg.wms_url else ("auto" if detected else "fallback"))

    def close(self):
        for obj, meth in ((self._browser, "close"), (self._pw, "stop")):
            try:
                if obj:
                    getattr(obj, meth)()
            except Exception:
                pass

    # -------------------------------------------------------------- requests
    def wms(self, params: dict) -> str:
        sep = "&" if "?" in self.wms_url else "?"
        url = self.wms_url + sep + urlencode(params)
        last = None
        for attempt in range(1, self.cfg.retries + 1):
            try:
                res = self._page.evaluate(FETCH_JS, [url, int(self.cfg.request_timeout_s * 1000)])
            except PWError as e:
                res = {"status": -2, "text": str(e)}
            self.requests += 1
            st = res["status"]
            if st == 200:
                time.sleep(self.cfg.pause_s)
                return res["text"]
            if st in (401, 403, 451):
                raise BlockedError(f"WMS antwortet mit HTTP {st}")
            last = f"HTTP {st}: {res['text'][:160]}"
            wait = min(60, self.cfg.pause_s * 4 * (2 ** attempt))
            self.log("request", "retry", attempt=attempt, wait_s=round(wait, 1), error=last,
                     request=params.get("REQUEST"), layer=params.get("LAYERS"))
            time.sleep(wait)
            if st == -2:  # Seite/Browser hängt -> Seite neu laden
                try:
                    self._new_page()
                except PWError as e:
                    last = f"Neuladen fehlgeschlagen: {e}"
        raise RuntimeError(f"Anfrage nach {self.cfg.retries} Versuchen fehlgeschlagen: {last}")
