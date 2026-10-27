// `google.maps` is an ambient namespace (@types/google.maps): TypeScript loads no @types package by
// itself here, so this island names the one it reads.
/// <reference types="google.maps" />

import { useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  ColorScheme,
  Map as GoogleMap,
  Marker,
  Polyline,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { routeColorToken, rgbaToHex } from "@/lib/commute/colors";
import type { CommuteRow } from "@/lib/commute/outcome";

/** Which column of the table the map draws. */
export type CommuteMapMode = "transit" | "drive";

interface Props {
  /** The browser key (`commuteMapKey()`), handed down from the card page. */
  apiKey: string;
  /** The calculation's rows, in the team's order: row N is drawn in `--route-N`. */
  rows: CommuteRow[];
  mode: CommuteMapMode;
}

/** Where the map opens before it is fitted to the routes: Warsaw, the team's city. */
const OPENING_CENTER = { lat: 52.2297, lng: 21.0122 };

/**
 * The route colour of a row as hex: the token painted on a 1×1 canvas and the pixel read back
 * (`rgbaToHex`). The `oklch` text is never parsed. `undefined` when the token or the canvas cannot be
 * read — the line then takes the map's default colour rather than a colour invented here.
 */
function tokenHex(token: string): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (value === "") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return undefined;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  return rgbaToHex(context.getImageData(0, 0, 1, 1).data);
}

/**
 * The routes of the active mode on the map: one line per row that has a route, a pin with the
 * row's number at each line's last vertex, one pin at the start (the first vertex), and the map
 * fitted to all of them. A mode switch reaches here as props only: the lines and pins change, the
 * map stays the same `google.maps.Map`.
 */
function Routes({ rows, mode }: Omit<Props, "apiKey">) {
  const map = useMap();
  const geometry = useMapsLibrary("geometry");
  // Read once per island: the tokens do not change while the page is open.
  const [colors] = useState(() => rows.map((_row, index) => tokenHex(routeColorToken(index))));

  const routes = useMemo(
    () =>
      rows.flatMap((row, index) => {
        const cell = mode === "transit" ? row.transit : row.drive;
        if (cell.kind !== "route") return [];
        const path = geometry ? geometry.encoding.decodePath(cell.encodedPolyline) : [];
        return [{ key: row.pointId, number: index + 1, encodedPath: cell.encodedPolyline, color: colors[index], path }];
      }),
    [rows, mode, geometry, colors],
  );

  const start = routes.find((route) => route.path.length > 0)?.path[0] ?? null;

  useEffect(() => {
    if (map === null) return;
    const points = routes.flatMap((route) => route.path);
    if (points.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const point of points) bounds.extend(point);
    map.fitBounds(bounds, 32);
  }, [map, routes]);

  return (
    <>
      {routes.map((route) => (
        <Polyline
          key={`${route.key}-${mode}`}
          encodedPath={route.encodedPath}
          strokeColor={route.color}
          strokeOpacity={0.9}
          strokeWeight={5}
        />
      ))}
      {routes.map((route) => {
        const end = route.path.at(-1);
        return end === undefined ? null : (
          <Marker key={`${route.key}-${mode}-end`} position={end} label={String(route.number)} />
        );
      })}
      {start === null ? null : <Marker position={start} label="S" title="Start" />}
    </>
  );
}

/**
 * One Google map of a calculated commute (FR-016), mounted by `CommuteRunner` only after a `done`
 * line and only with a browser key — never in `preview`, never on the kitchen sink. Loading Google's
 * script is billed as a map load, so neither `APIProvider` nor the map carries a `key`, and nothing
 * here depends on the mode or the result except the children: switching modes or calculating again
 * never creates a second `google.maps.Map`. `APIProvider` reads `apiKey` on its first render only.
 *
 * Nothing it shows is stored. `Marker` rather than `AdvancedMarker`, which needs a Map ID;
 * `colorScheme` is set once, at the map's creation.
 */
export default function CommuteMap({ apiKey, rows, mode }: Props) {
  return (
    <APIProvider apiKey={apiKey} language="pl" region="PL">
      <GoogleMap
        className="h-72 w-full overflow-hidden rounded-md"
        defaultCenter={OPENING_CENTER}
        defaultZoom={11}
        colorScheme={ColorScheme.DARK}
        gestureHandling="cooperative"
        streetViewControl={false}
        mapTypeControl={false}
      >
        <Routes rows={rows} mode={mode} />
      </GoogleMap>
    </APIProvider>
  );
}
