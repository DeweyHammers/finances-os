"use client";

import { useMemo, useState } from "react";
import { Box, Typography, Paper } from "@mui/material";
import { formatMoney } from "../../../lib/cents";
import {
  MonthlySpend,
  ItemSpend,
  itemColor,
} from "./stats-utils";

interface Props {
  data: MonthlySpend[];
  allItems: { id: string; name?: string }[];
  year: number;
  onMonthClick?: (monthIndex: number) => void;
}

const PADDING = { top: 24, right: 24, bottom: 36, left: 64 };
const HEIGHT = 360;

const niceMax = (raw: number): number => {
  if (raw <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  let nice: number;
  if (n <= 1) nice = 1;
  else if (n <= 2) nice = 2;
  else if (n <= 2.5) nice = 2.5;
  else if (n <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
};

export const MonthlyStackedBars = ({
  data,
  allItems,
  year,
  onMonthClick,
}: Props) => {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    month: MonthlySpend;
    item: ItemSpend;
  } | null>(null);
  const [width, setWidth] = useState(900);

  const maxCents = useMemo(
    () => Math.max(0, ...data.map((m) => m.totalCents)),
    [data],
  );
  const yMax = niceMax(maxCents / 100);

  const innerW = Math.max(100, width - PADDING.left - PADDING.right);
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;
  const bandW = innerW / 12;
  const barW = Math.min(56, bandW * 0.6);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = yMax / 5;
    for (let i = 0; i <= 5; i++) ticks.push(step * i);
    return ticks;
  }, [yMax]);

  const yScale = (dollars: number) =>
    PADDING.top + innerH - (dollars / yMax) * innerH;

  return (
    <Box>
      <Box
        sx={{
          width: "100%",
          position: "relative",
        }}
        ref={(el: HTMLDivElement | null) => {
          if (el && el.clientWidth && Math.abs(el.clientWidth - width) > 2) {
            setWidth(el.clientWidth);
          }
        }}
      >
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          style={{ display: "block" }}
        >
          {yTicks.map((t, i) => {
            const y = yScale(t);
            return (
              <g key={i}>
                <line
                  x1={PADDING.left}
                  x2={PADDING.left + innerW}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={1}
                />
                <text
                  x={PADDING.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="#94a3b8"
                  fontFamily="Inter, sans-serif"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  ${t >= 1000 ? `${(t / 1000).toFixed(t >= 10000 ? 0 : 1)}k` : t.toFixed(0)}
                </text>
              </g>
            );
          })}

          {data.map((m, i) => {
            const cx = PADDING.left + bandW * i + bandW / 2;
            const baseY = yScale(0);
            let cursorY = baseY;
            const hasData = m.totalCents > 0;
            return (
              <g key={m.monthIndex}>
                {hasData && onMonthClick && (
                  <rect
                    x={cx - bandW / 2}
                    y={PADDING.top}
                    width={bandW}
                    height={innerH}
                    fill="transparent"
                    onClick={() => onMonthClick(m.monthIndex)}
                    style={{ cursor: "pointer" }}
                  />
                )}
                {m.items.map((it) => {
                  const heightPx = (it.cents / 100 / yMax) * innerH;
                  if (heightPx <= 0) return null;
                  const top = cursorY - heightPx;
                  const isHover =
                    !!hover &&
                    hover.month.monthIndex === m.monthIndex &&
                    hover.item.itemId === it.itemId;
                  const rect = (
                    <rect
                      key={it.itemId}
                      x={cx - barW / 2}
                      y={top}
                      width={barW}
                      height={heightPx}
                      fill={itemColor(it.itemId, allItems)}
                      opacity={hover && !isHover ? 0.35 : 1}
                      rx={2}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() =>
                        setHover({
                          x: cx,
                          y: top,
                          month: m,
                          item: it,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                      onClick={
                        onMonthClick
                          ? () => onMonthClick(m.monthIndex)
                          : undefined
                      }
                    />
                  );
                  cursorY = top;
                  return rect;
                })}
                {m.totalCents > 0 && (
                  <text
                    x={cx}
                    y={cursorY - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#cbd5e1"
                    fontFamily="Inter, sans-serif"
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      pointerEvents: "none",
                    }}
                    opacity={
                      hover && hover.month.monthIndex !== m.monthIndex ? 0.4 : 1
                    }
                  >
                    ${Math.round(m.totalCents / 100).toLocaleString()}
                  </text>
                )}
                <text
                  x={cx}
                  y={HEIGHT - PADDING.bottom + 18}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#94a3b8"
                  fontFamily="Inter, sans-serif"
                  fontWeight={600}
                  onClick={
                    hasData && onMonthClick
                      ? () => onMonthClick(m.monthIndex)
                      : undefined
                  }
                  style={{
                    cursor: hasData && onMonthClick ? "pointer" : "default",
                  }}
                >
                  {m.monthLabel}
                </text>
              </g>
            );
          })}

          <line
            x1={PADDING.left}
            x2={PADDING.left + innerW}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1}
          />

          <text
            x={PADDING.left + innerW / 2}
            y={HEIGHT - 4}
            textAnchor="middle"
            fontSize={11}
            fill="#64748b"
            fontFamily="Inter, sans-serif"
            fontWeight={700}
            letterSpacing={1}
          >
            {year}
          </text>
        </svg>

        {hover && (() => {
          const TOOLTIP_W = 230;
          const ARROW = 9;
          const GAP = 12;
          const tooltipLeft = Math.min(
            Math.max(hover.x - TOOLTIP_W / 2, 8),
            width - TOOLTIP_W - 8,
          );
          const tooltipTop = Math.max(8, hover.y - GAP - 70);
          const arrowCenter = Math.min(
            Math.max(hover.x - tooltipLeft, 18),
            TOOLTIP_W - 18,
          );
          const pct =
            hover.month.totalCents > 0
              ? (hover.item.cents / hover.month.totalCents) * 100
              : 0;
          return (
          <Paper
            elevation={6}
            sx={{
              position: "absolute",
              top: tooltipTop,
              left: tooltipLeft,
              p: 1.5,
              width: TOOLTIP_W,
              bgcolor: "rgba(15, 23, 42, 0.96)",
              border: "1px solid rgba(129, 140, 248, 0.25)",
              borderRadius: 2,
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                mb: 0.75,
              }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "2px",
                  bgcolor: itemColor(hover.item.itemId, allItems),
                  flexShrink: 0,
                }}
              />
              <Typography
                sx={{
                  fontWeight: 800,
                  color: "white",
                  fontSize: "0.85rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {hover.item.itemName}
              </Typography>
            </Box>
            <Typography
              sx={{
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "text.secondary",
                letterSpacing: 0.5,
                mb: 0.5,
              }}
            >
              {hover.month.monthLabel} {year}
            </Typography>
            <Box
              sx={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 1,
              }}
            >
              <Typography
                sx={{
                  fontWeight: 800,
                  color: "primary.light",
                  fontSize: "1.05rem",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatMoney(hover.item.cents)}
              </Typography>
              <Typography
                sx={{
                  fontSize: "0.78rem",
                  color: "#cbd5e1",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pct.toFixed(1)}% of month
              </Typography>
            </Box>
            <Box
              sx={{
                position: "absolute",
                bottom: -ARROW,
                left: arrowCenter - ARROW,
                width: 0,
                height: 0,
                borderLeft: `${ARROW}px solid transparent`,
                borderRight: `${ARROW}px solid transparent`,
                borderTop: `${ARROW}px solid rgba(129, 140, 248, 0.25)`,
              }}
            />
            <Box
              sx={{
                position: "absolute",
                bottom: -ARROW + 1.5,
                left: arrowCenter - ARROW + 1.5,
                width: 0,
                height: 0,
                borderLeft: `${ARROW - 1.5}px solid transparent`,
                borderRight: `${ARROW - 1.5}px solid transparent`,
                borderTop: `${ARROW - 1.5}px solid rgba(15, 23, 42, 0.96)`,
              }}
            />
          </Paper>
          );
        })()}
      </Box>

    </Box>
  );
};
