"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
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

const PADDING = { top: 24, right: 24, bottom: 16, left: 64 };
const X_AXIS_HEIGHT = 50;
const MIN_CHART_HEIGHT = 220;

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
    mouseX: number;
    mouseY: number;
    month: MonthlySpend;
    item: ItemSpend;
  } | null>(null);
  const [size, setSize] = useState({ width: 900, height: 320 });
  const outerRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);

  // Measure the bars container so the chart fills whatever vertical space is
  // available — no scroll, no zoom, the SVG just scales to fit.
  useLayoutEffect(() => {
    const el = barsRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      setSize((prev) =>
        Math.abs(prev.width - w) > 2 || Math.abs(prev.height - h) > 2
          ? { width: w, height: h }
          : prev,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { width } = size;
  const chartH = Math.max(MIN_CHART_HEIGHT, size.height);

  const maxCents = useMemo(
    () => Math.max(0, ...data.map((m) => m.totalCents)),
    [data],
  );
  const yMax = niceMax(maxCents / 100);

  const innerW = Math.max(100, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, chartH - PADDING.top - PADDING.bottom);
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
    <Box
      ref={outerRef}
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        height: "100%",
        position: "relative",
      }}
    >
      <Box
        ref={barsRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <svg
          width="100%"
          height={chartH}
          viewBox={`0 0 ${width} ${chartH}`}
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
                  const handleMove = (e: React.MouseEvent) => {
                    const outer = outerRef.current;
                    if (!outer) return;
                    const rect = outer.getBoundingClientRect();
                    setHover({
                      mouseX: e.clientX - rect.left,
                      mouseY: e.clientY - rect.top,
                      month: m,
                      item: it,
                    });
                  };
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
                      onMouseEnter={handleMove}
                      onMouseMove={handleMove}
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
        </svg>
      </Box>

      <Box sx={{ flexShrink: 0 }}>
        <svg
          width="100%"
          height={X_AXIS_HEIGHT}
          viewBox={`0 0 ${width} ${X_AXIS_HEIGHT}`}
          style={{ display: "block" }}
        >
          {data.map((m, i) => {
            const cx = PADDING.left + bandW * i + bandW / 2;
            const hasData = m.totalCents > 0;
            return (
              <text
                key={m.monthIndex}
                x={cx}
                y={20}
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
            );
          })}
          <text
            x={PADDING.left + innerW / 2}
            y={X_AXIS_HEIGHT - 6}
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
      </Box>

      {hover && (() => {
        const TOOLTIP_W = 230;
        const TOOLTIP_H_EST = 88;
        const CURSOR_OFFSET_X = 16;
        const CURSOR_OFFSET_Y = 20;
        const containerH =
          outerRef.current?.clientHeight ?? chartH + X_AXIS_HEIGHT;
        let tooltipLeft = hover.mouseX + CURSOR_OFFSET_X;
        if (tooltipLeft + TOOLTIP_W + 8 > width) {
          tooltipLeft = hover.mouseX - TOOLTIP_W - CURSOR_OFFSET_X;
        }
        tooltipLeft = Math.max(8, Math.min(tooltipLeft, width - TOOLTIP_W - 8));
        let tooltipTop = hover.mouseY + CURSOR_OFFSET_Y;
        if (tooltipTop + TOOLTIP_H_EST + 8 > containerH) {
          tooltipTop = hover.mouseY - TOOLTIP_H_EST - CURSOR_OFFSET_Y;
        }
        tooltipTop = Math.max(8, tooltipTop);
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
          </Paper>
        );
      })()}
    </Box>
  );
};
