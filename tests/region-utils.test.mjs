// SPDX-License-Identifier: GPL-2.0-only

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { isRegionNode, isSemanticObject, preferredRegionId, regionIdentity, showOnlyRegion } from "../src/region-utils.mjs";

test("prefers the region with the most modeled objects", () => {
  const regions = [
    { id: "region-1", objectCount: 2 },
    { id: "region-2", objectCount: 6 },
    { id: "region-3", objectCount: 4 },
  ];
  assert.equal(preferredRegionId(regions), "region-2");
  regions.forEach((region) => { region.initiallyVisible = true; });
  assert.equal(preferredRegionId(regions), "region-2");
  regions[0].initiallyVisible = false;
  regions[1].initiallyVisible = false;
  assert.equal(preferredRegionId(regions), "region-3");
  assert.equal(preferredRegionId(regions, "region-1"), "region-1");
  assert.equal(preferredRegionId([]), null);
});

test("recognizes both CAD3D 1.1 regions and legacy demo schemes", () => {
  const region = new THREE.Group();
  region.userData = { category: "region", regionId: "region-1", regionLabel: "方案 1" };
  const legacy = new THREE.Group();
  legacy.name = "scheme-D";
  legacy.userData = { scheme: "D", label: "方案 D" };
  assert.equal(isRegionNode(region), true);
  assert.equal(isRegionNode(legacy), true);
  assert.deepEqual(regionIdentity(legacy), { id: "D", label: "方案 D" });
});

test("recognizes current and legacy semantic building nodes", () => {
  const current = new THREE.Group();
  current.userData = { category: "building", semanticId: "A1" };
  const legacy = new THREE.Mesh();
  legacy.userData = { category: "buildings", displayName: "一号厂房" };
  assert.equal(isSemanticObject(current), true);
  assert.equal(isSemanticObject(legacy), true);
});

test("shows only the requested GLB region group", () => {
  const root = new THREE.Group();
  const regions = ["region-1", "region-2", "region-3"].map((id) => {
    const group = new THREE.Group();
    group.userData = { category: "region", regionId: id };
    root.add(group);
    return group;
  });
  const active = showOnlyRegion(root, "region-2");
  assert.equal(active, regions[1]);
  assert.deepEqual(regions.map((group) => group.visible), [false, true, false]);
});
