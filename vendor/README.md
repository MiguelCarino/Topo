# Vendored third-party code

These files are **not** part of Carino Topo and are **not** covered by
this repository's AGPL-3.0 licence. Each keeps its own MIT licence, reproduced
in full alongside it, as MIT requires.

They are committed here rather than loaded from a CDN so the editor matches the
rest of the fleet: every Carino site works standalone and offline, with no
external runtime dependency and nothing that reports a visitor's presence to a
third party.

| File | Version | Upstream | Licence |
|---|---|---|---|
| `ipaddr-2.1.0.min.js` | 2.1.0 | [`ipaddr.js`](https://github.com/whitequark/ipaddr.js) | MIT — [`LICENSE.ipaddr.js`](LICENSE.ipaddr.js), © 2011-2017 whitequark |
| `qrcode-generator-1.4.4.min.js` | 1.4.4 | [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator) | MIT — [`LICENSE.qrcode-generator`](LICENSE.qrcode-generator), © 2009 Kazuhiko Arase |

Each is the minified distribution build, byte-for-byte as published:

```
ipaddr             https://cdnjs.cloudflare.com/ajax/libs/ipaddr.js/2.1.0/ipaddr.min.js
qrcode-generator   https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js
                   sha256 164fc2c1c9eaf0a03aa8dfdb855e82e41a5c6922fbad8bb3238116207e26bef7
```

The QR encoder draws the codes on Print labels (js/assets.js) in the page; it
makes no request of its own. The minified build carries no copyright header,
so its notice is the upstream repository's LICENSE, kept beside it. "QR Code"
is a registered trademark of DENSO WAVE INCORPORATED.

MIT is permissive, so bundling these into an AGPL work is fine — the combined
work ships under AGPL while these files stay MIT. The obligation is only to
keep the copyright and permission notices, which is what this folder does.

## Updating

Re-download to the **same version-pinned filename**, or add the new version and
update the `<script>` tag in `index.html`. Do not point the tags back at a CDN.

The Tailwind browser runtime that used to sit here is gone: the page is styled
by the fleet's shared `carino-ui.css` and Topo's own `css/app.css`.
