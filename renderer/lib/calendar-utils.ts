import { BaseKey } from "@refinedev/core";
import { addWeeks } from "date-fns";

export interface CalendarEvent {
  id: BaseKey;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  resource: any;
}

export const getEventInstances = (rawEvents: any[]): CalendarEvent[] => {
  const allInstances: CalendarEvent[] = [];

  rawEvents.forEach((event) => {
    const baseStart = new Date(event.startTime);
    const baseEnd = new Date(event.endTime);

    allInstances.push({
      id: event.id ?? "",
      title: event.title,
      start: baseStart,
      end: baseEnd,
      allDay: event.allDay || false,
      resource: event,
    });

    if (event.isRecurring && event.frequency === "WEEKLY") {
      for (let i = 1; i <= 52; i++) {
        allInstances.push({
          id: `${event.id}-v-${i}`,
          title: event.title,
          start: addWeeks(baseStart, i),
          end: addWeeks(baseEnd, i),
          allDay: event.allDay || false,
          resource: event,
        });
      }
    }
  });

  return allInstances;
};
