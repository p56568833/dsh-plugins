/**
 * Single source of truth for the editable facts of `dsh-cost-balance`.
 *
 * Both halves read this module's values: the host half serves the `prices`
 * object to the browser half verbatim, so editing the numbers here is the only
 * place a price change has to happen.
 *
 * Prices are CNY per one million tokens, straight off the official page
 * (https://api-docs.deepseek.com/zh-cn/quick_start/pricing/, read 2026-09-25):
 *
 *   deepseek-flash     cache-hit 0.04 / 0.02   cache-miss 2 / 1   output 8 / 4
 *   deepseek-v4-pro    cache-hit 0.30 / 0.15   cache-miss 9 / 4.5 output 27 / 13.5
 *
 * Off-peak is exactly half of peak. Beijing time Monday-Friday 09:00-12:00 and
 * 14:00-18:00 (excluding Chinese public holidays) is peak; everything else,
 * weekends and holidays included, is off-peak. Holidays are NOT modelled here:
 * a public holiday inside a peak window is priced as peak, which overstates the
 * bill slightly rather than understating it.
 *
 * @module dsh-cost-balance/prices
 */

/** Credential reference whose value authenticates the balance call. */
export const API_KEY_REF = 'DEEPSEEK_API_KEY'

/** DeepSeek's account balance endpoint. */
export const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** How long one successful balance reading is reused, in milliseconds. */
export const BALANCE_CACHE_MS = 30_000

/** Billing tariff definition used to pick the peak or off-peak column. */
export const PEAK_HOURS = {
  timeZone: 'Asia/Shanghai',
  /** ISO weekday numbers counted as working days (1 = Monday). */
  weekdays: [1, 2, 3, 4, 5],
  /** Half-open [startHour, endHour) peak windows in local time. */
  ranges: [[9, 12], [14, 18]],
}

/**
 * Chinese statutory holidays (Beijing dates, `YYYY-MM-DD`) — the days DeepSeek
 * bills at off-peak rates ALL DAY. The official rule is "peak = Beijing
 * Monday-Friday 09:00-12:00 and 14:00-18:00, EXCLUDING Chinese statutory
 * holidays; everything else — weekends and holidays in full — is off-peak",
 * and 调休 makeup workdays that land on a weekend are off-peak too (so plain
 * weekend classification already covers them).
 *
 * Source: 国务院办公厅关于2026年部分节假日安排的通知 (2025-11-04). This list must be
 * replaced when the next year's arrangement is published (usually each
 * November); `HOLIDAY_CALENDAR_YEAR` below is what the UI checks before
 * trusting a date, so a stale calendar degrades to a visible warning rather
 * than to a silently wrong number.
 */
export const HOLIDAYS = [
  // 元旦：1月1日至3日
  '2026-01-01', '2026-01-02', '2026-01-03',
  // 春节：2月15日至23日
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  // 清明节：4月4日至6日
  '2026-04-04', '2026-04-05', '2026-04-06',
  // 劳动节：5月1日至5日
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  // 端午节：6月19日至21日
  '2026-06-19', '2026-06-20', '2026-06-21',
  // 中秋节：9月25日至27日
  '2026-09-25', '2026-09-26', '2026-09-27',
  // 国庆节：10月1日至7日
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07',
]

/** Calendar year {@link HOLIDAYS} is complete for. */
export const HOLIDAY_CALENDAR_YEAR = 2026

/** Serialized tariff policy served to the browser half. */
export const TARIFF_POLICY = {
  peakHours: PEAK_HOURS,
  holidays: HOLIDAYS,
  calendarYear: HOLIDAY_CALENDAR_YEAR,
  holidaySource: '国务院办公厅关于2026年部分节假日安排的通知',
}

/** The served price table. */
export const PRICES = {
  currency: 'CNY',
  /** Price unit: every `peak`/`offPeak` number below is CNY per this many tokens. */
  unit: 1_000_000,
  /** Model used when the selected model has no row. */
  fallbackModel: 'deepseek-flash',
  /** Top-level numbers per exact model id. */
  models: {
    'deepseek-flash': {
      label: 'DeepSeek-V4.1-Flash',
      cacheHit: { peak: 0.04, offPeak: 0.02 },
      cacheMiss: { peak: 2, offPeak: 1 },
      output: { peak: 8, offPeak: 4 },
    },
    'deepseek-v4-pro': {
      label: 'DeepSeek-V4-Pro',
      cacheHit: { peak: 0.30, offPeak: 0.15 },
      cacheMiss: { peak: 9, offPeak: 4.5 },
      output: { peak: 27, offPeak: 13.5 },
    },
  },
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  updatedAt: '2026-09-25',
}

/**
 * Wall-clock parts of one instant in a named time zone.
 * @param date - instant to decompose.
 * @param timeZone - IANA zone name.
 * @returns local hour (0-23), ISO weekday (1-7), and `YYYY-MM-DD`.
 */
export function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? ''
  const weekdayName = pick('weekday') || 'Mon'
  const hour = Number(pick('hour') || '0')
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return {
    hour: hour === 24 ? 0 : hour,
    weekday: weekdays.indexOf(weekdayName) + 1,
    dateKey: `${pick('year')}-${pick('month')}-${pick('day')}`,
  }
}

/**
 * Whether one instant is a Beijing statutory holiday.
 * @param date - instant to test.
 * @returns true when the whole day bills at off-peak rates.
 */
export function isHoliday(date) {
  return HOLIDAYS.includes(zonedParts(date, PEAK_HOURS.timeZone).dateKey)
}

/**
 * Which tariff column the current instant falls in.
 *
 * Off-peak covers three cases: a Chinese statutory holiday (the whole day), a
 * weekend, and any hour outside the two peak windows. Only a plain Beijing
 * working day inside 09:00-12:00 or 14:00-18:00 bills at peak rates — which is
 * why a session that runs on a holiday is half the price of the same session
 * on an ordinary Friday.
 *
 * @param now - instant to classify.
 * @returns 'peak' or 'offPeak'.
 */
export function tariffAt(now = new Date()) {
  const { hour, weekday, dateKey } = zonedParts(now, PEAK_HOURS.timeZone)
  if (HOLIDAYS.includes(dateKey)) return 'offPeak'
  if (!PEAK_HOURS.weekdays.includes(weekday)) return 'offPeak'
  return PEAK_HOURS.ranges.some(([from, to]) => hour >= from && hour < to) ? 'peak' : 'offPeak'
}
