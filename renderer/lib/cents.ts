export const toCents = (dollars: number | string): number => {
  if (typeof dollars === "string") {
    const trimmed = dollars.trim().replace(/,/g, "");
    if (trimmed === "" || trimmed === "-") return 0;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
};

export const fromCents = (cents: number): number => {
  if (!Number.isFinite(cents)) return 0;
  return cents / 100;
};

export const formatMoney = (
  cents: number,
  options: { withSign?: boolean } = {},
): string => {
  if (!Number.isFinite(cents)) cents = 0;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs - dollars * 100;
  const formatted = `$${dollars.toLocaleString()}.${remainder.toString().padStart(2, "0")}`;
  if (negative) return `-${formatted}`;
  if (options.withSign && cents > 0) return `+${formatted}`;
  return formatted;
};
