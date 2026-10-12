/** Loading behavior policy, separate from CSS-mirrored motion durations. */
export const LOADING_SKELETON_CONFIG = {
  /** Skip the placeholder for requests that finish quickly. */
  delay: 200,
  /** Keep a shown skeleton fully visible this long before handing off. */
  minimumVisible: 300,
} as const;
