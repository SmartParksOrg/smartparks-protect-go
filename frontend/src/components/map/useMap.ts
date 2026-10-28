/** One MapLibre map bound to a container, after Protect's `useMap` (its decisions D137 and
 * D173): the offline PMTiles basemap in a Protomaps flavour, two empty controls the page
 * renders its strips into (the tools top right, zoom and north bottom right), the scale bottom
 * left, and `ready` once the style has loaded so layers can be added. */
import { layers, namedFlavor } from "@protomaps/basemaps";
import type {
  IControl,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import { type RefObject, useEffect, useRef, useState } from "react";

import { maplibregl } from "@/lib/maplibre";

export const FLAVOURS = [
  "light",
  "dark",
  "white",
  "grayscale",
  "black",
] as const;
export type Flavour = (typeof FLAVOURS)[number];

let protocolRegistered = false;

class StripHost implements IControl {
  readonly element = document.createElement("div");
  onAdd(): HTMLElement {
    this.element.className = "maplibregl-ctrl protect-strip";
    return this.element;
  }
  onRemove(): void {
    this.element.remove();
  }
}

/** The address a project's PMTiles file is read from. One address per project (Tim,
 * 2026-10-24: a switch between projects kept the old tiles, since MapLibre's pmtiles reader
 * caches an archive, its header and directories, by address). */
export function tilesUrl(projectId: string | null | undefined): string {
  const origin = window.location.origin;
  return projectId
    ? `pmtiles://${origin}/api/map/${encodeURIComponent(projectId)}/tiles.pmtiles`
    : `pmtiles://${origin}/api/map/tiles.pmtiles`;
}

/** The offline map's style: the project's PMTiles, the glyphs and sprites shipped with the
 * app, drawn in a Protomaps flavour. */
export function offlineStyle(
  flavour: Flavour,
  projectId: string | null | undefined = null,
): StyleSpecification {
  const origin = window.location.origin;
  const dark = flavour === "dark" || flavour === "black";
  return {
    version: 8,
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/${dark ? "dark" : "light"}`,
    sources: {
      protomaps: {
        type: "vector",
        url: tilesUrl(projectId),
        attribution:
          '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>, <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: layers("protomaps", namedFlavor(flavour), { lang: "en" }),
  };
}

/** `projectId` undefined means the project is not known yet: the map waits for it, so no
 * archive is ever read from the address of the loaded project, which another project may
 * have used before (the pmtiles reader caches by address). */
export function useMap(
  container: RefObject<HTMLDivElement | null>,
  flavour: Flavour,
  bounds: [number, number, number, number] | null,
  projectId: string | null | undefined = null,
) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  // what the map's style was built from, against what the page wants now: a project that
  // changed while the first style was still loading is applied once the map is ready (Tim,
  // 2026-10-24: a switch from another page mounted the Overview mid-switch and the map kept
  // the old project's tiles)
  const applied = useRef<{
    flavour: Flavour;
    projectId: string | null | undefined;
  }>({ flavour, projectId });
  const [stripHost, setStripHost] = useState<HTMLElement | null>(null);
  const [cornerHost, setCornerHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!container.current || mapRef.current || projectId === undefined) return;
    if (!protocolRegistered) {
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      protocolRegistered = true;
    }
    applied.current = { flavour, projectId };
    const map = new maplibregl.Map({
      container: container.current,
      style: offlineStyle(flavour, projectId),
      ...(bounds
        ? { bounds, fitBoundsOptions: { padding: 24 } }
        : { center: [0, 0] as [number, number], zoom: 1 }),
      attributionControl: { compact: true },
    });
    const strip = new StripHost();
    map.addControl(strip, "top-right");
    setStripHost(strip.element);
    const corner = new StripHost();
    map.addControl(corner, "bottom-right");
    setCornerHost(corner.element);
    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-left",
    );
    map.on("load", () => {
      map
        .getContainer()
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
      setStripHost(null);
      setCornerHost(null);
    };
    // the map is created once the project is known; a new flavour or project goes through
    // setStyle below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, projectId === undefined]);

  // a style that must still be applied, once the pages have let go of the old one
  const pending = useRef<{
    flavour: Flavour;
    projectId: string | null | undefined;
  } | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || projectId === undefined) return;
    if (
      applied.current.flavour === flavour &&
      applied.current.projectId === projectId
    )
      return;
    if (ready) {
      // the pages add their layers in effects that run in this same commit as soon as
      // `ready` is true; a style replaced here and now would be loading again under them
      // ("Style is not done loading", the Data explorer opened straight on its map while
      // the project id arrived during the first load, 2026-10-28). So this commit only
      // turns `ready` off, the pages tear their layers down, and the next one restyles.
      pending.current = { flavour, projectId };
      setReady(false);
      return;
    }
    const wanted = pending.current;
    if (!wanted) return; // a style is loading already; its `style.load` brings `ready` back
    pending.current = null;
    applied.current = wanted;
    // a whole reload, never a diff: MapLibre applies a diff without firing `style.load`, so
    // `ready` stayed false and the stations, tracks and tiles were never drawn again after
    // a switch between projects (Tim, 2026-10-24); a reload also drops the old archive
    map.setStyle(offlineStyle(wanted.flavour, wanted.projectId), {
      diff: false,
    });
    map.once("style.load", () => setReady(true));
  }, [flavour, projectId, ready]);

  return { mapRef, ready, stripHost, cornerHost };
}
