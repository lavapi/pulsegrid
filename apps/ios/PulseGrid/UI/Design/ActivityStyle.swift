import SwiftUI

/// The icon for an activity entry, by the area its action belongs to, such as "pipeline.run_started".
enum ActivityStyle {
    static func of(action: String) -> (symbol: String, color: Color) {
        switch action.split(separator: ".").first.map(String.init) ?? "" {
        case "auth": ("person.badge.key.fill", .blue)
        case "cloud": ("cloud.fill", .cyan)
        case "pipeline": ("arrow.triangle.pull", .indigo)
        case "database_access": ("cylinder.split.1x2.fill", .blue)
        case "production": ("flag.checkered", .orange)
        case "team", "people", "roles": ("person.2.fill", .teal)
        case "integrations", "git": ("puzzlepiece.extension.fill", .purple)
        default: ("clock.fill", .gray)
        }
    }
}

/// A pipeline's or job's status as an icon, pulsing while it runs.
struct PipelineStatusIcon: View {
    let status: String

    private var style: (symbol: String, color: Color) {
        switch status {
        case "success": ("checkmark.circle.fill", .green)
        case "failure": ("xmark.octagon.fill", .red)
        case "running": ("arrow.triangle.2.circlepath.circle.fill", .blue)
        case "queued": ("clock.fill", .gray)
        case "cancelled": ("minus.circle.fill", .orange)
        default: ("circle.dashed", .gray)
        }
    }

    var body: some View {
        Image(systemName: style.symbol)
            .font(.title2)
            .foregroundStyle(style.color)
            .symbolEffect(.pulse, isActive: status == "running")
            .accessibilityLabel(status.sentenceCased)
    }
}

/// A branch name in a small monospaced tag.
struct BranchTag: View {
    let branch: String

    var body: some View {
        Label(branch, systemImage: "arrow.branch")
            .labelStyle(.titleAndIcon)
            .font(.caption.monospaced())
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color(.tertiarySystemFill), in: .capsule)
    }
}
