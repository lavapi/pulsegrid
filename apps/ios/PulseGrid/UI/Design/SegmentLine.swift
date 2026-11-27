import SwiftUI

/// Steps in a row as colored segments with their names under them: a release's stages or a run's jobs.
struct SegmentLine: View {
    struct Segment {
        let label: String
        let color: Color
        /// Not reached yet, drawn faint.
        var waiting = false
    }

    let segments: [Segment]

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                VStack(alignment: .leading, spacing: 3) {
                    Capsule()
                        .fill(segment.color.opacity(segment.waiting ? 0.25 : 1))
                        .frame(height: 5)
                    Text(segment.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(segments.map(\.label).joined(separator: ", "))
    }
}

extension SegmentLine {
    init(stages: [ReleaseStage]) {
        self.init(segments: stages.map { .init(label: $0.label, color: Tone.ofStage($0.status).color, waiting: $0.status == "waiting") })
    }

    init(jobs: [PipelineJob]) {
        self.init(segments: jobs.map { .init(label: $0.name, color: Tone.ofPipeline($0.status).color, waiting: $0.status == "queued") })
    }
}
