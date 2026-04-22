import { SxProps, Theme } from "@mui/material";

export const calendarStyles: SxProps<Theme> = {
  flex: 1,
  p: 2,
  borderRadius: 2,
  border: "1px solid rgba(255,255,255,0.05)",
  bgcolor: "background.paper",
  "& .rbc-calendar": {
    color: "text.primary",
    "& *": {
      borderColor: "rgba(255,255,255,0.1) !important",
    },
  },
  "& .rbc-month-view": {
    border: "1px solid rgba(255,255,255,0.1) !important",
    borderRadius: "8px !important",
    overflow: "hidden",
  },
  "& .rbc-header": {
    py: 1.5,
    fontWeight: 700,
    borderBottom: "1px solid rgba(255,255,255,0.1) !important",
  },
  "& .rbc-month-row": {
    borderTop: "none !important",
    borderBottom: "1px solid rgba(255,255,255,0.05) !important",
  },
  "& .rbc-day-bg + .rbc-day-bg": {
    borderLeft: "1px solid rgba(255,255,255,0.05) !important",
  },
  "& .rbc-header + .rbc-header": {
    borderLeft: "1px solid rgba(255,255,255,0.05) !important",
  },
  "& .rbc-time-view, & .rbc-agenda-view": {
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 1,
  },
  "& .rbc-off-range-bg": {
    bgcolor: "rgba(255,255,255,0.02)",
  },
  "& .rbc-today": {
    bgcolor: "rgba(129, 140, 248, 0.1)",
  },
  "& .rbc-event": {
    bgcolor: "primary.main",
    borderRadius: 1,
    border: "none",
    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
    overflow: "hidden !important",
  },
  "& .rbc-toolbar button": {
    color: "text.primary",
    bgcolor: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    "&:hover": {
      bgcolor: "rgba(255,255,255,0.1)",
    },
    "&.rbc-active": {
      bgcolor: "primary.main",
      color: "white",
      border: "1px solid primary.main",
    },
  },
  "& .rbc-time-content": {
    borderTop: "1px solid rgba(255,255,255,0.1)",
  },
  "& .rbc-timeslot-group": {
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    minHeight: "60px !important",
  },
  "& .rbc-time-slot": {
    height: "60px !important",
  },
  "& .rbc-time-gutter .rbc-timeslot-group": {
    borderBottom: "none",
  },
  "& .rbc-day-slot .rbc-time-slot": {
    borderTop: "1px solid rgba(255,255,255,0.02)",
  },
  "& .rbc-addons-dnd-resizable": {
    display: "flex",
    flexDirection: "column",
  },
  "& .rbc-addons-dnd-resize-ns-anchor": {
    height: "10px !important",
    width: "100%",
    left: 0,
    zIndex: 15,
  },
  "& .rbc-addons-dnd-resize-ns-icon": {
    width: "20px",
    height: "2px",
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: "1px",
    border: "none",
  },
};
