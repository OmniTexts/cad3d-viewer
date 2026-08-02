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
- CAD3D semantic-model 1.1 and legacy factory-demo scheme compatibility;
- B/C/D or modeler region selection plus semantic layer controls;
- original/planning materials and enhanced presentation materials;
- CC0 HDR image-based lighting and procedural wall, roof, concrete, asphalt, and grass textures;
- daylight, studio, and dusk presentation environments;
- soft shadows, GTAO ambient occlusion, ACES tone mapping, and SMAA;
- dynamically sized ground, grid, fog, camera range, and shadow frustum;
- automatic framing, top view, fullscreen, auto-rotation, and PNG capture;
- semantic building selection with height, eave, roof, floor, bay-spacing, provenance, confidence, and assumption metadata;
- protocol status, capabilities, site-object counts, and review-state display from glTF extras;
- responsive desktop and mobile presentation views.

The viewer does not parse DWG or DXF. Conversion and diagnosis happen before upload through `cad3d-build-model`, `cad3d-cli`, and `cad3d-modeler`. GLB files remain local to the browser.

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
