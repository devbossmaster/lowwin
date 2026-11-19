'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {Clock3} from 'lucide-react';
import {ADDIS_ABABA_TIME_LABEL, formatAddisDateTimeLocal, formatAddisTimestamp, parseAddisDateTimeLocal} from '@/lib/addis-time';
import {countdownUnits} from '@/lib/countdown-units';
import styles from './admin-auction-schedule-preview.module.css';

const timePattern = '(?:[01][0-9]|2[0-3]):[0-5][0-9]';
const validClock = new RegExp(`^${timePattern}$`);
const schedulePattern = new RegExp(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T${timePattern}$`);

export function parseAuctionScheduleTime(value: string) {
  if (!schedulePattern.test(value)) return null;
  const instant = parseAddisDateTimeLocal(value);
  return Number.isFinite(instant.getTime()) && formatAddisDateTimeLocal(instant) === value ? instant : null;
}

type ScheduleFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  after?: string;
};

export function AdminAuctionDateTimeField({label, name, value, onChange, after}: ScheduleFieldProps) {
  const titleId = useId(), clock = useRef<HTMLInputElement>(null);
  const [date, time = ''] = value.split('T');
  const minimum = after ? parseAuctionScheduleTime(after) : null;
  const instant = parseAuctionScheduleTime(value);
  const error = date && validClock.test(time) && !instant
    ? 'Enter a valid date.'
    : instant && minimum && instant <= minimum ? 'The end time must be after the start time.' : '';
  useEffect(() => { clock.current?.setCustomValidity(error); }, [error]);

  return <div role="group" aria-labelledby={titleId} className={styles.scheduleField}>
    <span id={titleId}>{label}</span>
    <div className={styles.scheduleControls}>
      <label>Date<input type="date" value={date} min={minimum ? after?.split('T')[0] : undefined} onChange={event => onChange(`${event.target.value}T${time}`)} required/></label>
      <label>Time (24-hour)<input ref={clock} type="text" value={time} pattern={timePattern} placeholder="HH:mm" maxLength={5} onChange={event => onChange(`${date}T${event.target.value}`)} required/></label>
    </div>
    <input type="hidden" name={name} value={value}/>
  </div>;
}

function formatDuration(milliseconds: number) {
  const [days, hours, minutes] = countdownUnits(milliseconds).map(Number);
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || 'Under 1 min';
}

type SchedulePreviewProps = {
  start?: string;
  end: string;
  previousEnd?: string;
};

export function AdminAuctionSchedulePreview({start, end, previousEnd}: SchedulePreviewProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 5_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const startTime = start === undefined ? null : parseAuctionScheduleTime(start);
  const endTime = parseAuctionScheduleTime(end);
  const startsAt = startTime?.getTime() ?? null;
  const endsAt = endTime?.getTime() ?? NaN;
  const hasSchedule = !!endTime && (start === undefined || !!startTime);
  const previousEndsAt = previousEnd && end !== formatAddisDateTimeLocal(previousEnd) ? Date.parse(previousEnd) : endsAt;
  const change = endsAt - previousEndsAt;

  return <section className={styles.preview} aria-label="Countdown preview">
    <Clock3 className={styles.icon} size={16} aria-hidden="true"/>
    <div><strong>Countdown preview</strong>
      {!hasSchedule ? <p>{start === undefined ? 'Choose an end time to preview the countdown.' : 'Set both times to preview the countdown.'}</p>
        : startsAt !== null && endsAt <= startsAt ? <p>The end time must be after the start time.</p>
        : <>
          <dl>
            {startsAt !== null && startsAt > now && <div><dt>Starts in</dt><dd>{formatDuration(startsAt - now)}</dd></div>}
            {endsAt > now ? <div><dt>Ends in</dt><dd>{formatDuration(endsAt - now)}</dd></div> : <div><dt>Ended</dt><dd>{formatDuration(now - endsAt)} ago</dd></div>}
            {startsAt !== null && <div><dt>Runs for</dt><dd>{formatDuration(endsAt - startsAt)}</dd></div>}
          </dl>
          <p>Ends {formatAddisTimestamp(new Date(endsAt))}{change !== 0 && <span> · {change > 0 ? 'Extends' : 'Shortens'} by {formatDuration(Math.abs(change)).toLowerCase()}</span>}</p>
        </>}
    </div>
  </section>;
}

export function AdminAuctionDeadlineField({endsAt, showPreview}: {endsAt: string; showPreview: boolean}) {
  const [end, setEnd] = useState(() => formatAddisDateTimeLocal(endsAt));
  return <>
    <AdminAuctionDateTimeField label={`New end time · ${ADDIS_ABABA_TIME_LABEL}`} name="endsAt" value={end} onChange={setEnd}/>
    {showPreview && <AdminAuctionSchedulePreview end={end} previousEnd={endsAt}/>}
  </>;
}
