import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <path d="M5.493 3.49204L4.547 3.17704L4.23101 2.23005C4.12901 1.92405 3.622 1.92405 3.52 2.23005L3.20401 3.17704L2.25801 3.49204C2.10501 3.54304 2.00101 3.68603 2.00101 3.84803C2.00101 4.01003 2.10501 4.15305 2.25801 4.20405L3.20401 4.51905L3.52 5.46604C3.571 5.61904 3.71401 5.72202 3.87501 5.72202C4.03601 5.72202 4.18001 5.61804 4.23001 5.46604L4.54601 4.51905L5.492 4.20405C5.645 4.15305 5.74901 4.01003 5.74901 3.84803C5.74901 3.68603 5.646 3.54304 5.493 3.49204Z" fill="currentColor" />
      <path d="M16.658 12.99L15.395 12.569L14.974 11.306C14.837 10.898 14.162 10.898 14.025 11.306L13.604 12.569L12.341 12.99C12.137 13.058 11.999 13.249 11.999 13.464C11.999 13.679 12.137 13.87 12.341 13.938L13.604 14.359L14.025 15.622C14.093 15.826 14.285 15.964 14.5 15.964C14.715 15.964 14.906 15.826 14.975 15.622L15.396 14.359L16.659 13.938C16.863 13.87 17.001 13.679 17.001 13.464C17.001 13.249 16.862 13.058 16.658 12.99Z" fill="currentColor" />
      <path d="M7.75 2.5C8.164 2.5 8.5 2.164 8.5 1.75C8.5 1.336 8.164 1 7.75 1C7.336 1 7 1.336 7 1.75C7 2.164 7.336 2.5 7.75 2.5Z" fill="currentColor" />
      <path d="M11.414 2.84802L3.605 10.657C2.742 11.521 2.204 14.063 2.012 15.116C1.968 15.358 2.046 15.607 2.22 15.781C2.362 15.923 2.553 16.001 2.75 16.001C2.794 16.001 2.839 15.997 2.884 15.989C3.937 15.798 6.479 15.26 7.343 14.396L15.152 6.58702C16.182 5.55602 16.182 3.88002 15.152 2.84902C14.154 1.85102 12.412 1.85102 11.414 2.84802Z" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

function ModelsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M2 3.75C2 2.78349 2.78349 2 3.75 2H6.25C7.21651 2 8 2.78349 8 3.75V6.25C8 7.21651 7.21651 8 6.25 8H3.75C2.78349 8 2 7.21651 2 6.25V3.75Z" fill="currentColor" fillOpacity="0.4" />
      <path fillRule="evenodd" clipRule="evenodd" d="M9.75 13C9.75 11.2051 11.2051 9.75 13 9.75C14.7949 9.75 16.25 11.2051 16.25 13C16.25 14.7949 14.7949 16.25 13 16.25C11.2051 16.25 9.75 14.7949 9.75 13Z" fill="currentColor" fillOpacity="0.4" />
      <path fillRule="evenodd" clipRule="evenodd" d="M7.78033 11.2803C8.07322 10.9874 8.07322 10.5126 7.78033 10.2197C7.48744 9.92678 7.01256 9.92678 6.71967 10.2197L5 11.9393L3.28033 10.2197C2.98744 9.92678 2.51256 9.92678 2.21967 10.2197C1.92678 10.5126 1.92678 10.9874 2.21967 11.2803L3.93934 13L2.21967 14.7197C1.92678 15.0126 1.92678 15.4874 2.21967 15.7803C2.51256 16.0732 2.98744 16.0732 3.28033 15.7803L5 14.0607L6.71967 15.7803C7.01256 16.0732 7.48744 16.0732 7.78033 15.7803C8.07322 15.4874 8.07322 15.0126 7.78033 14.7197L6.06066 13L7.78033 11.2803Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M14.0104 2.58371L16.1268 6.24857C16.5746 7.02538 16.0158 8 15.1156 8H10.8834C9.98322 8 9.42416 7.02579 9.87205 6.24898C10.5775 5.02736 11.2831 3.80578 11.9877 2.58371C12.4365 1.8053 13.5614 1.80557 14.0104 2.58371Z" fill="currentColor" />
    </svg>
  );
}

function SnippetsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <g transform="translate(18 0) scale(-1 1)">
        <path fillRule="evenodd" clipRule="evenodd" d="M3.49402 1C2.11253 1 0.994019 2.12007 0.994019 3.5C0.994019 4.49471 1.57521 5.3544 2.41714 5.75685L10.1618 9.6694C10.5315 9.85618 10.9826 9.70788 11.1694 9.33816C11.3562 8.96845 11.2079 8.51733 10.8382 8.33055L5.08807 5.42563C5.64142 4.96699 5.99402 4.2745 5.99402 3.5C5.99402 2.11979 4.87423 1 3.49402 1ZM3.06385 4.40301C3.19413 4.46519 3.33999 4.5 3.49402 4.5C4.0458 4.5 4.49402 4.05179 4.49402 3.5C4.49402 2.94821 4.0458 2.5 3.49402 2.5C2.94151 2.5 2.49402 2.94793 2.49402 3.5C2.49402 3.88395 2.71047 4.21753 3.02815 4.38509C3.03183 4.38688 3.03551 4.3887 3.03918 4.39055L3.06385 4.40301Z" fill="currentColor" />
        <path fillRule="evenodd" clipRule="evenodd" d="M10.8382 4.6694C11.2079 4.48263 11.3562 4.0315 11.1694 3.66179C10.9826 3.29208 10.5315 3.14378 10.1618 3.33055L2.41547 7.24395C1.57444 7.64675 0.994019 8.50595 0.994019 9.5C0.994019 10.8799 2.11253 12 3.49402 12C4.87423 12 5.99402 10.8802 5.99402 9.5C5.99402 8.72549 5.64141 8.03298 5.08803 7.57434L10.8382 4.6694ZM3.02927 8.61432C3.03258 8.61271 3.03588 8.61107 3.03918 8.6094L3.06216 8.59779C3.19287 8.53511 3.33933 8.5 3.49402 8.5C4.0458 8.5 4.49402 8.94821 4.49402 9.5C4.49402 10.0518 4.0458 10.5 3.49402 10.5C2.94151 10.5 2.49402 10.0521 2.49402 9.5C2.49402 9.1156 2.71097 8.78169 3.02927 8.61432Z" fill="currentColor" />
        <path d="M7.46461 9.98734C7.22409 11.9662 5.53769 13.5 3.49402 13.5C3.32974 13.5 3.16779 13.4901 3.00872 13.4709C3.12115 14.8867 4.30511 16 5.74998 16H14.25C15.7692 16 17 14.7692 17 13.25V8.25C17 6.73079 15.7692 5.5 14.25 5.5L12.1778 5.5C11.9958 5.70377 11.7732 5.87757 11.5146 6.00825L10.5412 6.49997L11.5146 6.9917C12.6237 7.55203 13.0686 8.9054 12.5083 10.0145C11.9479 11.1237 10.5946 11.5686 9.48544 11.0082L7.46461 9.98734Z" fill="currentColor" fillOpacity="0.4" />
      </g>
    </svg>
  );
}

function DictionaryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <g transform="translate(18 0) scale(-1 1)">
        <path d="M8.99999 15.051C9.16999 15.051 9.33899 15.006 9.49399 14.917C10.137 14.546 11.226 14.07 12.635 14.072C13.534 14.073 14.302 14.269 14.905 14.507C15.553 14.762 16.249 14.267 16.249 13.57V4.48701C16.249 4.13301 16.068 3.80701 15.763 3.62701C15.126 3.25101 14.037 2.76401 12.623 2.76401C10.733 2.76401 9.42499 3.63601 8.99899 3.94601" fill="currentColor" fillOpacity="0.3" />
        <path d="M8.99999 15.051C9.16999 15.051 9.33899 15.006 9.49399 14.917C10.137 14.546 11.226 14.07 12.635 14.072C13.534 14.073 14.302 14.269 14.905 14.507C15.553 14.762 16.249 14.267 16.249 13.57V4.48701C16.249 4.13301 16.068 3.80701 15.763 3.62701C15.126 3.25101 14.037 2.76401 12.623 2.76401C10.733 2.76401 9.42499 3.63601 8.99899 3.94601" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.00001 15.051C8.83001 15.051 8.66101 15.006 8.50601 14.917C7.86301 14.546 6.77401 14.07 5.36501 14.072C4.46601 14.073 3.69801 14.269 3.09501 14.507C2.44701 14.762 1.75101 14.27 1.75101 13.574C1.75101 10.981 1.75101 6.10201 1.75101 4.48401C1.75101 4.13001 1.93201 3.80801 2.23701 3.62801C2.87401 3.25201 3.96301 2.76501 5.37701 2.76501C7.26701 2.76501 8.57501 3.63701 9.00101 3.94701V15.051H9.00001Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <path
        d="M9 2L11.09 7.26L17 7.27L12.55 10.74L14.18 16L9 12.77L3.82 16L5.45 10.74L1 7.27L6.91 7.26L9 2Z"
        fill="currentColor"
        fillOpacity="0.35"
      />
      <path
        d="M9 2L11.09 7.26L17 7.27L12.55 10.74L14.18 16L9 12.77L3.82 16L5.45 10.74L1 7.27L6.91 7.26L9 2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <g transform="translate(18 0) scale(-1 1)">
        <path d="M9 14.5C12.0376 14.5 14.5 12.0376 14.5 9C14.5 5.96243 12.0376 3.5 9 3.5C5.96243 3.5 3.5 5.96243 3.5 9C3.5 12.0376 5.96243 14.5 9 14.5Z" fill="currentColor" fillOpacity="0.3" />
        <path d="M6.25 4.237L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.25 13.764L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14.5 9H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 14.5C12.0376 14.5 14.5 12.0376 14.5 9C14.5 5.96243 12.0376 3.5 9 3.5C5.96243 3.5 3.5 5.96243 3.5 9C3.5 12.0376 5.96243 14.5 9 14.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 1.75V3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.72101 5.375L4.23701 6.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M1.75 9H3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16.25 9H14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.72101 12.625L4.23701 11.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 16.25V14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.625 15.279L11.75 13.763" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.375 15.279L6.25 13.763" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15.279 12.625L13.763 11.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15.279 5.375L13.763 6.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.625 2.721L11.75 4.237" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.375 2.721L6.25 4.237" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  status: string;
  isError: boolean;
  isLoading: boolean;
}

function AssistantIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <path d="M9 2C5.686 2 3 4.686 3 8c0 1.636.654 3.12 1.715 4.203L4 15l2.797-.714C7.79 14.744 8.874 15 9 15h0c3.314 0 6-2.686 6-6s-2.686-6-6-6z" fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="6.5" cy="8.5" r="0.75" fill="currentColor"/>
      <circle cx="9" cy="8.5" r="0.75" fill="currentColor"/>
      <circle cx="11.5" cy="8.5" r="0.75" fill="currentColor"/>
    </svg>
  );
}

function IntegrationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none" {...props}>
      <path d="M7.5 2.5h3a1 1 0 0 1 1 1V5h-5V3.5a1 1 0 0 1 1-1z" fill="currentColor" fillOpacity="0.4"/>
      <rect x="2.5" y="5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M6 8.5h6M6 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { id: 'transcripts', label: 'Transcripts', icon: HomeIcon },
  { id: 'assistant', label: 'Assistant', icon: AssistantIcon },
  { id: 'integrations', label: 'Integrations', icon: IntegrationsIcon },
  { id: 'snippets', label: 'Snippets', icon: SnippetsIcon },
  { id: 'dictionary', label: 'Dictionary', icon: DictionaryIcon },
  { id: 'models', label: 'Models', icon: ModelsIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar({ activePage, onNavigate, status, isError, isLoading }: SidebarProps) {
  return (
    <div className="relative w-[220px] min-w-[220px] bg-sidebar flex flex-col [-webkit-app-region:drag] select-none">
      <div className="pt-[24px] px-5 pb-4 flex items-center gap-2.5">
        <img src={`${import.meta.env.BASE_URL}tellaflow-logo-site.svg`} alt="Tellaflow" className="h-25 w-25 object-contain" />
      </div>

      <nav className="flex-1 flex flex-col gap-1 px-3 [-webkit-app-region:no-drag]">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={cn(
              'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              activePage === item.id && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
          >
            <item.icon className="w-4 h-4" strokeWidth={1.8} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="px-3 pb-4 pt-3 [-webkit-app-region:no-drag]">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <div
            className={cn(
              'w-[7px] h-[7px] rounded-full shrink-0',
              isError ? 'bg-destructive' : isLoading ? 'bg-muted-foreground animate-pulse' : 'bg-success',
            )}
          />
          <span className="truncate">{status}</span>
        </div>
      </div>

      {/* Progressive blur on the right edge */}
      <div className="absolute top-0 right-0 w-[20px] h-full pointer-events-none" aria-hidden>
        <div className="absolute inset-0" style={{ backdropFilter: 'blur(0.5px)', mask: 'linear-gradient(to right, transparent, black)' }} />
        <div className="absolute inset-0" style={{ backdropFilter: 'blur(1px)', mask: 'linear-gradient(to right, transparent 20%, black)' }} />
        <div className="absolute inset-0" style={{ backdropFilter: 'blur(2px)', mask: 'linear-gradient(to right, transparent 40%, black)' }} />
        <div className="absolute inset-0" style={{ backdropFilter: 'blur(4px)', mask: 'linear-gradient(to right, transparent 60%, black)' }} />
        <div className="absolute inset-0" style={{ backdropFilter: 'blur(6px)', mask: 'linear-gradient(to right, transparent 80%, black)' }} />
      </div>
    </div>
  );
}
