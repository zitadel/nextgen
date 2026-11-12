// Turns the server's exported metrics into Vercel custom metrics. Vercel takes
// a metric as single data points, `metric(name, value, attributes)`, each
// tied to the function invocation that reports it and aggregated when it is
// queried; the server exports OTLP, where a data point is already an
// aggregate. The launcher asks the SDK for delta temporality, so every export
// carries what happened since the last one, and each kind is replayed as the
// data points that aggregate back to it:
//
// - a counter (delta sum): one data point with the increase. Query its sum.
// - a histogram (delta): one data point per recorded value. The export keeps
//   only the bucket a value fell into, so a value is replayed as the middle of
//   its bucket, within the point's min and max; where the values share one
//   bucket, as their mean, which keeps the sum exact. Query percentiles.
// - a gauge or an up-down counter (the SDK keeps the latter cumulative, so it
//   is the current level): one data point when the level changed, and again
//   every levelRepeatMs, so a steady level stays on a chart without a data
//   point per export. Query its average or maximum.
//
// A cumulative counter is turned into its increase; a cumulative or
// exponential histogram and a summary have no replay and are counted in
// `unsupported`.
//
// Data points wait in a queue until a request takes them (take): Vercel
// accepts 100 per invocation, and each is billed as one Observability event.
// The queue is bounded; past maxQueued the oldest are dropped and counted.

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

function attributesOf(point) {
  const attributes = {};
  let kept = 0;
  for (const { key, value } of point.attributes ?? []) {
    const text = scalar(value);
    if (key === "" || text === undefined || text === "" || kept === maxAttributes) {
      continue;
    }
    attributes[clip(key)] = clip(text);
    kept++;
  }
  return attributes;
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
  #queue = [];
  // Per series: the last cumulative counter value, or the last level sent.
  #series = new Map();
  #maxQueued;
  #levelRepeatMs;
  #now;
  dropped = 0;
  unsupported = 0;

  constructor({ maxQueued = 2000, levelRepeatMs = 60_000, now = Date.now } = {}) {
    this.#maxQueued = maxQueued;
    this.#levelRepeatMs = levelRepeatMs;
    this.#now = now;
  }

  #push(name, value, attributes) {
    if (!Number.isFinite(value)) {
      return;
    }
    this.#queue.push({ name, value, attributes });
    if (this.#queue.length > this.#maxQueued) {
      this.#queue.shift();
      this.dropped++;
    }
  }

  #level(name, point) {
    if (point.value === undefined) {
      return;
    }
    const attributes = attributesOf(point);
    const key = seriesKey(name, attributes);
    const last = this.#series.get(key);
    const now = this.#now();
    if (last && last.value === point.value && now - last.at < this.#levelRepeatMs) {
      return;
    }
    this.#series.set(key, { value: point.value, at: now });
    this.#push(name, point.value, attributes);
  }

  #increase(name, point, temporality) {
    if (point.value === undefined) {
      return;
    }
    const attributes = attributesOf(point);
    let increase = point.value;
    if (temporality === CUMULATIVE) {
      const key = seriesKey(name, attributes);
      const last = this.#series.get(key);
      this.#series.set(key, { value: point.value });
      // A smaller value is a restarted counter: all of it is new.
      increase = last && point.value >= last.value ? point.value - last.value : point.value;
    }
    if (increase !== 0) {
      this.#push(name, increase, attributes);
    }
  }

  /** Queues the data points of one export (decodeMetricsRequest's result). */
  ingest(request) {
    for (const rm of request.resourceMetrics ?? []) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const metric of sm.metrics ?? []) {
          const name = clip(metric.name);
          if (name === "") {
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
              const attributes = attributesOf(point);
              for (const value of histogramValues(point)) {
                this.#push(name, value, attributes);
              }
            }
          } else {
            this.unsupported++;
          }
        }
      }
    }
  }

  /** Removes and returns up to max queued data points, oldest first. */
  take(max) {
    return this.#queue.splice(0, max);
  }

  get queued() {
    return this.#queue.length;
  }
}
