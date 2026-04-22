import { format } from "date-fns";

/**
 * Formats a date string or object to a human-readable format,
 * ensuring the date is treated as a UTC day to avoid timezone shifts.
 */
export const formatDate = (date: string | Date | null | undefined, formatStr: string = "MMM dd, yyyy") => {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "Invalid Date";
  
  // Create a local date that matches the UTC components of the input
  // This ensures that "2026-01-31T00:00:00Z" shows as "Jan 31" regardless of local timezone.
  const localDate = new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  );
  
  return format(localDate, formatStr);
};

/**
 * Parses a date string or object into a local Date object representing the same day.
 * Useful for MUI DatePickers to prevent them from shifting the date based on timezone.
 */
export const parseISOAsLocal = (dateInput: string | Date | null | undefined) => {
  if (!dateInput) return null;
  
  // If it's a YYYY-MM-DD string, parse it manually as local
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [year, month, day] = dateInput.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  );
};
