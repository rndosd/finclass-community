// Only placement changes: desk identities, students and financial data stay intact.
export const createTemplatePositions = (count, template, displayScale = 100,
  { columns = 0, divisionCount = 0, groupCount = 0, groupSize = 4, spacing = 1 } = {}) => {
  // Keep the saved footprint clear even when desks are displayed smaller.
  const scale = Math.max(1, displayScale / 100) * spacing;
  const step = 2.5 * scale;
  const clusters = groupCount ? Math.min(groupCount, count) : Math.ceil(count / groupSize);
  const maxGroupSize = groupCount ? Math.ceil(count / Math.max(1, clusters)) : groupSize;
  const groupColumns = maxGroupSize <= 6 ? 2 : Math.ceil(Math.sqrt(maxGroupSize));
  const blocksAcross = Math.max(1, Math.ceil(Math.sqrt(clusters)));
  const rows = Math.max(1, Math.min(5, Math.ceil(count / 4)), Math.ceil(count / 16));
  const columnCount = (template === 'columns' && divisionCount ? divisionCount * 2 : columns)
    || Math.ceil(count / rows);
  const positions = Array.from({ length: count }, (_, index) => {
    if (template === 'teams') {
      const cluster = groupCount ? Math.floor(index * clusters / count) : Math.floor(index / groupSize);
      const localIndex = groupCount ? index - Math.ceil(cluster * count / clusters) : index % groupSize;
      const groupRows = Math.ceil(maxGroupSize / groupColumns);
      return { x: 3 + cluster % blocksAcross * (groupColumns * 2.5 + 3) * scale + localIndex % groupColumns * step,
        y: 3 + Math.floor(cluster / blocksAcross) * (groupRows * 2.5 + 3) * scale
          + Math.floor(localIndex / groupColumns) * step };
    }
    if (template === 'horseshoe') {
      const side = Math.max(2, Math.ceil(count / 3));
      const gap = 2.6 * scale;
      if (index < side) return { x: 3, y: 3 + index * gap };
      if (index < side * 2) return { x: 3 + (index - side + 1) * gap, y: 3 + (side - 1) * gap };
      return { x: 3 + (side + 1) * gap, y: 3 + (count - index - 1) * gap };
    }
    if (template === 'circle') {
      if (count === 1) return { x: 3, y: 3 };
      // Diagonal neighbors need room for square desks, too.
      const radius = step * Math.SQRT2 / (2 * Math.sin(Math.PI / count));
      const angle = -Math.PI / 2 + index * 2 * Math.PI / count;
      return { x: 3 + radius * (1 + Math.cos(angle)), y: 3 + radius * (1 + Math.sin(angle)) };
    }
    const column = index % columnCount;
    return { x: 3 + (template === 'rows' ? column * step
      : (Math.floor(column / 2) * 6.8 + column % 2 * 2.5) * scale),
    y: 3 + Math.floor(index / columnCount) * step };
  }).map(({ x, y }) => ({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) }));
  if (positions.some(({ x, y }) => x > 200 || y > 200)) {
    throw new Error('현재 책상 수와 간격으로는 배치 범위를 넘습니다. 간격을 줄이거나 다른 형태를 선택해 주세요.');
  }
  return positions;
};
