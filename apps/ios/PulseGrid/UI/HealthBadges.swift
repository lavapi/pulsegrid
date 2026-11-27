import SwiftUI

/// Degraded and stopped counts when there are any, else how many are healthy.
struct HealthBadges: View {
    let health: HealthCounts

    var body: some View {
        HStack(spacing: 4) {
            if health.degraded > 0 { StatusBadge(text: "\(health.degraded) degraded", tone: .bad) }
            if health.stopped > 0 { StatusBadge(text: "\(health.stopped) stopped", tone: .warning) }
            StatusBadge(text: "\(health.healthy) healthy", tone: .good)
        }
    }
}
