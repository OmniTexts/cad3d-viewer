// SPDX-License-Identifier: GPL-2.0-only

export function preferredRegionId(regions) {
  if (!regions?.length) return null;
  return [...regions].sort((a, b) => b.objectCount - a.objectCount)[0].id;
}

export function showOnlyRegion(root, regionId) {
  let active = null;
  root?.traverse((object) => {
    if (object.userData?.category !== "region") return;
    object.visible = object.userData.regionId === regionId;
    if (object.visible) active = object;
  });
  return active;
}
