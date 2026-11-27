import SwiftUI

/// A rounded card on the grouped background, the building block of dashboards.
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22, style: .continuous))
    }
}

/// A dashboard section's title, with an optional link to see everything.
struct CardSectionHeader<Destination: View>: View {
    let title: String
    var count: Int?
    @ViewBuilder var destination: Destination

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.title3.weight(.bold))
            if let count {
                Text(count, format: .number).font(.title3.weight(.bold)).foregroundStyle(.secondary)
            }
            Spacer()
            if Destination.self != EmptyView.self {
                NavigationLink("See all") { destination }.font(.subheadline.weight(.medium))
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .contain)
    }
}

extension CardSectionHeader where Destination == EmptyView {
    init(title: String, count: Int? = nil) {
        self.init(title: title, count: count) { EmptyView() }
    }
}

/// A card that opens a screen: its whole surface is the link, with a chevron at the end.
struct CardLink<Destination: View, Content: View>: View {
    @ViewBuilder let destination: Destination
    @ViewBuilder let content: Content

    var body: some View {
        NavigationLink { destination } label: { ChevronCard { content } }.buttonStyle(.plain)
    }
}

/// A card that does something when tapped, with a chevron at the end.
struct CardButton<Content: View>: View {
    let action: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        Button(action: action) { ChevronCard { content } }.buttonStyle(.plain)
    }
}

private struct ChevronCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        Card {
            HStack(spacing: 12) {
                content
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .contentShape(.rect(cornerRadius: 22))
    }
}

/// The share of something that's healthy, as a thick ring with the percentage inside.
struct HealthRing: View {
    let share: Double
    let tone: Tone
    var size: CGFloat = 84

    var body: some View {
        ZStack {
            Circle().stroke(tone.color.opacity(0.18), lineWidth: size * 0.12)
            Circle()
                .trim(from: 0, to: share)
                .stroke(tone.color, style: StrokeStyle(lineWidth: size * 0.12, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.smooth, value: share)
            VStack(spacing: 0) {
                Text(share, format: .percent.precision(.fractionLength(0)))
                    .font(.system(size: size * 0.24, weight: .bold, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText())
                Text("healthy").font(.system(size: size * 0.12)).foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Int((share * 100).rounded())) percent healthy")
    }
}
