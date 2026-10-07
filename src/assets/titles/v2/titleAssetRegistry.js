import plaqueSlateFrame from "./plaque/frame-base-slate-v1.png";
import arcMasterFrame from "./arc/frame-master-v2.png";
import blossomMasterFrame from "./blossom/frame-master-v2.png";
import jewelMasterFrame from "./jewel/frame-master-v2.png";
import marqueeMasterFrame from "./marquee/frame-master-v2.png";
import sealMasterFrame from "./seal/frame-master-v3.png";
import shieldMasterFrame from "./shield/frame-master-v3.png";
import scrollMasterFrame from "./scroll/frame-master-v3.png";
import ticketMasterFrame from "./ticket/frame-master-v2.png";
import wingMasterFrame from "./wing/frame-master-v2.png";

const GENERATED_METAL_IDS = ["satin-silver", "champagne-gold", "rose-bronze"];
const GENERATED_PALETTE_IDS = new Set([
  "sapphire",
  "sky",
  "emerald",
  "teal",
  "ruby",
  "rose",
  "amethyst",
  "magenta",
  "amber",
  "sunset",
  "ivory",
  "slate",
  "lime",
  "deep-red",
  "charcoal",
  "vip-champagne",
  "legendary-ember",
  "aurora-violet",
]);
const LEGACY_PALETTE_ALIASES = {
  royal: "amber",
  violet: "amethyst",
};
const DEFAULT_GENERATED_FRAME_ID = "plaque";
const DEFAULT_GENERATED_PALETTE_ID = "sky";
const DEFAULT_GENERATED_METAL_ID = "satin-silver";

// The production set is intentionally loaded from one registry so every
// frame family, inner colour, and metal trim stays on the same asset path.
const generatedAssetContext = require.context("../v3/generated", true, /\.webp$/);
const GENERATED_FRAME_ASSETS = generatedAssetContext.keys().reduce((result, key) => {
  const pathMatch = key.match(/^\.\/([^/]+)\/([^/]+)\.(png|webp)$/);
  if (!pathMatch) return result;

  const frameId = pathMatch[1];
  const fileName = pathMatch[2];
  const prefix = `${frameId}-`;
  if (!fileName.startsWith(prefix)) return result;

  const remainder = fileName.slice(prefix.length).replace(/-v\d+$/, "");
  const metalId = GENERATED_METAL_IDS.find((candidate) => remainder.endsWith(`-${candidate}`));
  if (!metalId) return result;

  const paletteId = remainder.slice(0, -(metalId.length + 1));
  if (!GENERATED_PALETTE_IDS.has(paletteId)) return result;

  const assetModule = generatedAssetContext(key);
  const src = assetModule?.default || assetModule;
  if (!src) return result;

  result[frameId] = result[frameId] || {};
  result[frameId][paletteId] = result[frameId][paletteId] || {};
  result[frameId][paletteId][metalId] = src;
  return result;
}, {});

function getGeneratedFrameAsset(style) {
  const metalId =
    style.trimPaletteId === "gold"
      ? "champagne-gold"
      : style.trimPaletteId === "bronze"
        ? "rose-bronze"
      : style.trimPaletteId === "silver" || style.trimPaletteId === "match"
        ? "satin-silver"
        : "";

  const requestedFrameId = GENERATED_FRAME_ASSETS[style.familyId]
    ? style.familyId
    : DEFAULT_GENERATED_FRAME_ID;
  const requestedPaletteId = LEGACY_PALETTE_ALIASES[style.paletteId] || style.paletteId;
  const requestedMetalId = metalId || DEFAULT_GENERATED_METAL_ID;
  const frameAssets = GENERATED_FRAME_ASSETS[requestedFrameId] || GENERATED_FRAME_ASSETS[DEFAULT_GENERATED_FRAME_ID];

  return (
    (GENERATED_PALETTE_IDS.has(requestedPaletteId) && frameAssets?.[requestedPaletteId]?.[requestedMetalId]) ||
    frameAssets?.[DEFAULT_GENERATED_PALETTE_ID]?.[requestedMetalId] ||
    frameAssets?.[DEFAULT_GENERATED_PALETTE_ID]?.[DEFAULT_GENERATED_METAL_ID] ||
    GENERATED_FRAME_ASSETS[DEFAULT_GENERATED_FRAME_ID]?.[DEFAULT_GENERATED_PALETTE_ID]?.[DEFAULT_GENERATED_METAL_ID] ||
    null
  );
}


// The illustrated families share one high-quality metal master per family.
// Palette colors are applied to the inset enamel at runtime, preserving the
// baked silver texture while keeping all eight palette choices available.
const FAMILY_MASTER_ASSETS = {
  // Neutral plaque base for dynamic credit-tier colours that do not have a fixed palette id.
  plaque: { src: plaqueSlateFrame, x: 0, y: 24, width: 320, height: 107, labelLeft: "16%", labelRight: "16%", labelTop: "48%", badgeTop: "20%", toneOverlay: { x: 30, y: 54, width: 260, height: 48, rx: 7 } },
  arc: { src: arcMasterFrame, x: 0, y: 16, width: 320, height: 124, labelTop: "55%", badgeTop: "20%", toneOverlay: { x: 23, y: 57, width: 274, height: 48, rx: 7 } },
  blossom: { src: blossomMasterFrame, x: 0, y: 24, width: 320, height: 107, labelLeft: "19%", labelRight: "23%", labelTop: "50%", badgeTop: "20%", toneOverlay: { x: 27, y: 56, width: 249, height: 43, rx: 9 } },
  jewel: { src: jewelMasterFrame, x: 0, y: 22, width: 320, height: 111, labelLeft: "18%", labelRight: "18%", labelTop: "51%", badgeTop: "19%", toneOverlay: { x: 30, y: 56, width: 260, height: 43, rx: 4 } },
  marquee: { src: marqueeMasterFrame, x: 0, y: 24, width: 320, height: 107, labelLeft: "18%", labelRight: "18%", labelTop: "50%", badgeTop: "20%", toneOverlay: { x: 30, y: 54, width: 260, height: 48, rx: 7 } },
  seal: { src: sealMasterFrame, x: 0, y: 18, width: 320, height: 120, labelLeft: "17%", labelRight: "17%", labelTop: "57%", centerBadgeTop: "21%", toneOverlay: { x: 35, y: 59, width: 250, height: 43, rx: 8 } },
  shield: { src: shieldMasterFrame, x: 0, y: 0, width: 320, height: 156, labelLeft: "18%", labelRight: "18%", labelTop: "56%", badgeTop: "19%", toneOverlay: { x: 30, y: 52, width: 260, height: 56, rx: 12 } },
  scroll: { src: scrollMasterFrame, x: 0, y: 24, width: 320, height: 107, labelLeft: "19%", labelRight: "19%", labelTop: "51%", badgeTop: "20%", toneOverlay: { x: 38, y: 55, width: 244, height: 43, rx: 12 } },
  ticket: { src: ticketMasterFrame, x: 0, y: 24, width: 320, height: 107, labelLeft: "22%", labelRight: "18%", labelTop: "50%", badgeLeft: "73%", badgeTop: "20%", toneOverlay: { x: 31, y: 55, width: 258, height: 48, rx: 4 } },
  wing: { src: wingMasterFrame, x: 0, y: 22, width: 320, height: 111, labelLeft: "22%", labelRight: "22%", labelTop: "51%", badgeTop: "20%", toneOverlay: { x: 64, y: 56, width: 192, height: 42, rx: 5 } },
};

export function getTitleFrameAsset(style) {
  const generatedFrame = getGeneratedFrameAsset(style);
  if (!generatedFrame) return null;
  return {
    src: generatedFrame,
    x: 0,
    y: 0,
    width: 320,
    height: 156,
    layout: FAMILY_MASTER_ASSETS[style.familyId] || null,
    toneOverlay: null,
    filter: "none",
    renderer: "asset-generated",
    material:
      style.trimPaletteId === "gold"
        ? "champagne-gold"
        : style.trimPaletteId === "bronze"
          ? "rose-bronze"
          : "satin-silver",
  };
}
export function getTitleOrnamentAsset() {
  // Legacy placement-specific ornaments are retired. v3 uses only the
  // full-canvas WebP packs resolved through titleAppearanceRegistry.
  return null;
}
