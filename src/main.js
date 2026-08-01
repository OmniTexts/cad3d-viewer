// SPDX-License-Identifier: GPL-2.0-only

import "./styles.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { preferredRegionId, showOnlyRegion } from "./region-utils.mjs";
import {
  CircleAlert,
  createIcons,
  Download,
  FileUp,
  FolderOpen,
  Map as MapIcon,
  MousePointer2,
  Layers3,
  PanelRight,
  Scan,
  Upload,
  X,
} from "lucide";

createIcons({
  icons: { CircleAlert, Download, FileUp, FolderOpen, Layers3, Map: MapIcon, MousePointer2, PanelRight, Scan, Upload, X },
  attrs: { "aria-hidden": "true" },
});

const elements = Object.fromEntries([
  "file-name", "file-input", "empty-state", "drop-zone",
  "processing-state", "progress-bar", "progress-title", "progress-detail", "error-state", "error-message",
  "viewer", "scene-canvas", "layer-count", "layer-summary", "layer-list", "model-status", "model-summary",
  "metric-entities", "metric-objects", "metric-issues", "selection-status", "empty-selection", "property-list",
  "report-list", "download-report", "download-glb", "fit-view", "top-view", "toggle-grid", "toggle-shadows",
  "view-toolbar", "cursor-position", "footer-status", "unit-status", "inspector-panel", "toggle-inspector",
  "close-inspector", "layer-panel", "toggle-layers", "close-layers",
  "region-select",
].map((id) => [id, document.querySelector(`#${id}`)]));

const renderer = new THREE.WebGLRenderer({
  canvas: elements["scene-canvas"],
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdedfdc);
scene.fog = new THREE.Fog(0xdedfdc, 500, 8_000);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100_000);
camera.position.set(120, 110, 150);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ambientOcclusion = new GTAOPass(scene, camera, 1, 1);
ambientOcclusion.blendIntensity = 0.5;
ambientOcclusion.updateGtaoMaterial({ radius: 0.42, thickness: 1.1, distanceFallOff: 1, samples: 12, screenSpaceRadius: true });
ambientOcclusion.enabled = !matchMedia("(max-width: 760px)").matches;
composer.addPass(ambientOcclusion);
composer.addPass(new SMAAPass());
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, elements["scene-canvas"]);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI / 2.01;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xf7f4ec, 0x69726d, 2.15));
const sun = new THREE.DirectionalLight(0xfff3da, 3.1);
sun.position.set(-140, 240, 110);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.04;
scene.add(sun);

const sky = new Sky();
sky.scale.setScalar(20_000);
sky.material.uniforms.turbidity.value = 4;
sky.material.uniforms.rayleigh.value = 1.7;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.82;
sky.material.uniforms.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(135));
scene.add(sky);

const grid = new THREE.GridHelper(10_000, 200, 0x9ea5a1, 0xc5c9c5);
grid.position.y = 0.03;
grid.material.transparent = true;
grid.material.opacity = 0.3;
scene.add(grid);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pointerGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerPoint = new THREE.Vector3();
const loader = new GLTFLoader();
const worker = new Worker(new URL("./conversion-worker.mjs", import.meta.url), { type: "module" });

let requestSequence = 0;
let activeRequest = null;
let currentMode = "solid";
let solidRoot = null;
let lineworkRoot = null;
let activeRegionRoot = null;
let currentResult = null;
let objectById = new Map();
let selectedHelper = null;
let pointerDown = null;

worker.addEventListener("message", async (event) => {
  const message = event.data;
  if (message?.id !== activeRequest) return;
  if (message.type === "progress") {
    showProgress(message.progress);
    return;
  }
  if (message.type === "error") {
    activeRequest = null;
    showError(message.error.message);
    return;
  }
  activeRequest = null;
  try {
    await displayResult(message.result);
  } catch (error) {
    console.error(error);
    showError(`模型已转换，但 Three.js 无法载入 GLB：${error.message}`);
  }
});

worker.addEventListener("error", (event) => showError(event.message || "后台转换线程异常。"));

elements["file-input"].addEventListener("click", () => { elements["file-input"].value = ""; });
elements["file-input"].addEventListener("change", () => {
  const file = elements["file-input"].files?.[0];
  if (file) convertFile(file);
});

for (const type of ["dragenter", "dragover"]) {
  elements["drop-zone"].addEventListener(type, (event) => {
    event.preventDefault();
    elements["drop-zone"].classList.add("is-dragging");
  });
}
for (const type of ["dragleave", "drop"]) {
  elements["drop-zone"].addEventListener(type, (event) => {
    event.preventDefault();
    elements["drop-zone"].classList.remove("is-dragging");
  });
}
elements["drop-zone"].addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) convertFile(file);
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
elements["fit-view"].addEventListener("click", () => fitView(true));
elements["top-view"].addEventListener("click", setTopView);
elements["toggle-grid"].addEventListener("change", () => { grid.visible = elements["toggle-grid"].checked; });
elements["toggle-shadows"].addEventListener("change", applyShadowSetting);
elements["download-glb"].addEventListener("click", downloadCurrentGlb);
elements["download-report"].addEventListener("click", downloadReport);
elements["region-select"].addEventListener("change", () => setRegion(elements["region-select"].value));
elements["toggle-inspector"].addEventListener("click", () => toggleMobilePanel("inspector", "layers"));
elements["close-inspector"].addEventListener("click", () => setMobilePanelOpen("inspector", false));
elements["toggle-layers"].addEventListener("click", () => toggleMobilePanel("layers", "inspector"));
elements["close-layers"].addEventListener("click", () => setMobilePanelOpen("layers", false));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  setMobilePanelOpen("layers", false);
  setMobilePanelOpen("inspector", false);
});

elements["scene-canvas"].addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
elements["scene-canvas"].addEventListener("pointerup", (event) => {
  if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const root = visibleRoot();
  const hit = root ? raycaster.intersectObject(root, true)[0] : null;
  selectFromObject(hit?.object ?? null);
});
elements["scene-canvas"].addEventListener("pointermove", (event) => {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(pointerGround, pointerPoint)) {
    elements["cursor-position"].textContent = `X ${pointerPoint.x.toFixed(1)} · Z ${pointerPoint.z.toFixed(1)}`;
  }
});

window.addEventListener("resize", resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  composer.render();
});

function toggleMobilePanel(panelName, otherPanelName) {
  const panel = elements[`${panelName === "layers" ? "layer" : panelName}-panel`];
  const shouldOpen = !panel.classList.contains("is-open");
  if (shouldOpen) setMobilePanelOpen(otherPanelName, false);
  setMobilePanelOpen(panelName, shouldOpen);
}

function setMobilePanelOpen(panelName, open) {
  const panelId = panelName === "layers" ? "layer-panel" : "inspector-panel";
  elements[panelId].classList.toggle("is-open", open);
  elements[`toggle-${panelName}`].setAttribute("aria-expanded", String(open));
}

async function convertFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!new Set(["dwg", "dxf"]).has(extension)) {
    showError("请选择 .dwg 或 ASCII .dxf 文件。");
    return;
  }
  if (file.size > 250 * 1024 * 1024) {
    showError("文件超过 250 MB，当前浏览器内存处理模式不适合这份图纸。");
    return;
  }

  clearSelection();
  elements["file-name"].textContent = file.name;
  elements["empty-state"].classList.add("is-hidden");
  elements["error-state"].classList.add("is-hidden");
  elements["processing-state"].classList.remove("is-hidden");
  elements["progress-title"].textContent = "正在转换图纸";
  elements["progress-detail"].textContent = "读取本地文件";
  elements["progress-bar"].style.width = "2%";
  elements["footer-status"].textContent = "本地转换进行中";

  const input = await file.arrayBuffer();
  const id = `conversion-${Date.now()}-${requestSequence += 1}`;
  activeRequest = id;
  worker.postMessage({ type: "convert", id, input, name: file.name }, [input]);
}

function showProgress(progress) {
  elements["progress-bar"].style.width = `${Math.max(2, progress.ratio * 100)}%`;
  elements["progress-detail"].textContent = progress.detail;
}

async function displayResult(result) {
  disposeRoot(solidRoot);
  disposeRoot(lineworkRoot);
  solidRoot = null;
  lineworkRoot = null;
  currentResult = result;
  objectById = new Map(result.semanticModel.objects.map((object) => [object.id, object]));

  const [solid, linework] = await Promise.all([
    result.solidGlb ? loader.parseAsync(toArrayBuffer(result.solidGlb), "") : null,
    loader.parseAsync(toArrayBuffer(result.lineworkGlb), ""),
  ]);
  solidRoot = solid?.scene ?? null;
  lineworkRoot = linework.scene;
  if (solidRoot) scene.add(solidRoot);
  scene.add(lineworkRoot);
  prepareRoot(solidRoot, true);
  prepareRoot(lineworkRoot, false);

  const hasSolid = Boolean(solidRoot && result.semanticModel.objects.length);
  const solidButton = document.querySelector('[data-mode="solid"]');
  solidButton.disabled = !hasSolid;
  populateRegions(result.semanticModel.regions ?? []);
  setMode(hasSolid ? "solid" : "linework");
  populateLayers(result.drawing.layers);
  populateSummary(result);
  populateReport(result.report);
  applyShadowSetting();
  fitView(false);

  elements["processing-state"].classList.add("is-hidden");
  elements["view-toolbar"].classList.remove("is-hidden");
  elements["cursor-position"].classList.remove("is-hidden");
  elements["fit-view"].disabled = false;
  elements["top-view"].disabled = false;
  elements["download-glb"].disabled = false;
  elements["download-report"].disabled = false;
  elements["footer-status"].textContent = hasSolid ? "实体模型已就绪" : "线框模型已就绪";
}

function setMode(mode) {
  if (mode === "solid" && (!solidRoot || !currentResult?.semanticModel.objects.length)) return;
  currentMode = mode;
  if (solidRoot) solidRoot.visible = mode === "solid";
  if (lineworkRoot) lineworkRoot.visible = mode === "linework";
  elements["region-select"].disabled = mode !== "solid";
  ambientOcclusion.enabled = mode === "solid" && !matchMedia("(max-width: 760px)").matches;
  sky.visible = mode === "solid";
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  clearSelection();
  fitView(false);
}

function populateRegions(regions) {
  elements["region-select"].replaceChildren(...regions.map((region) => {
    const option = document.createElement("option");
    option.value = region.id;
    option.textContent = `${region.label} · ${region.objectCount} 个对象`;
    return option;
  }));
  elements["region-select"].classList.toggle("is-hidden", regions.length <= 1);
  if (!regions.length) {
    activeRegionRoot = solidRoot;
    return;
  }
  const preferred = preferredRegionId(regions);
  elements["region-select"].value = preferred;
  setRegion(preferred, false);
}

function setRegion(regionId, refit = true) {
  activeRegionRoot = showOnlyRegion(solidRoot, regionId);
  elements["region-select"].value = regionId;
  clearSelection();
  if (refit && currentMode === "solid") fitView(true);
}

function populateLayers(layers) {
  const visibleLayers = layers.filter((layer) => layer.entityCount > 0);
  elements["layer-count"].textContent = visibleLayers.length;
  elements["layer-summary"].innerHTML = `<strong>${formatNumber(visibleLayers.reduce((sum, layer) => sum + layer.entityCount, 0))}</strong><span>个分层图元</span>`;
  elements["layer-list"].replaceChildren(...visibleLayers.map((layer) => {
    const label = document.createElement("label");
    label.className = "layer-row";
    const swatch = document.createElement("span");
    swatch.className = "layer-swatch";
    swatch.style.background = layer.color || layerColor(layer.name);
    const copy = document.createElement("span");
    copy.className = "layer-copy";
    const name = document.createElement("strong");
    name.textContent = layer.name;
    const count = document.createElement("small");
    count.textContent = `${formatNumber(layer.entityCount)} 图元`;
    copy.append(name, count);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = layer.visible !== false;
    input.addEventListener("change", () => setLayerVisibility(layer.name, input.checked));
    const toggle = document.createElement("span");
    toggle.className = "toggle";
    label.append(swatch, copy, input, toggle);
    return label;
  }));
}

function populateSummary(result) {
  const statusLabels = {
    ready: "可建模",
    "ready-with-assumptions": "含假设，可评审",
    "needs-review": "需要校正",
  };
  const status = result.semanticModel.status;
  elements["model-status"].textContent = statusLabels[status] ?? status;
  elements["model-summary"].textContent = status === "needs-review"
    ? "已保留线框结果，请先检查单位、闭合轮廓和用途标注。"
    : `识别到 ${result.semanticModel.objects.length} 个实体对象，参数来源与假设已写入报告。`;
  document.querySelectorAll(".status-dot").forEach((dot) => {
    dot.classList.toggle("is-ready", status === "ready");
    dot.classList.toggle("is-review", status !== "ready");
  });
  elements["metric-entities"].textContent = formatNumber(result.drawing.statistics.entityCount);
  elements["metric-objects"].textContent = formatNumber(result.semanticModel.objects.length);
  elements["metric-issues"].textContent = formatNumber(result.report.issues.length);
  elements["unit-status"].textContent = `单位 ${result.drawing.units.name} · ${result.drawing.units.source === "drawing-header" ? "图纸读取" : "待确认"}`;
}

function populateReport(report) {
  if (!report.issues.length) {
    const item = document.createElement("p");
    item.className = "report-empty";
    item.textContent = "未发现阻断性问题";
    elements["report-list"].replaceChildren(item);
    return;
  }
  elements["report-list"].replaceChildren(...report.issues.map((record) => {
    const item = document.createElement("article");
    item.className = `report-item severity-${record.severity}`;
    const heading = document.createElement("strong");
    heading.textContent = record.message;
    const action = document.createElement("p");
    action.textContent = record.suggestedAction;
    item.append(heading, action);
    return item;
  }));
}

function setLayerVisibility(layerName, visible) {
  if (lineworkRoot) {
    lineworkRoot.traverse((object) => {
      if (object.userData.layer === layerName) object.visible = visible;
    });
  }
  if (solidRoot) {
    solidRoot.traverse((object) => {
      if (object.userData.sourceLayer === layerName) object.visible = visible;
    });
  }
  clearSelection();
}

function selectFromObject(object) {
  if (currentMode !== "solid") {
    clearSelection();
    return;
  }
  let target = object;
  while (target && !target.userData.semanticId) target = target.parent;
  const record = target ? objectById.get(target.userData.semanticId) : null;
  if (!record) {
    clearSelection();
    return;
  }

  clearSelection();
  selectedHelper = new THREE.BoxHelper(target, 0xd47b2d);
  scene.add(selectedHelper);
  elements["selection-status"].textContent = record.confidence.level === "high" ? "高置信" : record.confidence.level === "medium" ? "需复核" : "低置信";
  elements["empty-selection"].hidden = true;
  elements["property-list"].hidden = false;
  const properties = [
    ["名称", record.name],
    ["类型", kindLabel(record.kind)],
    ["面积", `${formatNumber(record.areaM2)} m²`],
    ["高度", `${record.parameters.height} m`],
    ["屋顶", record.parameters.roofType === "gable" ? "双坡" : "平屋顶"],
    ["源图层", record.source.layer],
    ["参数来源", record.source.heightSource],
  ];
  elements["property-list"].replaceChildren(...properties.flatMap(([key, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  }));
}

function clearSelection() {
  if (selectedHelper) {
    scene.remove(selectedHelper);
    selectedHelper.geometry.dispose();
    selectedHelper.material.dispose();
    selectedHelper = null;
  }
  elements["selection-status"].textContent = "未选择";
  elements["empty-selection"].hidden = false;
  elements["property-list"].hidden = true;
  elements["property-list"].replaceChildren();
}

function prepareRoot(root, solid) {
  root?.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = solid && object.userData.surface !== "glass";
    object.receiveShadow = solid;
    if (object.material) object.material.envMapIntensity = solid ? 0.78 : 0;
  });
}

function applyShadowSetting() {
  const enabled = elements["toggle-shadows"].checked;
  renderer.shadowMap.enabled = enabled;
  sun.castShadow = enabled;
  solidRoot?.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = enabled && object.userData.surface !== "glass";
      object.receiveShadow = enabled;
    }
  });
}

function fitView(animate) {
  const root = visibleRoot();
  if (!root) return;
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 10);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(radius * 0.9, radius * 0.72, radius * 1.05));
  camera.near = Math.max(0.05, radius / 10_000);
  camera.far = Math.max(2_000, radius * 100);
  camera.updateProjectionMatrix();
  controls.minDistance = radius * 0.03;
  controls.maxDistance = radius * 8;
  if (!animate) controls.update();
}

function setTopView() {
  const root = visibleRoot();
  if (!root) return;
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z, 10);
  controls.target.copy(center);
  camera.position.set(center.x, center.y + radius * 1.5, center.z + 0.001);
  camera.up.set(0, 0, -1);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.update();
  camera.up.set(0, 1, 0);
}

function visibleRoot() {
  return currentMode === "solid" ? (activeRegionRoot ?? solidRoot) : lineworkRoot;
}

function showError(message) {
  elements["processing-state"].classList.add("is-hidden");
  elements["empty-state"].classList.add("is-hidden");
  elements["error-state"].classList.remove("is-hidden");
  elements["error-message"].textContent = message;
  elements["footer-status"].textContent = "转换失败";
}

function downloadCurrentGlb() {
  if (!currentResult) return;
  const bytes = currentMode === "solid" ? currentResult.solidGlb : currentResult.lineworkGlb;
  if (!bytes) return;
  downloadBlob(new Blob([bytes], { type: "model/gltf-binary" }), currentMode === "solid" ? "cad3d-model.glb" : "cad3d-linework.glb");
}

function downloadReport() {
  if (!currentResult) return;
  downloadBlob(new Blob([JSON.stringify(currentResult.report, null, 2)], { type: "application/json" }), "modeling-report.json");
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function disposeRoot(root) {
  if (!root) return;
  scene.remove(root);
  root.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => material.dispose?.());
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
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

function layerColor(name) {
  let hash = 2166136261;
  for (const character of name) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 38% 48%)`;
}

function kindLabel(kind) {
  return { factory: "厂房", warehouse: "仓库", shed: "工棚", canopy: "雨棚", office: "办公楼", service: "配套建筑", building: "待确认建筑" }[kind] ?? kind;
}
