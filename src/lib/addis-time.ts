export const ADDIS_ABABA_TIME_ZONE = 'Africa/Addis_Ababa';
export const ADDIS_ABABA_TIME_LABEL = 'Addis Ababa';

const addisOffsetMs = 3 * 60 * 60 * 1000;
const clockOptions = {hour: 'numeric', minute: '2-digit', hourCycle: 'h12', timeZone: ADDIS_ABABA_TIME_ZONE} as const;
const minuteClock = new Intl.DateTimeFormat('en-GB', clockOptions);
const secondClock = new Intl.DateTimeFormat('en-GB', {...clockOptions, second: '2-digit'});
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
type TimestampStyle = 'dateTime' | 'compact' | 'time' | 'withSeconds';

export function formatAddisTimestamp(value: string | Date | null | undefined, locale = 'en-GB', style: TimestampStyle = 'dateTime') {
  if (!value) return 'Not scheduled';
  const instant = new Date(value);
  const clock = (style === 'withSeconds' ? secondClock : minuteClock).format(instant).replace(/[ap]m$/, marker => marker.toUpperCase());
  if (style === 'time') return clock;

  const compact = style === 'compact';
  const key = `${locale}:${compact}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = compact ? {month: 'short', day: 'numeric'} : {dateStyle: 'medium'};
    formatter = new Intl.DateTimeFormat(locale, {...options, timeZone: ADDIS_ABABA_TIME_ZONE});
    dateFormatters.set(key, formatter);
  }
  return `${formatter.format(instant)}, ${clock}`;
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
