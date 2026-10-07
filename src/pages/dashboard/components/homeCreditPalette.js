// Match the tier editor's HEX contract; invalid or absent colors keep the home default.
export function getHomeCreditPalette(color) {
  const hex = typeof color === "string" && /^#([\da-f]{3}|[\da-f]{6})$/i.test(color)
    ? color.slice(1) : "8250d7";
  const fullHex = hex.length === 3 ? [...hex].map(char => char + char).join("") : hex;
  const channels = [0, 2, 4].map(offset => parseInt(fullHex.slice(offset, offset + 2), 16));
  const mix = (base, amount) => `#${channels.map((channel, index) =>
    Math.round(base[index] * (1 - amount) + channel * amount).toString(16).padStart(2, "0")
  ).join("")}`;
  return {
    "--credit-tier-color": `#${fullHex}`,
    "--credit-surface": mix([240, 245, 255], 0.06),
    "--credit-border": mix([220, 233, 255], 0.16),
    "--credit-soft": mix([240, 245, 255], 0.14),
    "--credit-ink": mix([11, 23, 52], 0.42),
  };
}
