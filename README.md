# cad3d-viewer

A focused, static Three.js viewer for reviewing solid GLB models produced by the CAD3D toolchain.

## Pipeline

```text
DWG or DXF
  -> cad3d-build-model Skill
  -> @omnitexts/cad3d-cli
  -> @omnitexts/cad3d-modeler
  -> model.glb
  -> cad3d-viewer
```

The viewer reads the selected GLB directly in the browser. The model is not uploaded to or stored by the application.

## Features

- local GLB selection and drag-and-drop;
- PBR material rendering with image-based environment lighting;
- daylight, studio, and dusk presentation environments;
- soft shadows, GTAO ambient occlusion, ACES tone mapping, and SMAA;
- dynamically sized ground, grid, fog, camera range, and shadow frustum;
- automatic framing, top view, fullscreen, auto-rotation, and PNG capture;
- CAD3D spatial-region selection from glTF extras;
- semantic building selection and model statistics from embedded metadata;
- responsive desktop and mobile presentation views.

## Development

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite and select a `.glb` file.

## Verify

```bash
pnpm test
pnpm build
```

## Cloudflare Pages

The production project is available at <https://cad-3d-viewer.pages.dev/>.

```bash
pnpm build
pnpm deploy:pages
```

The application is fully static and requires no Pages Functions or server-side storage.

## License

GPL-2.0-only. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
