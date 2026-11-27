import SwiftUI

/// The outline of a list while it loads, so the screen keeps its shape instead of showing a spinner.
struct SkeletonList: View {
    var rows = 6

    var body: some View {
        List {
            Section {
                ForEach(0..<rows, id: \.self) { _ in
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Service name placeholder")
                            Text("Type · status · region").font(.caption)
                        }
                    } icon: {
                        IconTile(symbol: "square.fill", color: .gray)
                    }
                }
            }
        }
        .redacted(reason: .placeholder)
        .allowsHitTesting(false)
        .accessibilityLabel("Loading")
    }
}
