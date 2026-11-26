"use client";

/**
 * FormSection — one inset card that groups a part of a form: its heading and
 * a line of explanation at the top, the controls under them, and optionally a
 * strip at the bottom (a sentence that spells out what the choice means, with
 * a button at its right end when the section saves by itself).
 *
 * It started as the "Temporary amount" section of the Bill edit dialog (Nov
 * 25 2026). There the heading, the small print, the fields and the Add button
 * were loose pieces between the bill's own fields, which read as cramped and
 * unrelated; put into one card they read as one thing. The Income and
 * Personal forms had the same loose "CAPS HEADING + caption + controls"
 * groups, so the card moved here and they all use it — never hand-roll the
 * border / background of a form group again.
 *
 * Presentation only: no state, no form logic. `FieldLabel` is the small caps
 * label above a control INSIDE a card (a control that has no floating label
 * of its own: a toggle group, a stepper).
 */

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

// One place for the card's three tones, all laid over the dialog's surface.
const SECTION_BORDER = "1px solid rgba(255,255,255,0.1)";
const SECTION_BG = "rgba(15, 23, 42, 0.28)";
const SECTION_STRIP_BG = "rgba(15, 23, 42, 0.35)";
const SECTION_STRIP_BORDER = "1px solid rgba(255,255,255,0.08)";

/** The small caps label above a control that has no label of its own. */
export const FieldLabel = ({ children }: { children: ReactNode }) => (
  <Typography
    component="span"
    sx={{
      display: "block",
      mb: 0.5,
      fontSize: "0.65rem",
      fontWeight: 800,
      letterSpacing: "0.8px",
      color: "text.disabled",
    }}
  >
    {children}
  </Typography>
);

interface FormSectionProps {
  /** The heading, written in caps ("PAY SCHEDULE"). Leave out for a card that needs none. */
  title?: ReactNode;
  /** One or two lines under the heading: what the section is for. */
  description?: ReactNode;
  /** A single control at the right of the heading, centred on it: the switch
   * of a card that is nothing but one on / off choice ("PRIMARY INCOME"). */
  action?: ReactNode;
  /** The controls. */
  children?: ReactNode;
  /** The strip at the bottom of the card (already laid out by the caller). */
  footer?: ReactNode;
  /** Extra styles for the body (the box around `children`). */
  bodySx?: SxProps<Theme>;
}

export const FormSection = ({ title, description, action, children, footer, bodySx }: FormSectionProps) => {
  const hasHeader = title != null || description != null;
  // With nothing under it, the heading is the whole card: close it off below too.
  const headerOnly = children == null;
  return (
    <Box sx={{ borderRadius: 2, border: SECTION_BORDER, bgcolor: SECTION_BG, overflow: "hidden" }}>
      {hasHeader && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, px: 2, pt: 1.75, pb: headerOnly ? 1.75 : 0 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {title != null && (
              <Typography
                variant="caption"
                sx={{ fontWeight: 800, color: "text.secondary", letterSpacing: 0.5, display: "block", mb: 0.25 }}
              >
                {title}
              </Typography>
            )}
            {description != null && (
              <Typography variant="caption" sx={{ color: "text.disabled", display: "block", lineHeight: 1.5 }}>
                {description}
              </Typography>
            )}
          </Box>
          {action != null && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
        </Box>
      )}
      {children != null && (
        <Box sx={[{ px: 2, pt: hasHeader ? 1.75 : 2, pb: 2 }, ...(Array.isArray(bodySx) ? bodySx : [bodySx])]}>
          {children}
        </Box>
      )}
      {footer != null && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 2,
            px: 2,
            py: 1.5,
            borderTop: SECTION_STRIP_BORDER,
            bgcolor: SECTION_STRIP_BG,
          }}
        >
          {footer}
        </Box>
      )}
    </Box>
  );
};

/** The sentence in a section's strip (grows; the button beside it does not). */
export const FormSectionNote = ({ children }: { children: ReactNode }) => (
  <Typography sx={{ flex: "1 1 220px", minWidth: 0, fontSize: "0.82rem", color: "text.secondary", lineHeight: 1.45 }}>
    {children}
  </Typography>
);
