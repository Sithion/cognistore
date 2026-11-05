import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DayPicker, type DateRange as PickerDateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button.js';
import { segment, segmentGroup } from './ui/nav-styles.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';
import { api } from '../api/client.js';
import { useAppDispatch, useAppSelector } from '../store/index.js';
import { hydrateRange, rangeForPreset, setCustomRange, setPreset, type DateRange, type DateRangePreset } from '../store/dateRange.js';

type StandardPreset = Exclude<DateRangePreset, 'custom'>;
const PRESETS: { key: StandardPreset; labelKey: string; label: string }[] = [
  { key: '1d', labelKey: 'dateRange.1d', label: '1 day' },
  { key: '1w', labelKey: 'dateRange.1w', label: '1 week' },
  { key: '1m', labelKey: 'dateRange.1m', label: '1 month' },
  { key: '1y', labelKey: 'dateRange.1y', label: '1 year' },
  { key: '2y', labelKey: 'dateRange.2y', label: '2 years' },
];

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function urlRange(search: string): { preset: DateRangePreset; range: DateRange } | null {
  const params = new URLSearchParams(search);
  const presetValue = params.get('preset');
  const from = params.get('from');
  const to = params.get('to');
  if (presetValue === null && from === null && to === null) return null;
  if (presetValue === 'custom') {
    const fromDate = validDate(from);
    const toDate = validDate(to);
    if (!fromDate || !toDate || fromDate > toDate) return null;
    return { preset: 'custom', range: { from: fromDate.toISOString(), to: toDate.toISOString() } };
  }
  if (PRESETS.some(({ key }) => key === presetValue)) {
    const preset = presetValue as StandardPreset;
    const range = rangeForPreset(preset);
    return { preset, range };
  }
  return null;
}

function formatLabel(from: string, to: string): string {
  const f = new Date(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const t = new Date(to).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${f} – ${t}`;
}

function toLocalDayISO(date: Date, endOfDay: boolean): string {
  const local = new Date(date);
  local.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return local.toISOString();
}

/** Shared date control. URL values take precedence over saved defaults. */
export function DateRangeControl() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { preset, range } = useAppSelector((state) => state.dateRange);
  const location = useLocation();
  const navigate = useNavigate();
  const hydrated = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PickerDateRange | undefined>();
  const [feedback, setFeedback] = useState('');
  const currentUrlRange = useRef(urlRange(location.search));

  const writeUrl = useCallback((nextPreset: DateRangePreset, nextRange: DateRange) => {
    const params = new URLSearchParams(location.search);
    params.set('preset', nextPreset);
    params.set('from', nextRange.from);
    params.set('to', nextRange.to);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: false });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    currentUrlRange.current = urlRange(location.search);
    const params = new URLSearchParams(location.search);
    if (params.has('preset') || params.has('from') || params.has('to')) {
      const parsed = currentUrlRange.current;
      if (parsed) {
        setFeedback('');
        if (parsed.preset === 'custom') dispatch(setCustomRange(parsed.range));
        else dispatch(setPreset(parsed.preset));
      } else {
        setFeedback('Invalid date range in URL. Showing the default range.');
        dispatch(setPreset('1w'));
      }
    }
  }, [dispatch, location.search]);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    api.getSettings()
      .then((settings) => {
        if (currentUrlRange.current) return;
        const params = new URLSearchParams(window.location.search);
        if (params.has('preset') || params.has('from') || params.has('to')) return;
        dispatch(hydrateRange({ preset: settings.dateRangePreset, range: settings.lastSelectedRange }));
      })
      .catch(() => {});
  }, [dispatch]);

  const persist = (nextPreset: DateRangePreset, nextRange: DateRange) => {
    void api.updateSettings({ dateRangePreset: nextPreset, lastSelectedRange: nextPreset === 'custom' ? nextRange : null }).catch(() => {});
  };

  const applyPreset = (key: StandardPreset) => {
    const nextRange = rangeForPreset(key);
    dispatch(setPreset(key));
    writeUrl(key, nextRange);
    persist(key, nextRange);
  };

  const applyCustom = () => {
    if (!draft?.from || !draft.to) return;
    const nextRange = { from: toLocalDayISO(draft.from, false), to: toLocalDayISO(draft.to, true) };
    dispatch(setCustomRange(nextRange));
    writeUrl('custom', nextRange);
    persist('custom', nextRange);
    setOpen(false);
  };

  const initialSelection: PickerDateRange = { from: new Date(range.from), to: new Date(range.to) };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> would add default border/padding to the compact preset bar
    <div role="group" aria-label="Date range" className={segmentGroup}>
      {PRESETS.map(({ key, labelKey, label }) => (
        <button key={key} type="button" className={segment(preset === key)} aria-label={label} aria-pressed={preset === key} onClick={() => applyPreset(key)}>
          {t(labelKey)}
        </button>
      ))}
      <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) setDraft(initialSelection); }}>
        <PopoverTrigger asChild>
          <button type="button" className={segment(preset === 'custom')} aria-label="Custom range" aria-pressed={preset === 'custom'}>
            {preset === 'custom' ? formatLabel(range.from, range.to) : t('dateRange.custom')}
          </button>
        </PopoverTrigger>
        <PopoverContent role="dialog" aria-label="Custom date range" align="end" className="w-auto p-3">
          <DayPicker mode="range" defaultMonth={initialSelection.from} selected={draft} onSelect={setDraft} numberOfMonths={2} />
          <Button type="button" className="mt-2 w-full" disabled={!draft?.from || !draft.to} onClick={applyCustom}>Apply range</Button>
        </PopoverContent>
      </Popover>
      {feedback && <p role="alert" className="basis-full text-sm text-destructive">{feedback}</p>}
    </div>
  );
}
