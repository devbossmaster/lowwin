export const ADDIS_ABABA_TIME_ZONE = 'Africa/Addis_Ababa';
export const ADDIS_ABABA_TIME_OFFSET = 'GMT+3';
export const ADDIS_ABABA_TIME_LABEL = `Addis Ababa (${ADDIS_ABABA_TIME_OFFSET})`;

const addisOffsetMs = 3 * 60 * 60 * 1000;
const timestampStyles = {
  dateTime: {dateStyle: 'medium', timeStyle: 'short'},
  compact: {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'},
  time: {hour: '2-digit', minute: '2-digit'},
  withSeconds: {dateStyle: 'medium', timeStyle: 'medium'},
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatAddisTimestamp(value: string | Date | null | undefined, locale = 'en-GB', style: keyof typeof timestampStyles = 'dateTime') {
  if (!value) return 'Not scheduled';
  const key = `${locale}:${style}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {...timestampStyles[style], timeZone: ADDIS_ABABA_TIME_ZONE, hourCycle: 'h23'});
    formatters.set(key, formatter);
  }
  return `${formatter.format(new Date(value))} ${ADDIS_ABABA_TIME_OFFSET}`;
}

/** Convert a UTC instant into a minute-precision Addis Ababa datetime-local value. */
export function formatAddisDateTimeLocal(value: string | Date | null | undefined) {
  if (!value) return '';
  return new Date(new Date(value).getTime() + addisOffsetMs).toISOString().slice(0, 16);
}

/** Interpret the datetime-local value using Ethiopia's GMT+3 offset. */
export function parseAddisDateTimeLocal(value: string) {
  return new Date(`${value}+03:00`);
}
