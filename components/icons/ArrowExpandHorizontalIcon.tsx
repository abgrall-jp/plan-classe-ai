import React from 'react';

export const ArrowExpandHorizontalIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <polyline points="21 17 16 12 21 7"></polyline>
    <polyline points="3 17 8 12 3 7"></polyline>
    <line x1="16" y1="12" x2="8" y2="12"></line>
  </svg>
);
