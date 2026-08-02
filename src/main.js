// SPDX-License-Identifier: GPL-2.0-only

import "./styles.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { isRegionNode, isSemanticObject, preferredRegionId, regionIdentity } from "./region-utils.mjs";
import {
  BadgeCheck,
  Box,
  Camera,
  CircleAlert,
  CloudSun,
  Contrast,
  FileUp,
  FolderOpen,
  Grid3X3,
  Layers3,
  Map as MapIcon,
  Maximize2,
  MousePointer2,
  PanelRight,
  Rotate3D,
  Scan,
  ShieldCheck,
  Sun,
  X,
  createIcons,
} from "lucide";

createIcons({
  icons: {
    BadgeCheck,
    Box,
    Camera,
    CircleAlert,
    CloudSun,
    Contrast,
    FileUp,
    FolderOpen,
    Grid3x3: Grid3X3,
    Layers3,
    Map: MapIcon,
    Maximize2,
    MousePointer2,
    PanelRight,
    Rotate3d: Rotate3D,
    Scan,
    ShieldCheck,
    Sun,
    X,
  },
  attrs: { "aria-hidden": "true" },
});

const elements = Object.fromEntries([
  "file-name", "file-input", "viewer", "scene-canvas", "empty-state", "drop-zone", "drop-overlay",
  "loading-state", "loading-title", "loading-detail", "error-state", "error-message", "scene-badge",
  "scene-title", "scene-meta", "region-select", "view-controls", "environment-select", "toggle-ground",
  "toggle-shadows", "toggle-ao", "toggle-rotate", "fit-view", "top-view", "capture-view", "fullscreen-view",
  "toggle-info", "info-panel", "close-info", "model-format", "stat-objects", "stat-triangles", "stat-materials",
  "stat-regions", "model-units", "model-properties", "selection-confidence", "selection-empty",
  "selection-properties", "privacy-note", "layers-panel", "layer-controls", "mode-planning", "mode-presentation",
  "model-status-label", "contract-section", "contract-version", "contract-properties", "toggle-layers",
].map((id) => [id, document.querySelector(`#${id}`)]));

const isCompact = matchMedia("(max-width: 760px)");
const renderer = new THREE.WebGLRenderer({
  canvas: elements["scene-canvas"],
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, isCompact.matches ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfd9dc);
scene.fog = new THREE.Fog(0xcfd9dc, 500, 5_000);

const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100_000);
camera.position.set(120, 90, 140);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ambientOcclusion = new GTAOPass(scene, camera, 1, 1);
ambientOcclusion.blendIntensity = 0.62;
ambientOcclusion.updateGtaoMaterial({
  radius: 0.38,
  thickness: 1.2,
  distanceFallOff: 1,
  samples: isCompact.matches ? 8 : 16,
  screenSpaceRadius: true,
});
ambientOcclusion.enabled = !isCompact.matches;
composer.addPass(ambientOcclusion);
composer.addPass(new SMAAPass());
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, elements["scene-canvas"]);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI / 2.02;
controls.autoRotateSpeed = 0.55;

const pmrem = new THREE.PMREMGenerator(renderer);
const fallbackEnvironment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
let environmentMap = fallbackEnvironment;
scene.environment = environmentMap;
pmrem.dispose();

const hemisphere = new THREE.HemisphereLight(0xf7f5ee, 0x57645f, 2.2);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xfff0d1, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(isCompact.matches ? 2048 : 4096, isCompact.matches ? 2048 : 4096);
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);

const sky = new Sky();
sky.scale.setScalar(100_000);
scene.add(sky);

const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x909992,
  roughness: 0.96,
  metalness: 0,
  depthWrite: true,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.renderOrder = -2;
scene.add(ground);

let grid = createGrid(1_000, 40);
scene.add(grid);

const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

let modelRoot = null;
let activeRoot = null;
let currentFile = null;
let currentStats = null;
let regions = [];
let selectedHelper = null;
let pointerDown = null;
let loadSequence = 0;
let dragDepth = 0;
let lastViewerAspect = 0;
let activeRenderMode = "presentation";
let activeEnvironment = "daylight";
let modelContract = null;
let layerRecords = [];
const originalMaterials = new Map();
const presentationMaterials = new Map();
const surfaceTextures = createSurfaceTextures();

loadEnvironmentLighting().then((texture) => {
  if (!texture) return;
  if (environmentMap !== fallbackEnvironment) environmentMap.dispose();
  environmentMap = texture;
  if (activeRenderMode === "presentation") scene.environment = environmentMap;
});

elements["file-input"].addEventListener("click", () => { elements["file-input"].value = ""; });
elements["file-input"].addEventListener("change", () => {
  const file = elements["file-input"].files?.[0];
  if (file) loadGlb(file);
});

elements.viewer.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  elements["drop-overlay"].classList.remove("is-hidden");
});
elements.viewer.addEventListener("dragover", (event) => event.preventDefault());
elements.viewer.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) elements["drop-overlay"].classList.add("is-hidden");
});
elements.viewer.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  elements["drop-overlay"].classList.add("is-hidden");
  const file = event.dataTransfer?.files?.[0];
  if (file) loadGlb(file);
});

elements["region-select"].addEventListener("change", () => setRegion(elements["region-select"].value));
elements["environment-select"].addEventListener("change", () => applyEnvironment(elements["environment-select"].value));
elements["mode-planning"].addEventListener("click", () => setRenderMode("planning"));
elements["mode-presentation"].addEventListener("click", () => setRenderMode("presentation"));
elements["toggle-ground"].addEventListener("click", () => toggleSetting("ground"));
elements["toggle-shadows"].addEventListener("click", () => toggleSetting("shadows"));
elements["toggle-ao"].addEventListener("click", () => toggleSetting("ao"));
elements["toggle-rotate"].addEventListener("click", () => toggleSetting("rotate"));
elements["fit-view"].addEventListener("click", fitView);
elements["top-view"].addEventListener("click", setTopView);
elements["capture-view"].addEventListener("click", captureView);
elements["fullscreen-view"].addEventListener("click", toggleFullscreen);
elements["toggle-layers"].addEventListener("click", () => setLayersOpen(elements["layers-panel"].classList.contains("is-hidden")));
elements["toggle-info"].addEventListener("click", () => setInfoOpen(!elements["info-panel"].classList.contains("is-open")));
elements["close-info"].addEventListener("click", () => setInfoOpen(false));

elements["scene-canvas"].addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
elements["scene-canvas"].addEventListener("pointerup", (event) => {
  if (!modelRoot || !pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(activeRoot ?? modelRoot, true)[0];
  selectObject(hit?.object ?? null);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setInfoOpen(false);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
    event.preventDefault();
    elements["file-input"].click();
  }
});
window.addEventListener("resize", resize);
isCompact.addEventListener("change", (event) => {
  if (event.matches) setLayersOpen(false);
  resize();
});

setToggleState(elements["toggle-ao"], ambientOcclusion.enabled);
applyEnvironment("daylight");
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  selectedHelper?.update();
  composer.render();
});

async function loadGlb(file) {
  if (file.name.split(".").pop()?.toLowerCase() !== "glb") {
    showError("当前展示版本只读取 cad3d-build-model 生成的 .glb 文件。");
    return;
  }
  if (file.size > 500 * 1024 * 1024) {
    showError("模型超过 500 MB，当前浏览器可能无法稳定载入。");
    return;
  }

  const sequence = loadSequence += 1;
  showLoading(file);
  await nextFrame();

  try {
    const buffer = await file.arrayBuffer();
    if (sequence !== loadSequence) return;
    validateGlb(buffer);
    elements["loading-detail"].textContent = "解析网格与 PBR 材质";
    await nextFrame();
    const gltf = await loader.parseAsync(buffer, "");
    if (sequence !== loadSequence) return;
    displayModel(gltf, file);
  } catch (error) {
    console.error(error);
    showError(normalizeLoadError(error));
  }
}

function displayModel(gltf, file) {
  clearSelection();
  disposeModel(modelRoot);
  modelRoot = gltf.scene ?? gltf.scenes?.[0];
  if (!modelRoot) throw new Error("GLB 中没有可显示的场景。");
  currentFile = file;
  scene.add(modelRoot);
  modelContract = readModelContract(modelRoot);
  prepareModel(modelRoot);
  currentStats = inspectModel(modelRoot, file, gltf.parser?.json?.asset);
  regions = collectRegions(modelRoot);
  layerRecords = collectLayers(modelRoot, modelContract?.presentation?.layers);
  populateRegions(regions);
  populateModelInfo(currentStats);
  populateContract(modelContract);
  populateLayers(layerRecords);
  setRegion(preferredRegion(regions, modelContract)?.id ?? "all", false);
  setRenderMode(modelContract?.presentation?.defaultMode === "planning" ? "planning" : "presentation");

  elements["file-name"].textContent = file.name;
  elements["empty-state"].classList.add("is-hidden");
  elements["loading-state"].classList.add("is-hidden");
  elements["error-state"].classList.add("is-hidden");
  elements["scene-badge"].classList.remove("is-hidden");
  elements["view-controls"].classList.remove("is-hidden");
  setLayersOpen(Boolean(layerRecords.length) && !isCompact.matches);
  elements["privacy-note"].classList.add("is-loaded");
  for (const id of ["fit-view", "top-view", "capture-view", "toggle-info"]) elements[id].disabled = false;
  elements["toggle-layers"].disabled = !layerRecords.length;
  setInfoOpen(false);
  fitView();
}

function prepareModel(root) {
  originalMaterials.clear();
  presentationMaterials.clear();
  const preparedMaterials = new Set();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  root.traverse((object) => {
    if (!object.isMesh) return;
    originalMaterials.set(object, object.material);
    presentationMaterials.set(object, createPresentationMaterial(object));
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const isGlassSurface = object.userData?.surface === "glass";
    object.castShadow = !isGlassSurface;
    object.receiveShadow = true;
    for (const material of materials.filter(Boolean)) {
      if (preparedMaterials.has(material.uuid)) continue;
      preparedMaterials.add(material.uuid);
      material.envMapIntensity = 0.82;
      if (isGlassSurface || /glass|玻璃/i.test(material.name)) material.side = THREE.DoubleSide;
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) {
        if (material[key]) material[key].anisotropy = maxAnisotropy;
      }
      material.needsUpdate = true;
    }
  });
}

function inspectModel(root, file, asset = {}) {
  let meshCount = 0;
  let triangles = 0;
  const materials = new Set();
  const semanticObjects = new Set();
  root.traverse((object) => {
    if (isSemanticObject(object)) semanticObjects.add(object.userData.semanticId ?? object.userData.sourceHandle ?? object.uuid);
    if (!object.isMesh) return;
    meshCount += 1;
    const positionCount = object.geometry?.attributes?.position?.count ?? 0;
    triangles += object.geometry?.index ? object.geometry.index.count / 3 : positionCount / 3;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter(Boolean).forEach((material) => materials.add(material.name || material.uuid));
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return {
    asset,
    box,
    size,
    meshCount,
    objectCount: semanticObjects.size || meshCount,
    triangles: Math.round(triangles),
    materialCount: materials.size,
    byteLength: file.size,
  };
}

function collectRegions(root) {
  const records = [];
  root.traverse((object) => {
    if (!isRegionNode(object)) return;
    const semanticObjects = new Set();
    let meshCount = 0;
    object.traverse((child) => {
      if (isSemanticObject(child)) semanticObjects.add(child.userData.semanticId ?? child.userData.sourceHandle ?? child.uuid);
      if (child.isMesh) meshCount += 1;
    });
    const identity = regionIdentity(object);
    records.push({
      id: identity.id,
      label: identity.label ?? `区域 ${records.length + 1}`,
      objectCount: semanticObjects.size || meshCount,
      initiallyVisible: object.visible,
      legacyScheme: Boolean(object.userData?.scheme && /^scheme-/i.test(object.name)),
      root: object,
    });
  });
  return records;
}

function preferredRegion(records, contract) {
  const requested = contract?.presentation?.defaultRegionId ?? contract?.presentation?.defaultSchemeId;
  if (!contract && records.every((record) => record.legacyScheme)) {
    const legacyDefault = records.find((record) => record.id === "D") ?? records.at(-1);
    if (legacyDefault) return legacyDefault;
  }
  const id = preferredRegionId(records, requested);
  return records.find((record) => record.id === id) ?? null;
}

function populateRegions(records) {
  const options = [];
  if (records.length > 1) options.push(createOption("all", `全部区域 · ${records.length}`));
  options.push(...records.map((region) => createOption(region.id, `${region.label} · ${region.objectCount} 个构件`)));
  elements["region-select"].replaceChildren(...options);
  elements["region-select"].classList.toggle("is-hidden", records.length <= 1);
}

function setRegion(regionId, refit = true) {
  if (!modelRoot) return;
  if (regions.length) {
    for (const region of regions) region.root.visible = regionId === "all" || region.id === regionId;
  }
  const selectedRegion = regions.find((region) => region.id === regionId);
  activeRoot = selectedRegion?.root ?? modelRoot;
  if (elements["region-select"].options.length) elements["region-select"].value = regionId;
  elements["scene-title"].textContent = selectedRegion?.label ?? "完整模型";
  const visibleObjects = selectedRegion?.objectCount ?? currentStats?.objectCount ?? 0;
  elements["scene-meta"].textContent = `${formatNumber(visibleObjects)} 个构件 · ${formatBytes(currentFile?.size ?? 0)}`;
  clearSelection();
  if (refit) fitView();
}

function populateModelInfo(stats) {
  elements["model-format"].textContent = `glTF ${stats.asset?.version ?? "2.0"}`;
  elements["stat-objects"].textContent = formatNumber(stats.objectCount);
  elements["stat-triangles"].textContent = compactNumber(stats.triangles);
  elements["stat-materials"].textContent = formatNumber(stats.materialCount);
  elements["stat-regions"].textContent = formatNumber(regions.length || 1);
  const properties = [
    ["尺寸 X", formatDistance(stats.size.x)],
    ["尺寸 Y", formatDistance(stats.size.y)],
    ["尺寸 Z", formatDistance(stats.size.z)],
    ["文件大小", formatBytes(stats.byteLength)],
    ["网格对象", formatNumber(stats.meshCount)],
  ];
  elements["model-properties"].replaceChildren(...createProperties(properties));
  const status = modelContract?.status;
  elements["model-status-label"].textContent = status === "needs-review"
    ? "模型需要复核"
    : status === "ready-with-assumptions" ? "模型含推断参数" : "GLB 已载入";
}

function readModelContract(root) {
  const data = root.userData ?? {};
  if (data.schema !== "cad3d.semantic-model") return null;
  return {
    schema: data.schema,
    schemaVersion: data.schemaVersion ?? "1.0.0",
    status: data.status ?? "ready",
    units: data.units ?? "m",
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    presentation: data.presentation ?? {},
    statistics: data.statistics ?? {},
  };
}

function populateContract(contract) {
  elements["contract-section"].classList.toggle("is-hidden", !contract);
  if (!contract) {
    elements["contract-properties"].replaceChildren();
    return;
  }
  elements["contract-version"].textContent = `v${contract.schemaVersion}`;
  const statusLabels = {
    ready: "可评审",
    "ready-with-assumptions": "含假设",
    "needs-review": "需复核",
  };
  elements["contract-properties"].replaceChildren(...createProperties([
    ["状态", statusLabels[contract.status] ?? contract.status],
    ["单位", contract.units],
    ["语义对象", formatNumber(contract.statistics.modeledObjectCount ?? currentStats?.objectCount ?? 0)],
    ["场地对象", formatNumber(contract.statistics.siteObjectCount ?? 0)],
    ["能力", contract.capabilities.length ? contract.capabilities.join(" · ") : "基础语义"],
  ]));
}

function collectLayers(root, hints = []) {
  const definitions = new Map((hints ?? []).map((hint) => [hint.id, { ...hint }]));
  root.traverse((object) => {
    const role = object.userData?.layerRole
      ?? (["buildings", "site", "landscape", "traffic", "redline"].includes(object.userData?.category)
        ? object.userData.category
        : null);
    if (!role) return;
    if (!definitions.has(role)) definitions.set(role, { id: role, label: layerLabel(role), defaultVisible: true });
  });
  const order = ["buildings", "site", "landscape", "traffic", "redline"];
  return [...definitions.values()]
    .filter((record) => hasLayer(root, record.id))
    .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
}

function hasLayer(root, role) {
  let found = false;
  root.traverse((object) => {
    if (object.userData?.layerRole === role || object.userData?.category === role) found = true;
  });
  return found;
}

function populateLayers(records) {
  const colors = {
    buildings: "#83949b",
    site: "#b9bcb7",
    landscape: "#628053",
    traffic: "#3f4645",
    redline: "#c85848",
  };
  const controls = records.map((record) => {
    const label = document.createElement("label");
    label.className = "layer-control";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = record.defaultVisible !== false;
    input.addEventListener("change", () => setLayerVisibility(record.id, input.checked));
    const swatch = document.createElement("span");
    swatch.className = "layer-swatch";
    swatch.style.setProperty("--layer-color", colors[record.id] ?? "#738079");
    const text = document.createElement("span");
    text.textContent = record.label ?? layerLabel(record.id);
    label.append(input, swatch, text);
    return label;
  });
  elements["layer-controls"].replaceChildren(...controls);
}

function setLayersOpen(open) {
  const next = open && layerRecords.length > 0;
  if (next && isCompact.matches) setInfoOpen(false);
  elements["layers-panel"].classList.toggle("is-hidden", !next);
  elements["toggle-layers"].setAttribute("aria-expanded", String(next));
}

function setLayerVisibility(role, visible) {
  if (!modelRoot) return;
  modelRoot.traverse((object) => {
    const directLayer = object.userData?.category === "layer" && object.userData?.layerRole === role;
    const legacyLayer = object.userData?.category === role && object.isGroup;
    if (directLayer || legacyLayer) object.visible = visible;
  });
  clearSelection();
}

function layerLabel(role) {
  return ({
    buildings: "建筑体块",
    site: "场地基底",
    landscape: "景观绿化",
    traffic: "交通与物流",
    redline: "用地红线",
  })[role] ?? role;
}

function selectObject(object) {
  const target = findSelectable(object);
  clearSelection();
  if (!target) return;
  selectedHelper = new THREE.BoxHelper(target, 0xe69a52);
  selectedHelper.material.depthTest = false;
  selectedHelper.renderOrder = 20;
  scene.add(selectedHelper);

  const data = target.userData ?? {};
  const properties = [
    ["名称", data.displayName ?? target.name ?? "未命名构件"],
    ["类型", kindLabel(data.kind ?? data.type ?? data.category ?? "mesh")],
    ["面积", data.areaM2 || data.area ? `${formatNumber(data.areaM2 ?? data.area)} m²` : "--"],
    ["高度", data.height ? `${formatNumber(data.height)} m` : "--"],
    ["檐口高度", data.eaveHeight ? `${formatNumber(data.eaveHeight)} m` : "--"],
    ["屋顶", roofLabel(data.roofType)],
    ["层数", data.floors ?? "--"],
    ["柱距", data.baySpacing ? `${formatNumber(data.baySpacing)} m` : "--"],
    ["源图层", data.sourceLayer ?? "--"],
    ["识别依据", data.parameterSource ?? data.modelRule ?? "--"],
    ["假设", Array.isArray(data.assumptions) && data.assumptions.length ? data.assumptions.join(" ") : "无"],
  ];
  elements["selection-confidence"].textContent = confidenceLabel(data.confidence);
  elements["selection-empty"].hidden = true;
  elements["selection-properties"].hidden = false;
  elements["selection-properties"].replaceChildren(...createProperties(properties));
  setInfoOpen(true);
}

function findSelectable(object) {
  let current = object;
  let fallback = null;
  while (current && current !== modelRoot) {
    if (isSemanticObject(current)) return current;
    if (!fallback && (current.userData?.semanticId || current.isMesh)) fallback = current;
    current = current.parent;
  }
  return fallback;
}

function clearSelection() {
  if (selectedHelper) {
    scene.remove(selectedHelper);
    selectedHelper.geometry.dispose();
    selectedHelper.material.dispose();
    selectedHelper = null;
  }
  elements["selection-confidence"].textContent = "未选择";
  elements["selection-empty"].hidden = false;
  elements["selection-properties"].hidden = true;
  elements["selection-properties"].replaceChildren();
}

function fitView() {
  if (!activeRoot) return;
  const box = new THREE.Box3().setFromObject(activeRoot);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y * 2, size.z, 1);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const direction = cameraDirection(size);
  const distance = camera.aspect >= 0.8
    ? Math.max(
      size.y / (2 * Math.tan(verticalFov / 2)),
      size.x / (2 * Math.tan(verticalFov / 2) * camera.aspect),
      radius * 0.85,
    ) * 1.16
    : portraitFitDistance(size, direction, verticalFov);

  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.up.set(0, 1, 0);
  camera.near = Math.max(radius / 50_000, 0.01);
  camera.far = Math.max(radius * 80, 2_000);
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(radius * 0.015, 0.05);
  controls.maxDistance = radius * 12;
  controls.update();
  updateStage(box, center, size, radius);
}

function cameraDirection(size) {
  if (camera.aspect >= 0.8) return new THREE.Vector3(1, 0.72, 1.12).normalize();
  return size.x >= size.z
    ? new THREE.Vector3(1.2, 0.78, 0.24).normalize()
    : new THREE.Vector3(0.24, 0.78, 1.2).normalize();
}

function portraitFitDistance(size, direction, verticalFov) {
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const forward = direction.clone().negate();
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  const viewUp = right.clone().cross(forward).normalize();
  const halfSize = size.clone().multiplyScalar(0.5);
  const fitDistance = Math.max(
    projectedExtent(halfSize, right) / Math.tan(horizontalFov / 2),
    projectedExtent(halfSize, viewUp) / Math.tan(verticalFov / 2),
  );
  return fitDistance * 0.8 + projectedExtent(halfSize, forward) * 0.45;
}

function projectedExtent(halfSize, axis) {
  return Math.abs(axis.x) * halfSize.x
    + Math.abs(axis.y) * halfSize.y
    + Math.abs(axis.z) * halfSize.z;
}

function setTopView() {
  if (!activeRoot) return;
  const box = new THREE.Box3().setFromObject(activeRoot);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z, 1);
  controls.target.copy(center);
  camera.position.set(center.x, center.y + radius * 1.35, center.z + 0.001);
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.update();
}

function updateStage(box, center, size, radius) {
  const groundSize = Math.max(size.x, size.z, 10) * (activeRenderMode === "presentation" ? 2.05 : 2.8);
  const groundY = box.min.y - Math.max(radius * 0.0008, 0.015);
  ground.geometry.dispose();
  ground.geometry = new THREE.PlaneGeometry(groundSize, groundSize);
  ground.position.set(center.x, groundY, center.z);

  scene.remove(grid);
  disposeGrid(grid);
  grid = createGrid(groundSize, 40);
  grid.position.set(center.x, groundY + Math.max(radius * 0.001, 0.02), center.z);
  scene.add(grid);

  const shadowExtent = Math.max(size.x, size.z, 10) * 0.72;
  sun.position.copy(center).add(new THREE.Vector3(-radius * 1.3, radius * 2.2, radius * 1.15));
  sun.target.position.copy(center);
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.near = Math.max(radius * 0.05, 0.1);
  sun.shadow.camera.far = radius * 6;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -Math.max(radius * 0.0000008, 0.00002);
  sun.shadow.normalBias = Math.max(radius * 0.00004, 0.01);
  scene.fog.near = radius * 2.2;
  scene.fog.far = radius * 8.5;
}

function setRenderMode(mode) {
  if (!modelRoot) return;
  activeRenderMode = mode;
  const presentation = mode === "presentation";
  for (const [object, source] of originalMaterials) {
    object.material = presentation ? presentationMaterials.get(object) : source;
  }
  modelRoot.traverse((object) => {
    if (object.userData?.presentationOnly) object.visible = presentation;
  });
  elements["mode-planning"].classList.toggle("is-active", !presentation);
  elements["mode-planning"].setAttribute("aria-pressed", String(!presentation));
  elements["mode-presentation"].classList.toggle("is-active", presentation);
  elements["mode-presentation"].setAttribute("aria-pressed", String(presentation));
  scene.environment = presentation ? environmentMap : null;
  grid.visible = !presentation && ground.visible;
  applyEnvironment(activeEnvironment);
  fitView();
}

function applyEnvironment(name) {
  activeEnvironment = name;
  const presets = {
    daylight: {
      background: 0xc2d0d0, fog: 0xc2d0d0, ground: 0xa6aca9,
      sky: true, exposure: 1.0, hemisphere: [0xf6f3eb, 0x7f8984, 1.05], sun: [0xfff7e8, 2.75, 55, 138],
    },
    studio: {
      background: 0xc9cac6, fog: 0xc9cac6, ground: 0xa8aaa4,
      sky: false, exposure: 0.98, hemisphere: [0xffffff, 0x626965, 1.35], sun: [0xfff2de, 2.45, 58, 142],
    },
    dusk: {
      background: 0x7f8c96, fog: 0x7f8c96, ground: 0x777d7b,
      sky: true, exposure: 0.88, hemisphere: [0xb8c8dc, 0x4d4b48, 1.2], sun: [0xffb36b, 3.15, 78, 118],
    },
  };
  const preset = presets[name] ?? presets.daylight;
  scene.background.setHex(preset.background);
  scene.fog.color.setHex(preset.fog);
  groundMaterial.color.setHex(preset.ground);
  renderer.toneMappingExposure = preset.exposure * (activeRenderMode === "presentation" ? 1 : 1.04);
  hemisphere.color.setHex(preset.hemisphere[0]);
  hemisphere.groundColor.setHex(preset.hemisphere[1]);
  hemisphere.intensity = preset.hemisphere[2] * (activeRenderMode === "presentation" ? 1 : 1.55);
  sun.color.setHex(preset.sun[0]);
  sun.intensity = preset.sun[1] * (activeRenderMode === "presentation" ? 1 : 1.18);
  sky.visible = preset.sky && activeRenderMode === "presentation";
  sky.material.uniforms.turbidity.value = name === "dusk" ? 8 : 4;
  sky.material.uniforms.rayleigh.value = name === "dusk" ? 2.6 : 1.7;
  sky.material.uniforms.mieCoefficient.value = 0.0045;
  sky.material.uniforms.mieDirectionalG.value = 0.82;
  sky.material.uniforms.sunPosition.value.setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(preset.sun[2]),
    THREE.MathUtils.degToRad(preset.sun[3]),
  );
}

async function loadEnvironmentLighting() {
  try {
    const source = await new HDRLoader().loadAsync("/assets/environment/abandoned_parking_1k.hdr");
    source.mapping = THREE.EquirectangularReflectionMapping;
    const generator = new THREE.PMREMGenerator(renderer);
    generator.compileEquirectangularShader();
    const texture = generator.fromEquirectangular(source).texture;
    source.dispose();
    generator.dispose();
    return texture;
  } catch (error) {
    console.warn("HDR 环境光载入失败，使用内置摄影棚环境。", error);
    return null;
  }
}

function createPresentationMaterial(object) {
  const sources = Array.isArray(object.material) ? object.material : [object.material];
  const results = sources.map((source) => enhanceMaterial(source, object.userData?.surface));
  return Array.isArray(object.material) ? results : results[0];
}

function enhanceMaterial(source, surface) {
  if (!source?.clone) return source;
  const inferredSurface = surface || inferSurface(source.name);
  if (inferredSurface === "glass") {
    return new THREE.MeshPhysicalMaterial({
      name: source.name,
      color: source.color?.clone() ?? new THREE.Color(0xb9d3d7),
      roughness: 0.16,
      metalness: 0.06,
      transmission: 0.28,
      transparent: true,
      opacity: 0.82,
      thickness: 0.12,
      envMapIntensity: 1.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  const material = source.clone();
  const settings = {
    wall: { map: surfaceTextures.wall, roughness: 0.66, metalness: 0.06, envMapIntensity: 0.7 },
    roof: { map: surfaceTextures.roof, bumpMap: surfaceTextures.roof, bumpScale: 0.055, roughness: 0.48, metalness: 0.34, envMapIntensity: 1.05 },
    "roof-detail": { roughness: 0.38, metalness: 0.58, envMapIntensity: 1.12 },
    steel: { roughness: 0.32, metalness: 0.74, envMapIntensity: 1.2 },
    door: { roughness: 0.4, metalness: 0.42, envMapIntensity: 0.95 },
    concrete: { map: surfaceTextures.concrete, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.5 },
    asphalt: { map: surfaceTextures.asphalt, roughness: 0.96, metalness: 0, envMapIntensity: 0.38 },
    grass: { map: surfaceTextures.grass, roughness: 0.94, metalness: 0, envMapIntensity: 0.45 },
    foliage: { roughness: 0.8, metalness: 0, envMapIntensity: 0.55 },
    bark: { roughness: 0.96, metalness: 0, envMapIntensity: 0.3 },
    "vehicle-paint": { roughness: 0.27, metalness: 0.58, envMapIntensity: 1.35 },
    rubber: { roughness: 0.92, metalness: 0.02, envMapIntensity: 0.3 },
  }[inferredSurface];
  material.envMapIntensity = 0.78;
  if (settings) Object.assign(material, settings);
  material.needsUpdate = true;
  return material;
}

function inferSurface(name = "") {
  if (/glass|玻璃/i.test(name)) return "glass";
  if (/roof|屋面|steel|metal|钢/i.test(name)) return "roof";
  if (/grass|绿化/i.test(name)) return "grass";
  if (/asphalt|road|道路/i.test(name)) return "asphalt";
  if (/concrete|场地/i.test(name)) return "concrete";
  return null;
}

function createSurfaceTextures() {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return {
    asphalt: makeNoiseTexture([110, 116, 113], 8, 20, 20, 8, anisotropy),
    concrete: makeNoiseTexture([196, 196, 188], 9, 24, 24, 9, anisotropy),
    grass: makeNoiseTexture([82, 116, 66], 18, 22, 22, 10, anisotropy),
    wall: makeStripeTexture([208, 211, 207], [169, 176, 174], 10, 4, anisotropy),
    roof: makeStripeTexture([132, 145, 151], [92, 105, 111], 12, 3, anisotropy),
  };
}

function makeNoiseTexture(base, variance, repeatX, repeatY, seed, anisotropy) {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  let value = seed;
  for (let index = 0; index < size * size; index += 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    const noise = ((value / 4294967295) - 0.5) * variance;
    for (let channel = 0; channel < 3; channel += 1) data[index * 4 + channel] = THREE.MathUtils.clamp(base[channel] + noise, 0, 255);
    data[index * 4 + 3] = 255;
  }
  return configureTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), repeatX, repeatY, anisotropy);
}

function makeStripeTexture(base, stripe, repeatX, repeatY, anisotropy) {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = x % 16 < 2 || y % 48 < 1 ? stripe : base;
      data.set([...color, 255], (y * size + x) * 4);
    }
  }
  return configureTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), repeatX, repeatY, anisotropy);
}

function configureTexture(texture, repeatX, repeatY, anisotropy) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function toggleSetting(name) {
  if (name === "ground") {
    const next = !ground.visible;
    ground.visible = next;
    grid.visible = next && activeRenderMode === "planning";
    setToggleState(elements["toggle-ground"], next);
  }
  if (name === "shadows") {
    const next = !renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = next;
    sun.castShadow = next;
    modelRoot?.traverse((object) => {
      if (object.isMesh) object.castShadow = next && object.userData?.surface !== "glass";
    });
    setToggleState(elements["toggle-shadows"], next);
  }
  if (name === "ao") {
    ambientOcclusion.enabled = !ambientOcclusion.enabled;
    setToggleState(elements["toggle-ao"], ambientOcclusion.enabled);
  }
  if (name === "rotate") {
    controls.autoRotate = !controls.autoRotate;
    setToggleState(elements["toggle-rotate"], controls.autoRotate);
  }
}

function setToggleState(button, active) {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-pressed", String(active));
}

function setInfoOpen(open) {
  if (open && isCompact.matches) setLayersOpen(false);
  elements["info-panel"].classList.toggle("is-open", open);
  elements["region-select"].classList.toggle("is-panel-obscured", open && isCompact.matches);
  elements["toggle-info"].setAttribute("aria-expanded", String(open));
}

function captureView() {
  if (!modelRoot) return;
  composer.render();
  renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const name = `${currentFile?.name.replace(/\.glb$/i, "") || "cad3d-model"}-view.png`;
    downloadBlob(blob, name);
  }, "image/png");
}

async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await elements.viewer.requestFullscreen();
}

function showLoading(file) {
  clearSelection();
  elements["file-name"].textContent = file.name;
  elements["empty-state"].classList.add("is-hidden");
  elements["error-state"].classList.add("is-hidden");
  elements["loading-state"].classList.remove("is-hidden");
  elements["loading-title"].textContent = "正在载入模型";
  elements["loading-detail"].textContent = `读取 ${formatBytes(file.size)} GLB`;
}

function showError(message) {
  elements["empty-state"].classList.add("is-hidden");
  elements["loading-state"].classList.add("is-hidden");
  elements["error-state"].classList.remove("is-hidden");
  elements["layers-panel"].classList.add("is-hidden");
  elements["error-message"].textContent = message;
}

function validateGlb(buffer) {
  if (buffer.byteLength < 20 || new DataView(buffer).getUint32(0, true) !== 0x46546c67) {
    throw new Error("文件不是有效的二进制 glTF（GLB）。");
  }
}

function normalizeLoadError(error) {
  const message = error?.message ?? String(error);
  if (/DRACO/i.test(message)) return "模型使用了当前版本尚未启用的 Draco 压缩。";
  return message;
}

function disposeModel(root) {
  if (!root) return;
  scene.remove(root);
  const materials = new Set();
  for (const materialValue of [...originalMaterials.values(), ...presentationMaterials.values()]) {
    const list = Array.isArray(materialValue) ? materialValue : [materialValue];
    list.filter(Boolean).forEach((material) => materials.add(material));
  }
  root.traverse((object) => {
    object.geometry?.dispose?.();
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter(Boolean).forEach((material) => materials.add(material));
  });
  materials.forEach((material) => material.dispose());
  originalMaterials.clear();
  presentationMaterials.clear();
}

function createGrid(size, divisions) {
  const helper = new THREE.GridHelper(size, divisions, 0x8d9692, 0xaeb5b1);
  const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
  materials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.26;
    material.depthWrite = false;
  });
  helper.renderOrder = -1;
  return helper;
}

function disposeGrid(helper) {
  helper.geometry?.dispose();
  const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
  materials.forEach((material) => material?.dispose());
}

function createOption(value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

function createProperties(properties) {
  return properties.flatMap(([key, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  });
}

function updatePointer(event) {
  const bounds = elements["scene-canvas"].getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
}

function resize() {
  const width = elements.viewer.clientWidth;
  const height = elements.viewer.clientHeight;
  if (!width || !height) return;
  const nextAspect = width / height;
  const needsRefit = Boolean(lastViewerAspect && Math.abs(Math.log(nextAspect / lastViewerAspect)) > 0.3);
  renderer.setPixelRatio(Math.min(devicePixelRatio, isCompact.matches ? 1.5 : 2));
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  camera.aspect = nextAspect;
  camera.updateProjectionMatrix();
  lastViewerAspect = nextAspect;
  if (modelRoot && needsRefit) requestAnimationFrame(() => fitView());
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function formatDistance(value) {
  if (!Number.isFinite(value)) return "--";
  return value >= 1_000 ? `${formatNumber(value / 1_000)} km` : `${formatNumber(value)} m`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function compactNumber(value) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatNumber(value) {
  return numberFormatter.format(value ?? 0);
}

function kindLabel(kind) {
  return {
    factory: "厂房",
    warehouse: "仓库",
    shed: "工棚",
    canopy: "雨棚",
    office: "办公楼",
    service: "配套建筑",
    building: "建筑",
    site: "场地",
    road: "道路",
    greenery: "绿化",
    redline: "用地红线",
    mesh: "网格",
  }[kind] ?? kind;
}

function roofLabel(type) {
  return { gable: "双坡屋顶", flat: "平屋顶" }[type] ?? "--";
}

function confidenceLabel(confidence) {
  return { high: "高置信", medium: "需复核", low: "低置信" }[confidence] ?? "模型构件";
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
