import "./theme-scope.css";

import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type OvermuxScheme = "dark" | "light" | "system";
export type OvermuxContrast = "auto" | "high" | "normal";

export const overmuxThemeTokens = [
  "--om-color-accent",
  "--om-color-accent-fg",
  "--om-color-border",
  "--om-color-canvas",
  "--om-color-danger",
  "--om-color-fg",
  "--om-color-muted",
  "--om-color-panel",
  "--om-color-success",
  "--om-color-surface",
  "--om-elevation",
  "--om-focus-ring",
  "--om-font-mono",
  "--om-font-sans",
  "--om-motion-duration",
  "--om-radius",
  "--om-spacing",
] as const;

export type OvermuxThemeToken = (typeof overmuxThemeTokens)[number];

export type OvermuxStyle = CSSProperties &
  Partial<Record<OvermuxThemeToken, number | string>>;

export type OvermuxExternalPortalContainer = {
  container: HTMLElement;
  scopeAttributesAndVariables: "caller-owned";
};

export type OvermuxPortalProps = {
  children: ReactNode;
  external?: OvermuxExternalPortalContainer;
};

export type OvermuxThemeScopeProps = {
  children: ReactNode;
  className?: string;
  contrast?: OvermuxContrast;
  scheme?: OvermuxScheme;
  style?: OvermuxStyle;
};

const PortalRootContext = createContext<HTMLElement | null | undefined>(
  undefined,
);

export const useOvermuxPortalContainer = (
  external?: OvermuxExternalPortalContainer,
) => {
  const scopeRoot = useContext(PortalRootContext);
  if (external) {
    return external.container;
  }
  if (scopeRoot !== undefined) {
    return scopeRoot;
  }
  return typeof document === "undefined" ? null : document.body;
};

export const OvermuxPortal = ({ children, external }: OvermuxPortalProps) => {
  const container = useOvermuxPortalContainer(external);
  return container ? createPortal(children, container) : null;
};

export const OvermuxThemeScope = ({
  children,
  className,
  contrast = "auto",
  scheme = "system",
  style,
}: OvermuxThemeScopeProps) => {
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const capturePortalRoot = useCallback((element: HTMLDivElement | null) => {
    setPortalRoot(element);
  }, []);

  return (
    <div
      className={className}
      data-om-contrast={contrast}
      data-om-scheme={scheme}
      data-om-scope=""
      style={style}
    >
      <PortalRootContext.Provider value={portalRoot}>
        {children}
      </PortalRootContext.Provider>
      <div data-om-overlay-root="" ref={capturePortalRoot} />
    </div>
  );
};
