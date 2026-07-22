# Vendored third-party code

These files are **not** part of Carino NetworkTopology and are **not** covered by
this repository's AGPL-3.0 licence. Each keeps its own MIT licence, reproduced in
full alongside it, as MIT requires.

They are committed here rather than loaded from a CDN so the editor matches the
rest of the fleet: every Carino site works standalone and offline, with no
external runtime dependency and nothing that reports a visitor's presence to a
third party.

| File | Version | Upstream | Licence |
|---|---|---|---|
| `tailwind-browser-4.3.3.js` | 4.3.3 | [`@tailwindcss/browser`](https://www.npmjs.com/package/@tailwindcss/browser) | MIT — [`LICENSE.tailwindcss`](LICENSE.tailwindcss), © Tailwind Labs, Inc. |
| `ipaddr-2.1.0.min.js` | 2.1.0 | [`ipaddr.js`](https://github.com/whitequark/ipaddr.js) | MIT — [`LICENSE.ipaddr.js`](LICENSE.ipaddr.js), © 2011-2017 whitequark |

Both are the minified distribution builds, byte-for-byte as published:

```
tailwind  https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4     (resolved to 4.3.3)
ipaddr    https://cdnjs.cloudflare.com/ajax/libs/ipaddr.js/2.1.0/ipaddr.min.js
```

MIT is permissive, so bundling it into an AGPL work is fine — the combined work
ships under AGPL while these files stay MIT. The obligation is only to keep the
copyright and permission notices, which is what this folder does.

## Updating

Re-download to the **same version-pinned filename**, or add the new version and
update the `<script>` tags in `index.html`. Do not point the tags back at a CDN.

`tailwind-browser` is the in-browser JIT compiler: it reads the utility classes
out of the DOM at runtime and generates CSS. That is why it is 276 KB — most of
that is the compiler, not the styles. Swapping it for a pre-built stylesheet
would be far smaller, but needs a build step and would break any class name
generated dynamically at runtime, so the runtime build is kept deliberately.
