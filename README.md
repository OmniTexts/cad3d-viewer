# cad3d-viewer

An independent, static Three.js application that converts and reviews DWG or ASCII DXF files entirely in the browser.

## Pipeline

```text
local File
  -> @omnitexts/cad3d-cli (Web Worker)
  -> normalized drawing + layer linework GLB
  -> @omnitexts/cad3d-modeler (same Web Worker)
  -> semantic model + modeling report + solid GLB
  -> Three.js viewer
```

The uploaded file is not sent to a server or stored by the application.

## Features

- DWG and ASCII DXF upload or drag-and-drop;
- off-main-thread parsing, normalization, semantic analysis, and GLB generation;
- solid and layer-organized linework modes;
- automatic separation of spatially distant plan alternatives into review regions;
- CAD layer visibility controls;
- PBR materials, environment lighting, soft shadows, ambient occlusion, ACES tone mapping, SMAA, sky, and ground;
- selectable semantic objects with source layer, confidence, dimensions, and parameter source;
- modeling issue report and local GLB/report downloads;
- responsive desktop and mobile review workspace.

## Development

```bash
pnpm install
pnpm dev
```

The converter and modeler are installed from npm, so this repository can be cloned, built, and deployed independently.

Open the local URL printed by Vite. The included `public/libredwg/libredwg-web.wasm` asset is required for DWG parsing.

## Verify

```bash
pnpm test
pnpm build
```

## Static deployment

Build output is written to `dist/` and can be deployed to Cloudflare Pages or any static host. No Functions or server runtime is required.

For Cloudflare Pages, use `pnpm build` as the build command, `dist` as the output directory, and Node.js 22 as the build runtime.

## License

GPL-2.0-only. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
