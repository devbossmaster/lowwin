'use client';

import {useEffect, useState} from 'react';
import {Clock3} from 'lucide-react';
import {ADDIS_ABABA_TIME_LABEL, formatAddisDateTimeLocal, formatAddisTimestamp, parseAddisDateTimeLocal} from '@/lib/addis-time';
import {countdownUnits} from '@/lib/countdown-units';
import {AdminDateTimeField} from './admin-date-time-field';
import styles from './admin-auction-schedule-preview.module.css';

export {AdminDateTimeField as AdminAuctionDateTimeField};

const timePattern = '(?:[01][0-9]|2[0-3]):[0-5][0-9]';
const schedulePattern = new RegExp(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T${timePattern}$`);

export function parseAuctionScheduleTime(value: string) {
  if (!schedulePattern.test(value)) return null;
  const instant = parseAddisDateTimeLocal(value);
  return Number.isFinite(instant.getTime()) && formatAddisDateTimeLocal(instant) === value ? instant : null;
}

function formatDuration(milliseconds: number) {
  const [days, hours, minutes] = countdownUnits(milliseconds).map(Number);
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || 'Under 1 min';
}

type SchedulePreviewProps = {
  start?: string;
  end: string;
  previousStart?: string;
  previousEnd?: string;
};

export function AdminAuctionSchedulePreview({start, end, previousStart, previousEnd}: SchedulePreviewProps) {
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
  const advance = startTime && previousStart && start !== formatAddisDateTimeLocal(previousStart)
    ? Date.parse(previousStart) - startTime.getTime() : 0;
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
          {startTime && previousStart && <p>Starts {formatAddisTimestamp(startTime)}{advance > 0 && <span> · {formatDuration(advance).toLowerCase()} earlier</span>}</p>}
          <p>Ends {formatAddisTimestamp(new Date(endsAt))}{change !== 0 && <span> · {change > 0 ? 'Extends' : 'Shortens'} by {formatDuration(Math.abs(change)).toLowerCase()}</span>}</p>
        </>}
    </div>
  </section>;
}

export function AdminAuctionDeadlineField({endsAt, showPreview}: {endsAt: string; showPreview: boolean}) {
  const [end, setEnd] = useState(() => formatAddisDateTimeLocal(endsAt));
  return <>
    <AdminDateTimeField label={`New end time · ${ADDIS_ABABA_TIME_LABEL}`} name="endsAt" value={end} onChange={setEnd}/>
    {showPreview && <AdminAuctionSchedulePreview end={end} previousEnd={endsAt}/>}
  </>;
}

export function AdminAuctionStartField({startsAt, endsAt}: {startsAt: string; endsAt: string}) {
  const [start, setStart] = useState(() => formatAddisDateTimeLocal(startsAt));
  return <>
    <AdminDateTimeField label={`New start time · ${ADDIS_ABABA_TIME_LABEL}`} name="startsAt" value={start} onChange={setStart}/>
    <AdminAuctionSchedulePreview start={start} end={formatAddisDateTimeLocal(endsAt)} previousStart={startsAt}/>
  </>;
}
