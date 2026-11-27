import SwiftUI
import WidgetKit

/// Reads the snapshot the app saved when Home last loaded; the app asks for a reload each time it saves one.
struct SnapshotProvider: TimelineProvider {
    struct Entry: TimelineEntry {
        let date: Date
        let snapshot: WidgetSnapshot?
    }

    private static let sample = WidgetSnapshot(account: "Production", healthy: 12, degraded: 1, stopped: 1, total: 14, needsYou: 2, savedAt: .now)

    func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: Self.sample) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now, snapshot: context.isPreview ? Self.sample : WidgetSnapshot.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now, snapshot: WidgetSnapshot.read())], policy: .never))
    }
}

/// The account's health as a ring, on the Home Screen and the Lock Screen.
struct HealthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "health", provider: SnapshotProvider()) { entry in
            HealthWidgetView(snapshot: entry.snapshot)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Health")
        .description("How much of your account is healthy.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

/// How many things wait on the person.
struct NeedsYouWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "needs-you", provider: SnapshotProvider()) { entry in
            NeedsYouWidgetView(snapshot: entry.snapshot)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Needs you")
        .description("Releases, requests and problems waiting on you.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

private func color(of snapshot: WidgetSnapshot) -> Color {
    snapshot.degraded > 0 ? .red : snapshot.stopped > 0 ? .orange : .green
}

private struct HealthWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot?

    var body: some View {
        if let snapshot {
            switch family {
            case .accessoryCircular:
                Gauge(value: snapshot.healthyShare) { Image(systemName: "waveform.path.ecg") } currentValueLabel: {
                    Text(snapshot.healthyShare, format: .percent.precision(.fractionLength(0)))
                }
                .gaugeStyle(.accessoryCircularCapacity)
            case .accessoryRectangular:
                VStack(alignment: .leading) {
                    Text(snapshot.account).font(.headline).widgetAccentable()
                    Text("\(snapshot.healthy) of \(snapshot.total) healthy")
                    if snapshot.degraded > 0 { Text("\(snapshot.degraded) degraded") }
                }
            default:
                VStack(alignment: .leading, spacing: 6) {
                    Text(snapshot.account).font(.caption.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(snapshot.healthyShare, format: .percent.precision(.fractionLength(0)))
                        .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(color(of: snapshot))
                    Text(snapshot.degraded > 0 ? "\(snapshot.degraded) degraded" : snapshot.stopped > 0 ? "\(snapshot.stopped) stopped" : "All healthy")
                        .font(.caption.weight(.medium))
                    Text(snapshot.savedAt, style: .relative).font(.caption2).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            Text("Open PulseGrid to see your health here.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct NeedsYouWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot?

    var body: some View {
        if let snapshot {
            switch family {
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Text(snapshot.needsYou, format: .number).font(.title2.weight(.bold))
                        Image(systemName: "bell.fill").font(.caption2)
                    }
                }
            default:
                VStack(alignment: .leading, spacing: 6) {
                    Text("Needs you").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    Text(snapshot.needsYou, format: .number)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .foregroundStyle(snapshot.needsYou > 0 ? Color.orange : Color.green)
                    Text(snapshot.needsYou == 0 ? "All clear" : snapshot.needsYou == 1 ? "thing waiting" : "things waiting").font(.caption.weight(.medium))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            Text("Open PulseGrid to see what's waiting.").font(.caption).foregroundStyle(.secondary)
        }
    }
}
