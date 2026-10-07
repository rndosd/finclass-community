import React from 'react';

const SeatDirection = ({ rotation = 0, size = 'small' }) => (
  <span
    className={`inline-flex items-center justify-center ${size === 'large' ? 'h-10 w-14' : 'h-6 w-7'}`}
    aria-hidden="true"
  >
    <span
      className={`relative block rounded border-2 border-slate-500 bg-slate-100 ${size === 'large' ? 'h-7 w-10' : 'h-4 w-5'}`}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <span className="absolute -bottom-2 left-1/2 h-1.5 w-1/2 -translate-x-1/2 rounded-b bg-slate-500" />
    </span>
  </span>
);

export default SeatDirection;
