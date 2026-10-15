import React from 'react';

export const ArrowExpandVerticalIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
    <polyline points="17 21 12 16 7 21"></polyline>
    <polyline points="17 3 12 8 7 3"></polyline>
    <line x1="12" y1="16" x2="12" y2="8"></line>
  </svg>
);
