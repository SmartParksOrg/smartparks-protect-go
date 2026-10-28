import { useQuery } from "@tanstack/react-query";
import {
  Compass,
  Focus,
  Layers,
  Maximize,
  Minimize,
  Minus,
  Plus,
} from "lucide-react";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { api, type MapState } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { ControlStrip } from "@/components/map/ControlStrip";
import {
  bindStationClicks,
  bindTrackPointClicks,
  ensureStationLayers,
  ensureTrackLayers,
  setStations,
  setTracks,
  type StationMarker,
  type TrackLayer,
  trackPointKey,
} from "@/components/map/trackLayers";
import { type Flavour, useMap } from "@/components/map/useMap";
import { useTheme } from "@/hooks/useTheme";
import { formatInZone } from "@/lib/analytics";
import { boundsOfTracks, pointsAt } from "@/lib/explore";

/**
 * The map of the Data explorer, Protect's Explore map (its decision D153) on the offline
 * tiles: the tracks of the selection over the period with the offload stations, Protect's
 * control strips (zoom, north, fit and full screen bottom right; Layers top left with the
 * trackers to show or hide), a time slider on the scale's line that moves the marked moment
 * along the tracks, and the point of every track at that moment ringed. The base map follows
 * the theme (Tim, 2026-10-17: a selector for it did not help). Hovering a track point marks its
 * moment in the other views; a click pins it.
 */
export function ExploreMap({
  tracks,
  stations,
  window,
  timezone,
  marked,
  fitKey,
  hidden,
  onHidden,
  hiddenStations,
  onHiddenStations,
  onHover,
  onPick,
}: {
  tracks: TrackLayer[];
  stations: StationMarker[];
  window: { from: number; to: number };
  timezone: string;
  marked: number | null;
  /** Changes when the selection changes: the map fits the tracks again. */
  fitKey: string;
  /** The trackers hidden on the map (the Layers panel). */
  hidden: string[];
  onHidden: (ids: string[]) => void;
  /** The stations hidden on the map, the second list of the Layers panel (Tim, 2026-10-28). */
  hiddenStations: string[];
  onHiddenStations: (ids: string[]) => void;
  onHover: (ms: number | null) => void;
  onPick: (ms: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { resolved } = useTheme();
  const flavour: Flavour = resolved === "dark" ? "dark" : "light";
  const container = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const initialBounds = useMemo(() => {
    const b = boundsOfTracks(tracks);
    return b
      ? ([b[0][0], b[0][1], b[1][0], b[1][1]] as [
          number,
          number,
          number,
          number,
        ])
      : null;
    // the first fit alone; later fits follow fitKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // the loaded project's map, at its own address (a switch rebuilds the style)
  const mapState = useQuery({
    queryKey: queryKeys.map,
    queryFn: () => api<MapState>("/api/map"),
  });
  const { mapRef, ready, cornerHost } = useMap(
    container,
    flavour,
    initialBounds,
    mapState.data ? mapState.data.project_id : undefined,
  );
  const handlers = useRef({ onHover, onPick });
  useEffect(() => {
    handlers.current = { onHover, onPick };
  }, [onHover, onPick]);
  const shownStations = useMemo(
    () => stations.filter((s) => !hiddenStations.includes(s.device_id)),
    [stations, hiddenStations],
  );
  const stationsRef = useRef(shownStations);
  useEffect(() => {
    stationsRef.current = shownStations;
  }, [shownStations]);
  const shownTracks = useMemo(
    () => tracks.filter((tr) => !hidden.includes(tr.ownerId)),
    [tracks, hidden],
  );

  useEffect(() => {
    const map = mapRef.current;
    const element = container.current;
    if (!map || !ready || !element) return;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(element);
    ensureTrackLayers(map);
    // the station marker is an image drawn first; the stations land once the layer stands,
    // and a click on one opens the station's page
    let unbindStations = () => undefined as void;
    void ensureStationLayers(map).then(() => {
      setStations(map, stationsRef.current);
      unbindStations = bindStationClicks(
        map,
        (id) => void navigate(`/stations/${id}`),
      );
    });
    const unbind = bindTrackPointClicks(map, (props) =>
      handlers.current.onPick(Date.parse(props.time)),
    );
    const onMove = (e: MapLayerMouseEvent) => {
      const time = e.features?.[0]?.properties?.time;
      if (typeof time === "string") handlers.current.onHover(Date.parse(time));
    };
    const onLeave = () => handlers.current.onHover(null);
    map.on("mousemove", "track-points", onMove);
    map.on("mouseleave", "track-points", onLeave);
    return () => {
      observer.disconnect();
      unbind();
      unbindStations();
      map.off("mousemove", "track-points", onMove);
      map.off("mouseleave", "track-points", onLeave);
    };
  }, [mapRef, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setStations(map, shownStations);
  }, [mapRef, ready, shownStations]);

  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setTracks(map, shownTracks);
    const bounds = boundsOfTracks(shownTracks);
    if (bounds && fitted.current !== fitKey) {
      fitted.current = fitKey;
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    }
  }, [mapRef, ready, shownTracks, fitKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("track-point-selected")) return;
    const keys =
      marked === null
        ? []
        : pointsAt(shownTracks, marked).map((p) =>
            trackPointKey(p.ownerId, p.time),
          );
    map.setFilter("track-point-selected", [
      "in",
      ["get", "key"],
      ["literal", keys],
    ]);
  }, [mapRef, ready, shownTracks, marked]);

  // full screen through the browser's API on the map's frame, as Protect's result map does
  // (Tim, 2026-10-17: the fit button's icon read as full screen, and there was none); the map
  // follows the size
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => {
      setFullscreen(globalThis.document.fullscreenElement === frame.current);
      setTimeout(() => mapRef.current?.resize(), 50);
    };
    globalThis.document.addEventListener("fullscreenchange", onChange);
    return () =>
      globalThis.document.removeEventListener("fullscreenchange", onChange);
  }, [mapRef]);
  const toggleFullscreen = () => {
    if (globalThis.document.fullscreenElement)
      void globalThis.document.exitFullscreen();
    else void frame.current?.requestFullscreen?.();
  };
  const [layersOpen, setLayersOpen] = useState(false);
  const [sliding, setSliding] = useState<number | null>(null);
  const value = sliding ?? marked ?? window.to;
  const fit = () => {
    const map = mapRef.current;
    const bounds = boundsOfTracks(shownTracks);
    if (map && bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
  };
  const corner = cornerHost
    ? createPortal(
        <ControlStrip
          label={t("Zoom and north")}
          items={[
            {
              key: "in",
              icon: Plus,
              label: t("Zoom in"),
              onClick: () => mapRef.current?.zoomIn(),
            },
            {
              key: "out",
              icon: Minus,
              label: t("Zoom out"),
              onClick: () => mapRef.current?.zoomOut(),
            },
            {
              key: "north",
              icon: Compass,
              label: t("North up"),
              onClick: () => mapRef.current?.resetNorthPitch(),
            },
            {
              key: "fit",
              icon: Focus,
              label: t("Fit the tracks"),
              disabled: shownTracks.length === 0,
              onClick: fit,
            },
            {
              key: "fullscreen",
              icon: fullscreen ? Minimize : Maximize,
              label: fullscreen ? t("Leave full screen") : t("Full screen"),
              active: fullscreen,
              onClick: toggleFullscreen,
            },
          ]}
        />,
        cornerHost,
      )
    : null;

  return (
    <div ref={frame} className="absolute inset-0 bg-background">
      <div ref={container} className="absolute! inset-0 z-0" />
      {corner}
      {/* Layers top left, as on Protect's map (its decision D174): the trackers and the stations, each a list with a box per row (Tim, 2026-10-28) */}
      <div className="absolute top-3 left-3 z-10 flex items-start gap-2">
        <ControlStrip
          label={t("Layers")}
          items={[
            {
              key: "layers",
              icon: Layers,
              label: t("Layers"),
              active: layersOpen,
              emphasis: true,
              badge: shownTracks.length,
              onClick: () => setLayersOpen((o) => !o),
            },
          ]}
        />
        {layersOpen && (
          <div
            className="w-64 rounded-md border bg-card/95 p-3 text-sm shadow"
            role="dialog"
            aria-label={t("Layers")}
          >
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t("Trackers")}
            </p>
            <ul className="flex flex-col gap-1">
              {tracks.map((tr) => {
                const on = !hidden.includes(tr.ownerId);
                return (
                  <li key={tr.ownerId}>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={on}
                        onChange={() =>
                          onHidden(
                            on
                              ? [...hidden, tr.ownerId]
                              : hidden.filter((id) => id !== tr.ownerId),
                          )
                        }
                      />
                      <span
                        className="inline-block size-2.5 rounded-full"
                        style={{ background: tr.color }}
                      />
                      <Link
                        className="truncate underline-offset-4 hover:underline"
                        to={`/trackers/${tr.ownerId}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {tr.name}
                      </Link>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {tr.times.length}
                      </span>
                    </label>
                  </li>
                );
              })}
              {tracks.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  {t("No positions in this period.")}
                </li>
              )}
            </ul>
            <div className="mt-2 flex gap-2 text-xs">
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => onHidden([])}
              >
                {t("Show all")}
              </button>
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => onHidden(tracks.map((tr) => tr.ownerId))}
              >
                {t("Hide all")}
              </button>
            </div>
            <p className="mt-3 mb-1 text-xs font-medium text-muted-foreground">
              {t("Stations")}
            </p>
            <ul className="flex flex-col gap-1">
              {stations.map((s) => {
                const on = !hiddenStations.includes(s.device_id);
                return (
                  <li key={s.device_id}>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={on}
                        onChange={() =>
                          onHiddenStations(
                            on
                              ? [...hiddenStations, s.device_id]
                              : hiddenStations.filter(
                                  (id) => id !== s.device_id,
                                ),
                          )
                        }
                      />
                      <span className="inline-block size-2.5 rounded-sm border border-primary bg-card" />
                      <Link
                        className="truncate underline-offset-4 hover:underline"
                        to={`/stations/${s.device_id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {s.name}
                      </Link>
                    </label>
                  </li>
                );
              })}
              {stations.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  {t("No station has a place yet.")}
                </li>
              )}
            </ul>
            {stations.length > 0 && (
              <div className="mt-2 flex gap-2 text-xs">
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => onHiddenStations([])}
                >
                  {t("Show all")}
                </button>
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() =>
                    onHiddenStations(stations.map((s) => s.device_id))
                  }
                >
                  {t("Hide all")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {/* the time slider (Protect's decision D153) on the scale's line, between the scale at the
          left and the control strip at the right, so it covers nothing (Tim, 2026-10-17): its
          moment is the marked one, released it pins */}
      {Number.isFinite(window.from) &&
        Number.isFinite(window.to) &&
        window.to > window.from && (
          <div className="absolute right-14 bottom-2 left-[7.25rem] z-10 flex h-8 items-center gap-3 rounded-md border bg-card/95 px-3 text-xs shadow">
            <span className="hidden whitespace-nowrap text-muted-foreground sm:inline">
              {formatInZone(new Date(window.from).toISOString(), timezone)}
            </span>
            <input
              type="range"
              aria-label={t("Moment on the tracks")}
              className="min-w-0 flex-1 accent-primary"
              min={window.from}
              max={window.to}
              step={60_000}
              value={Math.min(window.to, Math.max(window.from, value))}
              onChange={(e) => {
                const ms = Number(e.target.value);
                setSliding(ms);
                onHover(ms);
              }}
              onPointerUp={() => {
                if (sliding !== null) onPick(sliding);
                setSliding(null);
              }}
              onKeyUp={() => {
                if (sliding !== null) onPick(sliding);
                setSliding(null);
              }}
            />
            <span className="whitespace-nowrap font-medium">
              {formatInZone(new Date(value).toISOString(), timezone)}
            </span>
          </div>
        )}
      {tracks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-md border bg-card/95 px-3 py-1.5 text-sm text-muted-foreground shadow">
            {t("No positions in this period.")}
          </span>
        </div>
      )}
    </div>
  );
}
