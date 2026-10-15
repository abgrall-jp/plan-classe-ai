import React from 'react';

export const HomogeneousIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
    <line x1="5" y1="9" x2="19" y2="9"></line>
    <line x1="5" y1="15" x2="19" y2="15"></line>
  </svg>
);