export const ADDIS_ABABA_TIME_ZONE = 'Africa/Addis_Ababa';
export const ADDIS_ABABA_TIME_OFFSET = 'GMT+3';
export const ADDIS_ABABA_TIME_LABEL = `Addis Ababa (${ADDIS_ABABA_TIME_OFFSET})`;

const addisOffsetMs = 3 * 60 * 60 * 1000;
const adminTimestamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: ADDIS_ABABA_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatAddisTimestamp(value: string | Date | null | undefined) {
  if (!value) return 'Not scheduled';
  return `${adminTimestamp.format(new Date(value))} ${ADDIS_ABABA_TIME_OFFSET}`;
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
