import ActivityKit
import SwiftUI
import WidgetKit

/// A release waiting for a decision, or database access running out, counting down on the Lock Screen
/// and in the Dynamic Island.
struct CountdownActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PulseGridActivity.self) { context in
            LockScreenCountdown(attributes: context.attributes, state: context.state)
                .padding(16)
                .activityBackgroundTint(Color(.systemBackground).opacity(0.6))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.attributes.symbol).font(.title2).foregroundStyle(activityColor(context.attributes.kind))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(state: context.state).font(.title2.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title).font(.headline)
                        Text(context.attributes.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: context.attributes.symbol).foregroundStyle(activityColor(context.attributes.kind))
            } compactTrailing: {
                Countdown(state: context.state).frame(maxWidth: 56)
            } minimal: {
                Image(systemName: context.attributes.symbol).foregroundStyle(activityColor(context.attributes.kind))
            }
            .keylineTint(activityColor(context.attributes.kind))
        }
    }
}

private func activityColor(_ kind: PulseGridActivity.Kind) -> Color {
    switch kind {
    case .productionRelease: .orange
    case .databaseAccess: .indigo
    }
}

private struct LockScreenCountdown: View {
    let attributes: PulseGridActivity
    let state: PulseGridActivity.ContentState

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: attributes.symbol)
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(activityColor(attributes.kind).gradient, in: .rect(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(attributes.title).font(.headline).lineLimit(1)
                Text(attributes.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(attributes.endsWith).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Countdown(state: state).font(.title.weight(.bold)).foregroundStyle(activityColor(attributes.kind))
        }
    }
}

private struct Countdown: View {
    let state: PulseGridActivity.ContentState

    var body: some View {
        Text(timerInterval: state.startsAt...state.endsAt, countsDown: true)
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
    }
}
