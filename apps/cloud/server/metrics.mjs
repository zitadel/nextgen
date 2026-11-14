// Turns the server's exported metrics into Vercel custom metrics, as an
// OpenTelemetry collector in front of a backend would: it takes the server's
// frequent exports, aggregates them, and sends less often. Vercel takes a
// metric as single data points, `metric(name, value, attributes)`, each tied
// to the function invocation that reports it and aggregated when it is
// queried; the server exports OTLP, where a data point is already an
// aggregate. The launcher asks the SDK for delta temporality, so every export
// carries what happened since the last one, and each kind becomes the data
// points that aggregate back to it:
//
// - a counter (delta sum): its increases are added up per series, and sent as
//   one data point however many exports raised it. Query its sum.
// - a gauge or an up-down counter (the SDK keeps the latter cumulative, so it
//   is the current level): per series, the highest level since it was last
//   sent. A level that rose above what was sent goes with the next data
//   points; one that fell or stayed is sent every levelRepeatMs, so a peak is
//   never missed, a steady level stays on a chart, and a level that moves on
//   every request costs a data point a minute, not one per request. Query
//   its maximum.
// - a histogram (delta): one data point per recorded value, because Vercel has
//   no data point that stands for several values. The export keeps only the
//   bucket a value fell into, so a value is sent as the middle of its bucket,
//   within the point's min and max; where the values share one bucket, as
//   their mean, which keeps the sum exact. Query percentiles.
//
// A cumulative counter is turned into its increase; a cumulative or
// exponential histogram and a summary have no replay and are counted in
// `unsupported`.
//
// Data points wait until a request takes them (take): Vercel accepts 100 per
// invocation, and each is billed as one Observability event. The wrapper
// takes them when the instance is about to go idle, or once the oldest has
// waited long enough (age), so a busy instance sends a counter once per
// interval, not once per request. The histogram values held are bounded; past
// maxQueued the oldest are dropped and counted.
//
// Vercel bills every data point ($1.20 per million, each one Observability
// event) and has no sampling for custom metrics, so only the instruments
// named here are sent, and one the server adds later is not sent until it is.
// An instrument belongs here when both hold:
//
// - Nothing else in Vercel tells it. A span's duration and count are queried
//   as vercel.span.duration_ms by span name, route and status, and requests
//   by path and status as vercel.request.count.
// - It is not recorded on every request. Requests that do not overlap each
//   send what they recorded, so such a counter is a data point per request.
//
// So no histogram is sent: it is a data point per recorded value, and the
// spans carry the durations. Nor are the counters every request raises
// (zitadel.audit.events.written, zitadel.auth.token.revocation_checks,
// zitadel.cache.lookups), which their spans count, or the request and
// statement instruments (ogen.server.*, db.client.operation.duration). What
// is left is what only a metric says: how sign-ins and flows end, and how
// close the connection pool and the password hashing are to their limits.
const reportedInstruments = new Set([
  "db.client.connection.count",
  "zitadel.auth.attempt.outcomes",
  "zitadel.cache.evictions",
  "zitadel.flow.step.transitions",
  "zitadel.password_hashing.in_flight",
  "zitadel.password_hashing.rejected",
  "zitadel.password_hashing.waiting",
]);

function reported(name) {
  return reportedInstruments.has(name);
}

const DELTA = 1;
const CUMULATIVE = 2;

// Vercel: names, attribute names and attribute values are "non-empty and
// shorter than 64 bytes"; a longer one is cut here rather than dropped there.
const maxBytes = 63;
const maxAttributes = 50;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function clip(value) {
  const bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) {
    return value;
  }
  // Cut on a character boundary: drop a trailing partial sequence.
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end--;
  }
  return decoder.decode(bytes.subarray(0, end));
}

function scalar(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return String(value.boolValue);
  if (value.intValue !== undefined) return String(value.intValue);
  if (value.doubleValue !== undefined) return String(value.doubleValue);
  return undefined;
}

// A data point's attributes with the ones every data point carries (always),
// which count toward Vercel's limit and replace its own of the same name.
function attributesOf(point, always) {
  const attributes = {};
  let kept = Object.keys(always).length;
  for (const { key, value } of point.attributes ?? []) {
    const text = scalar(value);
    if (key === "" || text === undefined || text === "" || kept === maxAttributes) {
      continue;
    }
    const name = clip(key);
    if (Object.hasOwn(always, name)) {
      continue;
    }
    attributes[name] = clip(text);
    kept++;
  }
  return Object.assign(attributes, always);
}

/**
 * What every data point of this deployment carries beside its own attributes:
 * its environment (production, preview). Vercel attaches the deployment, the
 * region and the request to a custom metric but not the environment, which
 * its own metrics have, so without it a chart of sign-ins mixes every preview
 * with production. Under the name Vercel's own metrics use, one filter,
 * `environment:production`, selects these as it does those.
 */
export function deploymentAttributes(env) {
  return env.VERCEL_ENV ? { environment: clip(env.VERCEL_ENV) } : {};
}

function seriesKey(name, attributes) {
  return `${name}\u0000${Object.keys(attributes)
    .sort()
    .map((key) => `${key}\u0001${attributes[key]}`)
    .join("\u0000")}`;
}

// The values a histogram data point stands for, one per recorded value.
function histogramValues(point) {
  const { count, sum, min, max } = point;
  const counts = point.bucketCounts ?? [];
  const bounds = point.explicitBounds ?? [];
  const filled = counts.filter((bucket) => bucket > 0).length;
  if (count > 0 && sum !== undefined && filled <= 1) {
    return new Array(count).fill(sum / count);
  }
  const values = [];
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] === 0) {
      continue;
    }
    // Bucket i holds (bounds[i-1], bounds[i]]; the first and last are open.
    let low = i === 0 ? (min ?? Math.min(0, bounds[0] ?? 0)) : bounds[i - 1];
    let high = i < bounds.length ? bounds[i] : (max ?? bounds[bounds.length - 1] ?? low);
    if (min !== undefined) low = Math.max(low, min);
    if (max !== undefined) high = Math.min(high, max);
    const value = high >= low ? (low + high) / 2 : low;
    for (let n = 0; n < counts[i]; n++) {
      values.push(value);
    }
  }
  return values;
}

export class MetricQueue {
  // Counter increases waiting to be sent, one entry per series.
  #increases = new Map();
  // Levels, one entry per series: the highest since it was last sent (peak,
  // undefined when none arrived since), and what was sent and when.
  #levels = new Map();
  // Histogram values waiting to be sent, one entry per value.
  #values = [];
  // Per series: the last cumulative counter value.
  #counters = new Map();
  // When the oldest waiting data point arrived.
  #since = null;
  #maxQueued;
  #levelRepeatMs;
  #now;
  #reported;
  #always;
  dropped = 0;
  unsupported = 0;

  constructor({
    maxQueued = 2000,
    levelRepeatMs = 60_000,
    now = Date.now,
    isReported = reported,
    attributes = {},
  } = {}) {
    this.#reported = isReported;
    this.#always = attributes;
    this.#maxQueued = maxQueued;
    this.#levelRepeatMs = levelRepeatMs;
    this.#now = now;
  }

  #arrived() {
    this.#since ??= this.#now();
  }

  // Whether a level rose above what was last sent, or was never sent.
  #risen(level) {
    return level.peak !== undefined && (level.sent === undefined || level.peak > level.sent);
  }

  #due(level, now) {
    return (
      level.peak !== undefined && (this.#risen(level) || now - level.sentAt >= this.#levelRepeatMs)
    );
  }

  #level(name, point) {
    if (!Number.isFinite(point.value)) {
      return;
    }
    const attributes = attributesOf(point, this.#always);
    const key = seriesKey(name, attributes);
    const level = this.#levels.get(key) ?? {
      name,
      attributes,
      peak: undefined,
      sent: undefined,
      sentAt: 0,
    };
    level.peak = level.peak === undefined ? point.value : Math.max(level.peak, point.value);
    this.#levels.set(key, level);
    // Only a rise waits to be sent; a fall or a steady level goes along when
    // it is due.
    if (this.#risen(level)) {
      this.#arrived();
    }
  }

  #increase(name, point, temporality) {
    if (!Number.isFinite(point.value)) {
      return;
    }
    const attributes = attributesOf(point, this.#always);
    const key = seriesKey(name, attributes);
    let increase = point.value;
    if (temporality === CUMULATIVE) {
      const last = this.#counters.get(key);
      this.#counters.set(key, { value: point.value });
      // A smaller value is a restarted counter: all of it is new.
      increase = last && point.value >= last.value ? point.value - last.value : point.value;
    }
    if (increase === 0) {
      return;
    }
    const waiting = this.#increases.get(key);
    if (waiting) {
      waiting.value += increase;
      return;
    }
    this.#increases.set(key, { name, value: increase, attributes });
    this.#arrived();
  }

  #value(name, value, attributes) {
    if (!Number.isFinite(value)) {
      return;
    }
    this.#values.push({ name, value, attributes });
    this.#arrived();
    if (this.#values.length > this.#maxQueued) {
      this.#values.shift();
      this.dropped++;
    }
  }

  /** Takes in the data points of one export (decodeMetricsRequest's result). */
  ingest(request) {
    for (const rm of request.resourceMetrics ?? []) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const metric of sm.metrics ?? []) {
          const name = clip(metric.name);
          if (name === "" || !this.#reported(metric.name)) {
            continue;
          }
          if (metric.gauge) {
            for (const point of metric.gauge.dataPoints) {
              this.#level(name, point);
            }
          } else if (metric.sum) {
            for (const point of metric.sum.dataPoints) {
              if (metric.sum.isMonotonic) {
                this.#increase(name, point, metric.sum.aggregationTemporality);
              } else if (metric.sum.aggregationTemporality === DELTA) {
                // A delta up-down counter would need the level it changes.
                this.unsupported++;
              } else {
                this.#level(name, point);
              }
            }
          } else if (metric.histogram?.aggregationTemporality === DELTA) {
            for (const point of metric.histogram.dataPoints) {
              const attributes = attributesOf(point, this.#always);
              for (const value of histogramValues(point)) {
                this.#value(name, value, attributes);
              }
            }
          } else {
            this.unsupported++;
          }
        }
      }
    }
  }

  /**
   * Removes and returns up to max data points: the counters, one per series,
   * then the levels that are due, then the histogram values, oldest first.
   */
  take(max) {
    const taken = [];
    for (const [key, point] of this.#increases) {
      if (taken.length === max) {
        break;
      }
      this.#increases.delete(key);
      taken.push(point);
    }
    const now = this.#now();
    for (const level of this.#levels.values()) {
      if (taken.length === max) {
        break;
      }
      if (this.#due(level, now)) {
        taken.push({ name: level.name, value: level.peak, attributes: level.attributes });
        level.sent = level.peak;
        level.sentAt = now;
        level.peak = undefined;
      }
    }
    taken.push(...this.#values.splice(0, max - taken.length));
    // What is left has waited as long; it goes with the next request.
    if (this.#waiting() === 0) {
      this.#since = null;
    }
    return taken;
  }

  // What waits to be sent: a level only while it has risen.
  #waiting() {
    let risen = 0;
    for (const level of this.#levels.values()) {
      if (this.#risen(level)) {
        risen++;
      }
    }
    return this.#increases.size + this.#values.length + risen;
  }

  /** How long the oldest waiting data point has waited, in milliseconds. */
  get age() {
    return this.#since === null ? 0 : this.#now() - this.#since;
  }

  /** How many data points take would hand out now, given room. */
  get queued() {
    const now = this.#now();
    let due = 0;
    for (const level of this.#levels.values()) {
      if (this.#due(level, now)) {
        due++;
      }
    }
    return this.#increases.size + this.#values.length + due;
  }
}
