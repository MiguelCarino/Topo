# Vendored third-party code

This file is **not** part of Carino Topo and is **not** covered by
this repository's AGPL-3.0 licence. It keeps its own MIT licence, reproduced in
full alongside it, as MIT requires.

They are committed here rather than loaded from a CDN so the editor matches the
rest of the fleet: every Carino site works standalone and offline, with no
external runtime dependency and nothing that reports a visitor's presence to a
third party.

| File | Version | Upstream | Licence |
|---|---|---|---|
| `ipaddr-2.1.0.min.js` | 2.1.0 | [`ipaddr.js`](https://github.com/whitequark/ipaddr.js) | MIT — [`LICENSE.ipaddr.js`](LICENSE.ipaddr.js), © 2011-2017 whitequark |

It is the minified distribution build, byte-for-byte as published:

```
ipaddr    https://cdnjs.cloudflare.com/ajax/libs/ipaddr.js/2.1.0/ipaddr.min.js
```

MIT is permissive, so bundling it into an AGPL work is fine — the combined work
ships under AGPL while this file stays MIT. The obligation is only to keep the
copyright and permission notices, which is what this folder does.

## Updating

Re-download to the **same version-pinned filename**, or add the new version and
update the `<script>` tag in `index.html`. Do not point the tags back at a CDN.

The Tailwind browser runtime that used to sit here is gone: the page is styled
by the fleet's shared `carino-ui.css` and Topo's own `css/app.css`.
