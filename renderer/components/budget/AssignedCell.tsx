"use client";

import { useState, useEffect, useRef } from "react";
import { TextField } from "@mui/material";
import { fromCents, toCents, formatMoney } from "../../lib/cents";

interface AssignedCellProps {
  cents: number;
  onCommit: (newCents: number) => void;
}

export const AssignedCell = ({ cents, onCommit }: AssignedCellProps) => {
  const [text, setText] = useState<string>(formatMoney(cents));
  const [focused, setFocused] = useState(false);
  const skipNextCommit = useRef(false);

  useEffect(() => {
    if (!focused) setText(formatMoney(cents));
  }, [cents, focused]);

  const commit = () => {
    if (skipNextCommit.current) {
      skipNextCommit.current = false;
      setText(formatMoney(cents));
      return;
    }
    const trimmed = text.trim().replace(/^\$/, "");
    let next = cents;
    if (trimmed === "") {
      next = 0;
    } else if (trimmed.startsWith("+")) {
      next = cents + toCents(trimmed.slice(1));
    } else {
      next = toCents(trimmed);
    }
    if (next !== cents) onCommit(next);
    setText(formatMoney(next));
  };

  return (
    <TextField
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        setText(formatForEdit(cents));
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          skipNextCommit.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
      variant="standard"
      size="small"
      slotProps={{
        input: {
          disableUnderline: true,
          sx: {
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
            color: "white",
            fontSize: "0.95rem",
          },
        },
        htmlInput: {
          inputMode: "decimal",
          style: { textAlign: "right" },
        },
      }}
      sx={{
        width: "100%",
        "& input": { py: 0.5, px: 0 },
      }}
    />
  );
};

function formatForEdit(cents: number): string {
  if (!Number.isFinite(cents)) return "0.00";
  const v = fromCents(cents);
  return v.toFixed(2);
}
