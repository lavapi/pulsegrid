import SwiftUI

/// The production release waiting in its hold, finished or rolled back from the phone.
struct ProductionReleaseView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: "production") {
            try await app.api.get("production-releases/current") as ProductionReleasesView
        } content: { view, reload in
            switch view {
            case .notSetUp:
                ContentUnavailableView("Not set up here", systemImage: "shippingbox", description: Text("Production releases are decided in the project that runs them."))
            case .ready(nil):
                ContentUnavailableView("No release in progress", systemImage: "checkmark.seal", description: Text("You'll get a notification when one is waiting for you."))
                    .refreshable { await reload() }
            case .ready(let release?):
                CurrentRelease(release: release, reload: reload)
            }
        }
        .navigationTitle("Production")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { ProductionReleaseHistoryView() } label: { Label("History", systemImage: "clock.arrow.circlepath") }
            }
        }
    }
}

/// The last production releases, with who finished or rolled each back.
struct ProductionReleaseHistoryView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loaded(id: "production-history") {
            try await app.api.get("production-releases/history") as [ProductionRelease]
        } content: { releases, reload in
            List {
                if releases.isEmpty { Text("No production releases yet").foregroundStyle(.secondary) }
                ForEach(releases, id: \.id) { release in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(release.id).font(.body.weight(.medium)).lineLimit(1)
                            Spacer()
                            StatusBadge(text: release.outcome, tone: release.outcomeTone)
                        }
                        Text(release.components.map { "\($0.name) \($0.tag)" }.joined(separator: ", ")).font(.caption).lineLimit(2)
                        Text([release.decidedBy ?? release.requestedBy, release.createdAt?.formatted(date: .abbreviated, time: .shortened)].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .refreshable { await reload() }
        }
        .navigationTitle("Release history")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct CurrentRelease: View {
    @Environment(AppModel.self) private var app
    let release: ProductionRelease
    let reload: () async -> Void
    @State private var confirming: String?
    @State private var deciding = false

    var body: some View {
        List {
            Section {
                LabeledContent("Release", value: release.id)
                LabeledContent("Status") {
                    StatusBadge(text: release.isWaiting ? "Waiting for you" : release.status.sentenceCased, tone: release.isWaiting ? .warning : .neutral)
                }
                if let requestedBy = release.requestedBy { LabeledContent("Requested by", value: requestedBy) }
                if let holdUntil = release.holdUntil {
                    LabeledContent("Hold ends") { Text(holdUntil, format: .dateTime.hour().minute()) }
                }
                if let decision = release.decision {
                    LabeledContent("Decision", value: "\(decision.sentenceCased) by \(release.decidedBy ?? "someone")")
                }
            }
            Section("Components") {
                ForEach(release.components) { component in
                    LabeledContent(component.name, value: component.tag).font(.callout.monospaced())
                }
            }
            if release.isWaiting {
                Section {
                    Button("Finish release") { confirming = "finish" }.disabled(deciding)
                    Button("Roll back", role: .destructive) { confirming = "rollback" }.disabled(deciding)
                } footer: {
                    Text("This changes production.")
                }
            }
        }
        .refreshable { await reload() }
        .confirmationDialog(
            confirming == "rollback" ? "Roll back this release?" : "Finish this release?",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible
        ) {
            if let choice = confirming {
                Button(choice == "rollback" ? "Roll back production" : "Finish release", role: choice == "rollback" ? .destructive : nil) {
                    Task { await decide(choice) }
                }
            }
        }
    }

    private func decide(_ choice: String) async {
        deciding = true
        defer { deciding = false }
        struct Decision: Encodable { let decision: String }
        do {
            let _: ProductionReleaseDecisionResult = try await app.api.post("production-releases/decide", body: Decision(decision: choice))
            await reload()
        } catch {
            app.show(error)
        }
    }
}
