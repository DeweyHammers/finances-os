import { Box, Typography, IconButton } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { CalendarEvent } from "../../lib/calendar-utils";

interface CustomEventProps {
  event: CalendarEvent;
  onDelete: (id: string | number) => void;
}

export const CustomEvent = ({ event, onDelete }: CustomEventProps) => {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    const actualId = event.id.toString().includes("-v-")
      ? event.id.toString().split("-v-")[0]
      : event.id;
    onDelete(actualId);
  };

  const durationMs = event.end.getTime() - event.start.getTime();
  const durationMins = durationMs / (1000 * 60);
  const isSmall = durationMins <= 30 && !event.allDay;

  return (
    <Box
      sx={{
        p: "2px 4px",
        height: "100%",
        width: "100%",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        "&:hover .quick-delete": {
          opacity: 1,
        },
      }}
    >
      <IconButton
        className="quick-delete"
        size="small"
        onClick={handleDelete}
        sx={{
          position: "absolute",
          top: 2,
          right: 2,
          opacity: 0,
          transition: "all 0.1s ease-in-out",
          color: "white",
          bgcolor: "rgba(0,0,0,0.6)",
          width: 18,
          height: 18,
          zIndex: 100,
          "&:hover": {
            bgcolor: "#ef4444",
            color: "white",
          },
        }}
      >
        <DeleteIcon sx={{ fontSize: "0.75rem" }} />
      </IconButton>

      <Box sx={{ pr: "22px", width: "100%", overflow: "hidden" }}>
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 800,
            lineHeight: 1.2,
            mb: 0,
            fontSize: "0.85rem",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "block",
          }}
        >
          {event.title}
        </Typography>
      </Box>

      {!isSmall && event.resource?.contract?.name && (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            opacity: 0.9,
            fontWeight: 800,
            fontSize: "0.6rem",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            mt: 0.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          📋 {event.resource.contract.name}
        </Typography>
      )}

      {!isSmall && event.resource?.description && (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            opacity: 0.7,
            fontSize: "0.65rem",
            fontStyle: "italic",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            mt: 0.1,
          }}
        >
          {event.resource.description}
        </Typography>
      )}
    </Box>
  );
};
