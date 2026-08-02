// SPDX-License-Identifier: GPL-2.0-only

export function preferredRegionId(regions, requestedId = null) {
  if (!regions?.length) return null;
  const visible = regions.filter((region) => region.initiallyVisible);
  return regions.find((region) => region.id === requestedId)?.id
    ?? (visible.length === 1 ? visible[0].id : null)
    ?? [...regions].sort((a, b) => b.objectCount - a.objectCount)[0].id;
}

export function showOnlyRegion(root, regionId) {
  let active = null;
  root?.traverse((object) => {
    if (!isRegionNode(object)) return;
    object.visible = regionIdentity(object).id === regionId;
    if (object.visible) active = object;
  });
  return active;
}

export function isRegionNode(object) {
  return object?.userData?.category === "region"
    || object?.userData?.role === "scheme"
    || Boolean(object?.userData?.scheme && /^scheme-/i.test(object.name));
}

export function regionIdentity(object) {
  return {
    id: object.userData?.regionId ?? object.userData?.schemeId ?? object.userData?.scheme ?? object.uuid,
    label: object.userData?.regionLabel ?? object.userData?.label ?? object.name,
  };
}

export function isSemanticObject(object) {
  return object?.userData?.category === "building"
    || (object?.userData?.category === "buildings" && !object.userData?.helper && Boolean(object.userData?.displayName));
}
