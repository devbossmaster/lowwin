'use client';

import {useEffect, useState} from 'react';
import {Clock3} from 'lucide-react';
import {ADDIS_ABABA_TIME_LABEL, formatAddisDateTimeLocal, formatAddisTimestamp, parseAddisDateTimeLocal} from '@/lib/addis-time';
import {countdownUnits} from '@/lib/countdown-units';
import styles from './admin-auction-schedule-preview.module.css';

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

  const startsAt = start === undefined ? null : parseAddisDateTimeLocal(start).getTime();
  const endsAt = parseAddisDateTimeLocal(end).getTime();
  const hasSchedule = Number.isFinite(endsAt) && (startsAt === null || Number.isFinite(startsAt));
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
    <label>New end time · {ADDIS_ABABA_TIME_LABEL}<input name="endsAt" type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} required/></label>
    {showPreview && <AdminAuctionSchedulePreview end={end} previousEnd={endsAt}/>}
  </>;
}
