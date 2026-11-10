// A completed request may update the view only while it is still the latest.
export function latestRequest() {
  let version = 0;
  return {
    start() {
      const requestVersion = ++version;
      return () => requestVersion === version;
    },
    invalidate() {
      version++;
    },
  };
}
