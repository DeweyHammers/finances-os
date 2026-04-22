"use client";

import { useState, useMemo } from "react";
import { useList, BaseRecord, useUpdate, useDelete } from "@refinedev/core";
import { Box, Paper, Typography, CircularProgress } from "@mui/material";
import { Calendar, dateFnsLocalizer, Views } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

// Internal
import EventModal from "./EventModal";
import { CustomEvent } from "./CustomEvent";
import { calendarStyles } from "./CalendarStyles";
import { getEventInstances, CalendarEvent } from "../../lib/calendar-utils";
import { COLORS } from "../../lib/constants";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
});

const DnDCalendar = withDragAndDrop<CalendarEvent>(Calendar);

export const CalendarList = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<any>();
  const [initialValues, setInitialValues] = useState<any>();
  const [view, setView] = useState<any>(Views.MONTH);
  const [date, setDate] = useState(new Date());

  const { query: eventsQuery } = useList<BaseRecord>({
    resource: "PlannedBlock",
  });
  const { mutate: updateEvent } = useUpdate();
  const { mutate: deleteEvent } = useDelete();

  const events = useMemo(
    () => getEventInstances(eventsQuery.data?.data || []),
    [eventsQuery.data],
  );

  const handleSelectSlot = (slotInfo: any) => {
    setSelectedEventId(undefined);
    setInitialValues({
      title: "",
      startTime: slotInfo.start,
      endTime: slotInfo.end,
      allDay: view === Views.MONTH,
    });
    setModalOpen(true);
  };

  const handleEventAction = (data: any, action: "resize" | "drop") => {
    const { event, start, end, allDay: isAllDay } = data;
    let finalEnd = end;

    const actualId = event.id.toString().includes("-v-")
      ? event.id.toString().split("-v-")[0]
      : event.id;

    if (!isAllDay && (action === "drop" || !event.allDay)) {
      const minEnd = new Date(new Date(start).getTime() + 30 * 60000);
      if (new Date(end) < minEnd) finalEnd = minEnd;
    }

    updateEvent({
      resource: "PlannedBlock",
      id: actualId,
      values: {
        startTime: start,
        endTime: finalEnd,
        allDay: isAllDay ?? (action === "resize" ? event.allDay : false),
      },
    });
  };

  const handleDelete = (id: any) => {
    deleteEvent({ resource: "PlannedBlock", id });
  };

  if (eventsQuery.isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "80vh",
        }}
      >
        <CircularProgress size={60} thickness={4} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 4,
        height: "calc(100vh - 64px)",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <Typography variant="h4" sx={{ fontWeight: 900 }}>
        Work Calendar
      </Typography>
      <Paper sx={calendarStyles}>
        <DnDCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          style={{ height: "100%" }}
          onSelectSlot={handleSelectSlot}
          onSelectEvent={(e) => {
            setSelectedEventId(e.id);
            setModalOpen(true);
          }}
          onEventDrop={(d) => handleEventAction(d, "drop")}
          onEventResize={(d) => handleEventAction(d, "resize")}
          eventPropGetter={(e) => ({
            style: { backgroundColor: e.resource?.color || COLORS.gross },
          })}
          components={{
            event: (props) => (
              <CustomEvent {...props} onDelete={handleDelete} />
            ),
          }}
          resizable
          selectable
          showMultiDayTimes
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
          step={30}
          timeslots={1}
        />
      </Paper>
      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        eventId={selectedEventId}
        initialValues={initialValues}
      />
    </Box>
  );
};
