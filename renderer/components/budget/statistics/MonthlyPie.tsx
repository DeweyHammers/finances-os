"use client";

import { useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { formatMoney } from "../../../lib/cents";
import {
  MonthlySpend,
  itemColor,
} from "./stats-utils";

interface Props {
  month: MonthlySpend;
  year: number;
  allItems: { id: string; name?: string }[];
  itemsLabel?: string;
  emptyLabel?: string;
}

const SIZE = 320;
const RADIUS = 130;
const HOVER_RADIUS = 138;
const INNER_RADIUS = 64;
const CENTER = SIZE / 2;

const polarToCartesian = (
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const arcPath = (
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number,
): string => {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  const o0 = polarToCartesian(cx, cy, rOuter, startDeg);
  const o1 = polarToCartesian(cx, cy, rOuter, endDeg);
  const i1 = polarToCartesian(cx, cy, rInner, endDeg);
  const i0 = polarToCartesian(cx, cy, rInner, startDeg);
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${i0.x} ${i0.y}`,
    "Z",
  ].join(" ");
};

const fullDonutPath = (cx: number, cy: number, rOuter: number, rInner: number): string => {
  // Outer ring clockwise + inner ring counter-clockwise.
  // With fill-rule "nonzero", the inner ring's opposite winding punches a hole.
  return [
    `M ${cx} ${cy - rOuter}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${cx} ${cy + rOuter}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${cx} ${cy - rOuter}`,
    "Z",
    `M ${cx} ${cy - rInner}`,
    `A ${rInner} ${rInner} 0 0 0 ${cx} ${cy + rInner}`,
    `A ${rInner} ${rInner} 0 0 0 ${cx} ${cy - rInner}`,
    "Z",
  ].join(" ");
};

export const MonthlyPie = ({
  month,
  year,
  allItems,
  itemsLabel = "ITEMS",
  emptyLabel,
}: Props) => {
  const [hoverItemId, setHoverItemId] = useState<string | null>(null);

  const slices = useMemo(() => {
    const total = month.totalCents;
    if (total === 0) return [];
    let cursor = 0;
    return month.items.map((it) => {
      const start = (cursor / total) * 360;
      cursor += it.cents;
      const end = (cursor / total) * 360;
      return { item: it, start, end };
    });
  }, [month]);

  const hoverItem = useMemo(
    () => month.items.find((it) => it.itemId === hoverItemId),
    [month.items, hoverItemId],
  );

  if (month.totalCents === 0) {
    return (
      <Box
        sx={{
          height: SIZE + 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <Typography
          sx={{
            fontSize: "1.05rem",
            color: "text.secondary",
            fontWeight: 700,
          }}
        >
          {emptyLabel ?? `No spending in ${month.monthLabel} ${year}`}
        </Typography>
        <Typography
          sx={{
            fontSize: "0.8rem",
            color: "text.secondary",
            fontStyle: "italic",
          }}
        >
          Categorized transactions in this month will show here.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: `${SIZE}px 1fr` },
        gap: 4,
        alignItems: "center",
      }}
    >
      <Box sx={{ position: "relative", width: SIZE, height: SIZE, mx: "auto" }}>
        <svg width={SIZE} height={SIZE} style={{ display: "block" }}>
          {slices.map(({ item, start, end }) => {
            const isHover = hoverItemId === item.itemId;
            const r = isHover ? HOVER_RADIUS : RADIUS;
            const path =
              end - start >= 359.99
                ? fullDonutPath(CENTER, CENTER, r, INNER_RADIUS)
                : arcPath(CENTER, CENTER, r, INNER_RADIUS, start, end);
            return (
              <path
                key={item.itemId}
                d={path}
                fill={itemColor(item.itemId, allItems)}
                opacity={hoverItemId && !isHover ? 0.4 : 1}
                stroke="#0f172a"
                strokeWidth={2}
                onMouseEnter={() => setHoverItemId(item.itemId)}
                onMouseLeave={() => setHoverItemId(null)}
                style={{ cursor: "pointer", transition: "opacity 120ms" }}
              />
            );
          })}
        </svg>
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: INNER_RADIUS * 2 - 16,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.5,
            pointerEvents: "none",
            textAlign: "center",
          }}
        >
          <Typography
            sx={{
              fontSize: "0.68rem",
              fontWeight: 800,
              color: "#94a3b8",
              letterSpacing: 0.8,
              textTransform: "uppercase",
              lineHeight: 1.15,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
              wordBreak: "break-word",
              width: "100%",
            }}
          >
            {hoverItem
              ? hoverItem.itemName
              : `${month.monthLabel} ${year}`}
          </Typography>
          <Typography
            sx={{
              fontSize: "1.15rem",
              fontWeight: 800,
              color: "white",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {formatMoney(hoverItem ? hoverItem.cents : month.totalCents)}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: "0.75rem",
            fontWeight: 800,
            color: "text.secondary",
            letterSpacing: 1,
            mb: 1.5,
          }}
        >
          {itemsLabel}
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {month.items.map((it) => {
            const pct = (it.cents / month.totalCents) * 100;
            const isHover = hoverItemId === it.itemId;
            return (
              <Box
                key={it.itemId}
                onMouseEnter={() => setHoverItemId(it.itemId)}
                onMouseLeave={() => setHoverItemId(null)}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto auto",
                  gap: 1.5,
                  alignItems: "center",
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 1,
                  cursor: "pointer",
                  bgcolor: isHover
                    ? "rgba(129, 140, 248, 0.12)"
                    : "rgba(255,255,255,0.02)",
                  transition: "background 120ms",
                  "&:hover": {
                    bgcolor: "rgba(129, 140, 248, 0.12)",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "3px",
                    bgcolor: itemColor(it.itemId, allItems),
                  }}
                />
                <Typography
                  sx={{
                    fontSize: "0.9rem",
                    color: "white",
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {it.itemName}
                </Typography>
                <Typography
                  sx={{
                    fontSize: "0.75rem",
                    color: "text.secondary",
                    fontVariantNumeric: "tabular-nums",
                    minWidth: 48,
                    textAlign: "right",
                  }}
                >
                  {pct.toFixed(1)}%
                </Typography>
                <Typography
                  sx={{
                    fontSize: "0.9rem",
                    color: "#cbd5e1",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    minWidth: 90,
                    textAlign: "right",
                  }}
                >
                  {formatMoney(it.cents)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};
