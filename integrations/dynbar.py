"""Küçük Python istemcisi (yalnızca standart kütüphane).

    import dynbar
    dynbar.notify("Eğitim bitti", title="Model", icon="🧠", mood="happy")
    dynbar.progress("epoch", 0.5, text="Epoch 5/10")
"""
import json
import os
import urllib.request

# Ortam değişkeni yoksa ~/.dynbar-ecosystem/dynamic-bar.json dosyasından port ve anahtar okunur
try:
    with open(os.path.join(os.path.expanduser("~"), ".dynbar-ecosystem", "dynamic-bar.json"), encoding="utf-8") as _f:
        _link = json.load(_f)
except Exception:
    _link = {}
BASE = os.environ.get("DYNBAR_URL") or ("http://127.0.0.1:%s" % _link["port"] if _link.get("port") else "http://127.0.0.1:47800")
TOKEN = os.environ.get("DYNBAR_TOKEN") or _link.get("token", "")


def _call(route, body=None, method="POST"):
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    data = json.dumps(body or {}).encode() if method == "POST" else None
    req = urllib.request.Request(BASE + route, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.read().decode()
    except Exception:
        return None


def notify(text="", title="Bildirim", **kw):
    return _call("/notify", {"text": text, "title": title, **kw})


def progress(key, value, **kw):
    return _call("/notify", {"key": key, "progress": value, **kw})


def remind(seconds=0, minutes=0, text="", **kw):
    return _call("/remind", {"seconds": seconds, "minutes": minutes, "text": text, **kw})


def dnd(on=None):
    return _call("/dnd", {} if on is None else {"on": bool(on)})


def todo(add=None, toggle=None, clear=False):
    body = {}
    if add:
        body["add"] = add
    if toggle is not None:
        body["toggle"] = toggle
    if clear:
        body["clear"] = True
    return _call("/todo", body)


def status():
    return _call("/status", method="GET")
