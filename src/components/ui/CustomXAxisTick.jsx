import React from 'react';

const CustomXAxisTick = ({ x, y, payload }) => {
  if (!payload || typeof payload.value !== 'number') {
    return null;
  }

  const date = new Date(payload.value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        textAnchor="middle"
        fill="#6B7280"
        fontSize="10px"
        fontWeight="500"
      >
        <tspan x="0" dy="0em">{`${month}/${day}`}</tspan>
        <tspan x="0" dy="1.1em">{`'${year}`}</tspan>
      </text>
    </g>
  );
};

export default CustomXAxisTick;
