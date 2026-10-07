function unwrapAssetModule(assetModule) {
  return assetModule?.default || assetModule || null;
}

export function createTitleOrnamentAssetCatalog({
  genericContext,
  variantContext,
} = {}) {
  const generic = {};
  const variants = {};

  genericContext?.keys?.().forEach((key) => {
    const match = key.match(/^\.\/([^/]+)\/([^/]+)\.webp$/);
    if (!match) return;

    const src = unwrapAssetModule(genericContext(key));
    if (src) {
      generic[`${match[1]}/${match[2]}`] = src;
    }
  });

  variantContext?.keys?.().forEach((key) => {
    const match = key.match(
      /^\.\/([^/]+)\/([^/]+)\/([^/]+)\/(front|rear)\.webp$/,
    );
    if (!match) return;

    const src = unwrapAssetModule(variantContext(key));
    if (!src) return;

    const variantKey = `${match[1]}/${match[2]}/${match[3]}`;
    variants[variantKey] = variants[variantKey] || { front: null, rear: null };
    variants[variantKey][match[4]] = src;
  });

  return { generic, variants };
}

export function resolveTitleOrnamentAssetSources(
  catalog,
  { ornamentSet, paletteId } = {},
) {
  if (!ornamentSet?.asset) {
    return { front: null, rear: null };
  }

  const variant = catalog?.variants?.[`${ornamentSet.asset}/${paletteId}`];
  if (variant?.front) {
    return {
      front: variant.front,
      rear: variant.rear || null,
    };
  }

  return {
    front: catalog?.generic?.[ornamentSet.asset] || null,
    rear: ornamentSet.rearAsset
      ? catalog?.generic?.[ornamentSet.rearAsset] || null
      : null,
  };
}
