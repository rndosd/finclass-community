const VALID_DASHBOARD_CARDS = new Set([
  "news",
  "asset",
  "mission",
  "credit",
  "donation",
]);

const DASHBOARD_ORDER_CLASSES = [
  "lg:order-1",
  "lg:order-2",
  "lg:order-3",
  "lg:order-4",
  "lg:order-5",
];

const LAYOUTS_BY_COUNT = {
  1: [{ variant: "hero", gridClassName: "lg:col-span-12" }],
  2: [
    { variant: "hero", gridClassName: "lg:col-span-7" },
    { variant: "featured", gridClassName: "lg:col-span-5" },
  ],
  3: [
    { variant: "hero", gridClassName: "lg:col-span-7 lg:row-span-2" },
    { variant: "featured", gridClassName: "lg:col-span-5" },
    { variant: "compact", gridClassName: "lg:col-span-5" },
  ],
  4: [
    { variant: "hero", gridClassName: "lg:col-span-7" },
    { variant: "featured", gridClassName: "lg:col-span-5" },
    { variant: "compact", gridClassName: "lg:col-span-6" },
    { variant: "compact", gridClassName: "lg:col-span-6" },
  ],
  5: [
    { variant: "hero", gridClassName: "lg:col-span-7" },
    { variant: "featured", gridClassName: "lg:col-span-5" },
    { variant: "compact", gridClassName: "lg:col-span-4" },
    { variant: "compact", gridClassName: "lg:col-span-4" },
    { variant: "compact", gridClassName: "lg:col-span-4" },
  ],
};

export const getFeaturedDashboardCardCount = (cardCount) => {
  if (cardCount <= 0) return 0;
  return Math.min(cardCount, 2);
};

export const getDashboardCardLayout = (cards = []) => {
  const visibleCards = Array.from(new Set(cards)).filter((card) =>
    VALID_DASHBOARD_CARDS.has(card),
  );
  const layout = LAYOUTS_BY_COUNT[Math.min(visibleCards.length, 5)] || [];

  return visibleCards.map((cardType, index) => ({
    cardType,
    ...(layout[index] || {
      variant: "compact",
      gridClassName: "lg:col-span-12",
    }),
    orderClassName: DASHBOARD_ORDER_CLASSES[index] || "",
  }));
};
