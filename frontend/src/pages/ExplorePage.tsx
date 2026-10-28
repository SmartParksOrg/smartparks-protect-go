import { useQuery } from "@tanstack/react-query";
import {
  ChartLine,
  ChevronDown,
  ChevronUp,
  Download,
  Map as MapIcon,
  Table2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { api, type MetricDefinition, type Tracker } from "@/api/client";
import { queryKeys } from "@/api/queryKeys";
import { MultiSelect } from "@/components/analytics/MultiSelect";
import { EmptyState } from "@/components/common/EmptyState";
import { Drawer } from "@/components/explore/Drawer";
import { drawerSpace } from "@/components/explore/drawerSpace";
import { ExploreChart } from "@/components/explore/ExploreChart";
import { ExportDialog } from "@/components/explore/ExportDialog";
import { ExploreMap } from "@/components/explore/ExploreMap";
import {
  colourTrackers,
  type StationMarker,
} from "@/components/map/trackLayers";
import { VirtualTable } from "@/components/records/VirtualTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsPhone } from "@/hooks/useMediaQuery";
import { usePreference } from "@/hooks/usePreference";
import {
  browserTimezone,
  CHART_TYPES,
  type ChartType,
  formatInZone,
  RANGE_PRESETS,
} from "@/lib/analytics";
import {
  chartableColumns,
  chartGroups,
  type ExploreMode,
  type ExploreState,
  MAX_METRICS,
  nearestRowTime,
  readExploreState,
  tracksOf,
  windowFor,
  writeExploreState,
} from "@/lib/explore";
import { t as mark } from "@/lib/i18nMark";
import {
  columnsOf,
  DEFAULT_SORT,
  filterRows,
  type RecordRow,
  type RecordSort,
  sortRows,
  withChosenMetrics,
} from "@/lib/records";

const CHART_LABELS: Record<ChartType, string> = {
  line: mark("Line"),
  bar: mark("Bar"),
  state: mark("State timeline"),
};

interface Station {
  device_id: string;
  name: string;
  station_eui: string;
  lat: number | null;
  lon: number | null;
}

interface OfferedMetric {
  key: string;
  count: number;
}

/**
 * The Data explorer as one canvas (decision D25), Protect's Explore page (its decisions D150
 * to D155) in small: one selection of trackers over a period, looked at as a table, a chart
 * or a map, with the same strip, tabs, drawer, chart and map controls. The rows come from the
 * files read on this laptop, merged per tracker and moment. One marked moment links the views:
 * a hover is transient, a click pins it into the address. Every metric the selection reported
 * is on by default; the strip narrows them.
 */
export function ExplorePage() {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const timezone = useMemo(() => browserTimezone(), []);
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => readExploreState(params), [params]);
  const update = useCallback(
    (patch: Partial<ExploreState>, replace = false) =>
      setParams(writeExploreState({ ...readExploreState(params), ...patch }), {
        replace,
      }),
    [params, setParams],
  );

  const trackers = useQuery({
    queryKey: queryKeys.trackers,
    queryFn: () => api<Tracker[]>("/api/trackers"),
  });
  const definitions = useQuery({
    queryKey: queryKeys.metricDefinitions,
    queryFn: () => api<MetricDefinition[]>("/api/bundle/metrics"),
  });
  const stationsQuery = useQuery({
    queryKey: queryKeys.stations,
    queryFn: () => api<Station[]>("/api/bundle/stations"),
  });
  const all = useMemo(() => trackers.data ?? [], [trackers.data]);
  // every tracker until some are chosen
  const selected = useMemo(
    () =>
      state.trackers.length
        ? state.trackers.filter((id) => all.some((tr) => tr.device_id === id))
        : all.map((tr) => tr.device_id),
    [state.trackers, all],
  );
  const colours = useMemo(
    () => colourTrackers(all.map((tr) => tr.device_id)),
    [all],
  );
  const latest = useMemo(() => {
    const times = all
      .filter((tr) => selected.includes(tr.device_id))
      .map((tr) => tr.last_time)
      .filter((v): v is string => v !== null);
    return times.length ? times.sort().at(-1)! : null;
  }, [all, selected]);
  const window = useMemo(() => windowFor(state, latest), [state, latest]);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const id of selected) q.append("device_id", id);
    if (window.from) q.set("since", window.from);
    if (window.to) q.set("until", window.to);
    return q.toString();
  }, [selected, window]);
  const records = useQuery({
    queryKey: queryKeys.records(query),
    queryFn: () => api<RecordRow[]>(`/api/records?${query}`),
    enabled: selected.length > 0,
    placeholderData: (previous) => previous,
  });
  const offered = useQuery({
    queryKey: queryKeys.offeredMetrics(query),
    queryFn: () => api<OfferedMetric[]>(`/api/records/metrics?${query}`),
    enabled: selected.length > 0,
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(() => records.data ?? [], [records.data]);
  const defined = useMemo(
    () => new Map((definitions.data ?? []).map((d) => [d.key, d])),
    [definitions.data],
  );
  const offeredKeys = useMemo(
    () => (offered.data ?? []).map((m) => m.key),
    [offered.data],
  );
  // the chosen metrics: the address's, else everything reported, up to the bound
  const chosen = useMemo(
    () =>
      state.metrics === null
        ? offeredKeys.slice(0, MAX_METRICS)
        : state.metrics.filter((m) => offeredKeys.includes(m)),
    [state.metrics, offeredKeys],
  );
  const columns = useMemo(
    () => withChosenMetrics(columnsOf(rows, defined), chosen),
    [rows, defined, chosen],
  );
  const [sort, setSort] = useState<RecordSort>(DEFAULT_SORT);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const tableRows = useMemo(
    () => sortRows(filterRows(rows, columns, filters), columns, sort),
    [rows, columns, filters, sort],
  );
  const filtering = Object.values(filters).some((v) => v.trim() !== "");

  // the marked moment: a hover is transient, a click pins it into the address
  const [hovered, setHovered] = useState<{
    ms: number;
    source: "chart" | "map" | "table";
  } | null>(null);
  const hover = hovered?.ms ?? null;
  const pinned = state.at ? Date.parse(state.at) : null;
  const marked = hover ?? pinned;
  const markedRowTime = useMemo(
    () => (marked === null ? null : nearestRowTime(rows, marked)),
    [rows, marked],
  );
  const pick = useCallback(
    (ms: number) => update({ at: new Date(ms).toISOString() }, true),
    [update],
  );
  const onHover = useCallback(
    (ms: number | null) =>
      setHovered(
        ms === null
          ? null
          : { ms, source: state.mode === "map" ? "map" : "chart" },
      ),
    [state.mode],
  );

  const metricsOnChart = useMemo(
    () =>
      chosen.filter((m) =>
        chartableColumns(columns).some((c) => c.key === `m:${m}`),
      ),
    [chosen, columns],
  );
  const groups = useMemo(
    () => chartGroups(rows, metricsOnChart, columns),
    [rows, metricsOnChart, columns],
  );
  const tracks = useMemo(() => tracksOf(rows, colours), [rows, colours]);
  const stations = useMemo<StationMarker[]>(
    () =>
      (stationsQuery.data ?? [])
        .filter(
          (s): s is Station & { lat: number; lon: number } =>
            s.lat !== null && s.lon !== null,
        )
        .map((s) => ({
          device_id: s.device_id,
          name: s.name,
          lat: s.lat,
          lon: s.lon,
        })),
    [stationsQuery.data],
  );
  const [hiddenTracks, setHiddenTracks] = useState<string[]>([]);
  const [hiddenStations, setHiddenStations] = useState<string[]>([]);
  const span = useMemo(() => {
    const times = rows.map((r) => Date.parse(r.time));
    return times.length
      ? { from: Math.min(...times), to: Math.max(...times) }
      : { from: NaN, to: NaN };
  }, [rows]);

  const [drawerHeight, setDrawerHeight] = usePreference<number>(
    "explore_drawer_height",
    280,
  );
  const [drawerOpen, setDrawerOpen] = usePreference<boolean>(
    "explore_drawer_open",
    true,
  );
  const [stripChoice, setStripChoice] = useState<boolean | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const stripOpen = stripChoice ?? !phone;
  const names = useMemo(
    () => new Map(all.map((tr) => [tr.device_id, tr.device_name])),
    [all],
  );
  const summary = useMemo(() => {
    const picked = selected.map((id) => names.get(id) ?? id.slice(0, 8));
    const who =
      picked.length === 0
        ? t("Nothing selected")
        : state.trackers.length === 0
          ? t("All trackers")
          : picked.length <= 2
            ? picked.join(", ")
            : `${picked.slice(0, 2).join(", ")} +${picked.length - 2}`;
    const period =
      state.range === "custom"
        ? t("Custom range")
        : t(RANGE_PRESETS[state.range].label);
    const what =
      chosen.length === 0
        ? t("positions only")
        : t("{{count}} metrics", { count: chosen.length });
    return `${who} · ${period} · ${what}`;
  }, [selected, names, state.trackers.length, state.range, chosen.length, t]);

  const progress = (
    <>
      <span className="truncate text-muted-foreground">
        {records.isPending && selected.length > 0
          ? t("Loading…")
          : t("{{count}} records", { count: rows.length })}
      </span>
      {markedRowTime && (
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          {formatInZone(markedRowTime, timezone)}
          {state.at && hover === null ? ` · ${t("pinned")}` : ""}
        </span>
      )}
    </>
  );
  const table = (
    <div className="flex h-full flex-col gap-1">
      {filtering && (
        <div className="shrink-0 text-xs text-muted-foreground">
          {t("{{shown}} of {{loaded}} loaded rows match the filters.", {
            shown: tableRows.length,
            loaded: rows.length,
          })}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setFilters({})}
          >
            {t("Clear the filters")}
          </button>
        </div>
      )}
      <VirtualTable
        rows={tableRows}
        columns={columns}
        timezone={timezone}
        sort={sort}
        onSort={setSort}
        filters={filters}
        onFilter={(key, text) => setFilters((f) => ({ ...f, [key]: text }))}
        height="100%"
        highlightTime={markedRowTime}
        follow={hovered?.source !== "table"}
        onRowHover={(row) =>
          setHovered(row ? { ms: Date.parse(row.time), source: "table" } : null)
        }
        onRowClick={(row) => pick(Date.parse(row.time))}
      />
    </div>
  );
  const metricOptions = useMemo(
    () =>
      (offered.data ?? []).map((m) => ({
        value: m.key,
        label: defined.get(m.key)?.label ?? m.key,
        hint: m.count.toLocaleString(),
        group: defined.get(m.key)?.category,
      })),
    [offered.data, defined],
  );
  const nothingYet = trackers.data !== undefined && all.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b bg-card px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-expanded={stripOpen}
            aria-label={
              stripOpen ? t("Fold the selection") : t("Unfold the selection")
            }
            onClick={() => setStripChoice(!stripOpen)}
          >
            {stripOpen ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </Button>
          {!stripOpen && (
            <button
              type="button"
              className="min-w-0 truncate text-left"
              title={summary}
              onClick={() => setStripChoice(true)}
            >
              {summary}
            </button>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setExportOpen(true)}
              disabled={rows.length === 0}
              aria-label={t("Export")}
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">{t("Export")}</span>
            </Button>
            <Tabs
              value={state.mode}
              onValueChange={(v) => update({ mode: v as ExploreMode })}
            >
              <TabsList className="h-8">
                <TabsTrigger value="table" className="h-7 gap-1 px-2">
                  <Table2 className="size-4" />
                  <span className="hidden sm:inline">{t("Table")}</span>
                </TabsTrigger>
                <TabsTrigger value="chart" className="h-7 gap-1 px-2">
                  <ChartLine className="size-4" />
                  <span className="hidden sm:inline">{t("Chart")}</span>
                </TabsTrigger>
                <TabsTrigger value="map" className="h-7 gap-1 px-2">
                  <MapIcon className="size-4" />
                  <span className="hidden sm:inline">{t("Map")}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        {stripOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MultiSelect
              options={all.map((tr) => ({
                value: tr.device_id,
                label: tr.device_name,
              }))}
              value={state.trackers}
              onChange={(v) => update({ trackers: v, at: null })}
              placeholder={t("All trackers")}
              label={t("trackers")}
              className="h-8 w-44"
              maxSelected={500}
            />
            <Select
              value={state.range}
              onValueChange={(v) =>
                update({ range: v as ExploreState["range"], at: null })
              }
            >
              <SelectTrigger className="h-8 w-44" aria-label={t("Period")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(RANGE_PRESETS).map(([k, p]) => (
                  <SelectItem key={k} value={k}>
                    {t(p.label)}
                  </SelectItem>
                ))}
                <SelectItem value="custom">{t("Custom range")}</SelectItem>
              </SelectContent>
            </Select>
            {state.range === "custom" && (
              <>
                <Input
                  type="datetime-local"
                  aria-label={t("From")}
                  className="h-8 w-48"
                  value={state.from ? state.from.slice(0, 16) : ""}
                  onChange={(e) =>
                    update({
                      from: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                />
                <Input
                  type="datetime-local"
                  aria-label={t("To")}
                  className="h-8 w-48"
                  value={state.to ? state.to.slice(0, 16) : ""}
                  onChange={(e) =>
                    update({
                      to: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                />
              </>
            )}
            {selected.length > 0 && (
              <MultiSelect
                options={metricOptions}
                value={chosen}
                onChange={(next) => update({ metrics: next })}
                placeholder={
                  offered.isPending
                    ? t("Reading the metrics…")
                    : offered.data?.length === 0
                      ? t("No metrics in the period")
                      : t("Metrics")
                }
                label={t("metrics")}
                className="h-8 w-44"
                maxSelected={MAX_METRICS}
              />
            )}
            {state.mode === "chart" && (
              <Select
                value={state.chart}
                onValueChange={(v) => update({ chart: v as ChartType })}
              >
                <SelectTrigger
                  className="h-8 w-36"
                  aria-label={t("Chart kind")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHART_TYPES.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(CHART_LABELS[k])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {nothingYet ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <EmptyState
              icon={ChartLine}
              title={t("No data on this laptop yet")}
              description={t(
                "Read SD card files first; every record they carry follows here as a table, on a chart, or on the map.",
              )}
              action={
                <Button asChild size="sm">
                  <Link to="/files">{t("Files")}</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {state.mode === "table" && (
              <div className="absolute inset-0 flex flex-col gap-2 p-2">
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  {progress}
                </div>
                <div className="relative min-h-0 flex-1">{table}</div>
              </div>
            )}
            {state.mode !== "table" && (
              <div
                className="absolute inset-x-0 top-0"
                style={{ bottom: drawerSpace(drawerOpen, drawerHeight, phone) }}
              >
                {state.mode === "chart" &&
                  (groups.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                      <EmptyState
                        icon={ChartLine}
                        title={
                          records.isPending
                            ? t("Loading…")
                            : t("Nothing to chart yet")
                        }
                        description={
                          metricsOnChart.length === 0
                            ? t(
                                "The selection reported no numeric measurements in this period; the positions draw on the map.",
                              )
                            : t(
                                "The loaded rows carry none of the chosen metrics yet.",
                              )
                        }
                      />
                    </div>
                  ) : (
                    <ExploreChart
                      groups={groups}
                      kind={state.chart}
                      phone={phone}
                      timezone={timezone}
                      marked={hover === null ? null : marked}
                      pinned={pinned}
                      onHover={onHover}
                      onPick={pick}
                      colours={colours}
                    />
                  ))}
                {state.mode === "map" && (
                  <ExploreMap
                    tracks={tracks}
                    stations={stations}
                    window={span}
                    timezone={timezone}
                    marked={marked}
                    fitKey={query}
                    hidden={hiddenTracks}
                    onHidden={setHiddenTracks}
                    hiddenStations={hiddenStations}
                    onHiddenStations={setHiddenStations}
                    onHover={onHover}
                    onPick={pick}
                  />
                )}
              </div>
            )}
            {state.mode !== "table" && (
              <Drawer
                height={drawerHeight}
                onHeight={setDrawerHeight}
                open={drawerOpen}
                onOpen={setDrawerOpen}
                phone={phone}
                bar={progress}
              >
                <div className="absolute inset-0 p-2">{table}</div>
              </Drawer>
            )}
          </>
        )}
      </div>
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        selection={{
          trackers: selected,
          from: window.from,
          to: window.to,
          metrics: chosen,
          summary,
          rows: rows.length,
        }}
      />
    </div>
  );
}
