// SPDX-License-Identifier: GPL-2.0-only

import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { preferredRegionId, showOnlyRegion } from "../src/region-utils.mjs";

test("prefers the region with the most modeled objects", () => {
  const regions = [
    { id: "region-1", objectCount: 2 },
    { id: "region-2", objectCount: 6 },
    { id: "region-3", objectCount: 4 },
  ];
  assert.equal(preferredRegionId(regions), "region-2");
  assert.equal(preferredRegionId([]), null);
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
