import React from 'react';

export const HeterogeneousIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
    {...props}>
    <path d="m3 15 4-4 4 4 4-4 4 4"/>
    <path d="m3 9 4-4 4 4 4-4 4 4"/>
  </svg>
);