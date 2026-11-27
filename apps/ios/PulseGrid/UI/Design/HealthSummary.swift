import SwiftUI

/// The account at a glance: a ring for the share of healthy services, and the counts beside it.
struct HealthSummary: View {
    let health: HealthCounts

    private var healthyShare: Double { health.total == 0 ? 1 : Double(health.healthy) / Double(health.total) }
    private var tone: Tone { health.degraded > 0 ? .bad : health.stopped > 0 ? .warning : .good }

    var body: some View {
        HStack(spacing: 18) {
            Gauge(value: healthyShare) {
                Text("Healthy")
            } currentValueLabel: {
                Text(healthyShare, format: .percent.precision(.fractionLength(0)))
                    .font(.caption.weight(.semibold).monospacedDigit())
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(tone.color)
            .scaleEffect(1.15)
            .accessibilityLabel("\(Int((healthyShare * 100).rounded())) percent of services healthy")

            HStack(spacing: 0) {
                Count(value: health.healthy, label: "Healthy", tone: .good)
                Divider().frame(height: 36)
                Count(value: health.degraded, label: "Degraded", tone: health.degraded > 0 ? .bad : .neutral)
                Divider().frame(height: 36)
                Count(value: health.stopped, label: "Stopped", tone: health.stopped > 0 ? .warning : .neutral)
            }
        }
        .padding(.vertical, 6)
    }

    private struct Count: View {
        let value: Int
        let label: String
        let tone: Tone

        var body: some View {
            VStack(spacing: 2) {
                Text(value, format: .number)
                    .font(.title2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(value > 0 ? tone.color : .secondary)
                    .contentTransition(.numericText())
                Text(label).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
        }
    }
}

extension HealthCounts {
    /// Several categories' counts added up.
    static func sum(_ counts: [HealthCounts]) -> HealthCounts {
        HealthCounts(
            healthy: counts.reduce(0) { $0 + $1.healthy },
            degraded: counts.reduce(0) { $0 + $1.degraded },
            stopped: counts.reduce(0) { $0 + $1.stopped },
            unknown: counts.reduce(0) { $0 + $1.unknown },
            total: counts.reduce(0) { $0 + $1.total }
        )
    }
}
