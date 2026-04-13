import type { SVGProps } from 'react';

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <g transform="translate(18 0) scale(-1 1)">
        <path opacity="0.3" d="M13.605 4.75L13.099 14.35C13.043 15.4201 12.1651 16.25 11.1021 16.25H6.89705C5.83305 16.25 4.95604 15.42 4.90004 14.35L4.39404 4.75" fill="currentColor" />
        <path d="M2.75 4.75H15.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.75 4.75V2.75C6.75 2.2 7.198 1.75 7.75 1.75H10.25C10.802 1.75 11.25 2.2 11.25 2.75V4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.8557 4.75L13.35 14.35C13.294 15.4201 12.416 16.25 11.353 16.25H6.64796C5.58396 16.25 4.70697 15.42 4.65097 14.35L4.14526 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
