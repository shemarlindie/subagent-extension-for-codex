/**
 * Shares one in-flight request among concurrent callers; a call after it
 * settles starts a new one.
 */
export function sharedRequest<T>(request: () => Promise<T>) {
  let pending: Promise<T> | undefined;

  return () => {
    if (pending) return pending;
    const current = request();
    pending = current;

    const settle = () => {
      if (pending === current) pending = undefined;
    };

    void current.then(settle, settle);

    return current;
  };
}
