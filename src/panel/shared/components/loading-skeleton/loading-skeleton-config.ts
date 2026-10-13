/**
 * Loading behavior policy, separate from CSS-mirrored motion durations. Typed
 * as plain numbers because callers also handle a zero delay.
 */
export const LOADING_SKELETON_CONFIG: {
  readonly delay: number;
  readonly minimumVisible: number;
} = {
  /** Skip the placeholder for requests that finish quickly. */
  delay: 200,
  /** Keep a shown skeleton fully visible this long before handing off. */
  minimumVisible: 300,
};
