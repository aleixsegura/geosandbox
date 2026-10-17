// Minimal stroke icons drawn like pencil marks (1.5px, round caps).
import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {children}
    </svg>
  );
}

export const PlayIcon = () => <Icon><path d="M6 4.5v11l9-5.5z" /></Icon>;
export const PlayAllIcon = () => <Icon><path d="M3.5 4.5v11l7-5.5zM10.5 4.5v11l7-5.5z" /></Icon>;
export const SelectionIcon = () => <Icon><path d="M4 5h8M4 9h12M4 13h6" /><path d="M13 12.5v5l4-2.5z" /></Icon>;
export const StopIcon = () => <Icon><rect x="5" y="5" width="10" height="10" rx="1.5" /></Icon>;
export const RestartIcon = () => <Icon><path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9" /><path d="M15.5 3.5v3.2h-3.2" /></Icon>;
export const FitIcon = () => <Icon><path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" /></Icon>;
export const GhostIcon = () => <Icon strokeDasharray="2.2 2"><path d="M4.5 16V9a5.5 5.5 0 0 1 11 0v7l-2-1.5-1.8 1.5-1.7-1.5-1.8 1.5-1.7-1.5z" /></Icon>;
export const CentroidIcon = () => <Icon><path d="M4 6l6-3 6 4-2 9H5z" /><circle cx="10" cy="9.5" r="1.4" fill="currentColor" /></Icon>;
export const BboxIcon = () => <Icon strokeDasharray="2.2 2"><rect x="3.5" y="4.5" width="13" height="11" rx="0.5" /></Icon>;
export const NumbersIcon = () => <Icon><path d="M4 15l3-9 4 6 5-7" /><text x="2" y="19" fontSize="5" stroke="none" fill="currentColor">1</text><text x="14" y="7" fontSize="5" stroke="none" fill="currentColor">3</text></Icon>;
export const PaperIcon = () => <Icon><path d="M3.5 3.5h13v13h-13zM3.5 8h13M3.5 12.5h13M8 3.5v13M12.5 3.5v13" strokeWidth={1.1} /></Icon>;
export const MapIcon = () => <Icon><path d="M3 5.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2z" /><path d="M7.5 3.5v11M12.5 5.5v11" /></Icon>;
export const AutoIcon = () => <Icon><path d="M4 15l3.5-10h1L12 15M5.3 11.5h5.4" /><path d="M14 6.5h3M15.5 5v3" /></Icon>;
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: "transform 200ms" }}><path d="M8 5l5 5-5 5" /></Icon>
);
export const CopyIcon = () => <Icon><rect x="7" y="7" width="9" height="9" rx="1.5" /><path d="M13 7V4.5A1 1 0 0 0 12 3.5H4.5a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1H7" /></Icon>;
export const TrashIcon = () => <Icon><path d="M4.5 6h11M8 6V4h4v2M6 6l.7 10h6.6L14 6" /></Icon>;
export const CubeIcon = () => <Icon><path d="M10 3l6 3.5v7L10 17l-6-3.5v-7z" /><path d="M4 6.5l6 3.5 6-3.5M10 10v7" /></Icon>;
export const PauseIcon = () => <Icon><path d="M7 5v10M13 5v10" /></Icon>;
export const HelpIcon = () => <Icon><circle cx="10" cy="10" r="7" /><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5" /><circle cx="10" cy="14" r=".6" fill="currentColor" /></Icon>;
