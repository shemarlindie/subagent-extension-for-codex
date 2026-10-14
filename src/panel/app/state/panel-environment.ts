/** The browser state the controller reads, which tests replace. */
export type PanelEnvironment = {
  hidden(): boolean;
  wide(): boolean;
  /** Calls `listener` when the panel is shown or hidden; returns an unsubscribe. */
  onVisibilityChange?(listener: () => void): () => void;
};

export const browserEnvironment: PanelEnvironment = {
  hidden: () => document.hidden,
  wide: () => window.innerWidth > 640,
  onVisibilityChange(listener) {
    document.addEventListener("visibilitychange", listener);

    return () => document.removeEventListener("visibilitychange", listener);
  },
};
