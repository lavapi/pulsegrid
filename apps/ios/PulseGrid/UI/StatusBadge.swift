import SwiftUI

enum Tone {
    case good, warning, bad, neutral, active

    var color: Color {
        switch self {
        case .good: .green
        case .warning: .orange
        case .bad: .red
        case .neutral: .secondary
        case .active: .blue
        }
    }

    static func ofRelease(_ state: String) -> Tone {
        switch state {
        case "ready": .good
        case "building", "deploying": .active
        case "failed": .bad
        case "cancelled": .warning
        default: .neutral
        }
    }

    static func ofHealth(_ health: String) -> Tone {
        switch health {
        case "healthy": .good
        case "degraded": .bad
        case "stopped": .warning
        default: .neutral
        }
    }

    static func ofActionRun(_ status: String) -> Tone {
        switch status {
        case "succeeded": .good
        case "running": .active
        case "failed", "timed_out": .bad
        default: .warning
        }
    }

    static func ofTestResult(_ result: String) -> Tone {
        switch result {
        case "passed": .good
        case "failed": .bad
        case "stopped": .warning
        case "running": .active
        default: .neutral
        }
    }

    static func ofPipeline(_ status: String) -> Tone {
        switch status {
        case "success": .good
        case "running", "queued": .active
        case "failure": .bad
        case "cancelled": .warning
        default: .neutral
        }
    }
}

/// A short status in a tinted capsule with a dot, which pulses while something is in progress.
struct StatusBadge: View {
    let text: String
    let tone: Tone

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "circle.fill")
                .font(.system(size: 6))
                .symbolEffect(.pulse, isActive: tone == .active)
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .foregroundStyle(tone.color)
        .background(tone.color.opacity(0.13), in: .capsule)
        .fixedSize()
        .accessibilityElement(children: .combine)
    }
}

nonisolated extension String {
    /// "not_deployed" → "Not deployed".
    var sentenceCased: String {
        let words = replacingOccurrences(of: "_", with: " ").lowercased()
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}

extension ProductionRelease {
    var outcomeTone: Tone {
        switch decision {
        case "FINISH": .good
        case "ROLLBACK": .bad
        default: isWaiting ? .warning : .neutral
        }
    }
}
