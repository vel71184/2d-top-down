/** Resolves a path inside /public (e.g. "assets/maps/town.tmj") to a full URL. */
export function assetUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, document.baseURI).href;
}

export async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return (await res.json()) as T;
}

const images = new Map<string, Promise<HTMLImageElement>>();

/** Loads an image once; later calls with the same URL share the result. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image ${url}`));
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}
