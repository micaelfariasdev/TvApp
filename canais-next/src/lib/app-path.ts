export function appPath(path: string) {
  return `/cinedark${path.startsWith("/") ? path : `/${path}`}`;
}
