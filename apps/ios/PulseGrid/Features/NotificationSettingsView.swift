import SwiftUI

/// Whether this phone may show notifications, and which topics the person wants, saved for all their phones.
struct NotificationSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(PushRegistrar.self) private var push

    var body: some View {
        Loaded(id: "notification-settings") {
            try await app.api.get("account/notifications") as NotificationSettings
        } content: { settings, reload in
            TopicList(initial: settings, reload: reload)
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct TopicList: View {
    @Environment(AppModel.self) private var app
    @Environment(PushRegistrar.self) private var push
    @State private var settings: NotificationSettings
    let reload: () async -> Void

    init(initial: NotificationSettings, reload: @escaping () async -> Void) {
        _settings = State(initialValue: initial)
        self.reload = reload
    }

    var body: some View {
        List {
            Section {
                LabeledContent("On this iPhone", value: push.statusText)
                if push.canAsk {
                    Button("Turn on notifications") { Task { await push.ask() } }
                }
            } footer: {
                Text("If they're off for PulseGrid in the iPhone's Settings, nothing arrives whatever you choose below.")
            }
            Section {
                ForEach(NotificationTopic.allCases) { topic in
                    Toggle(topic.label, isOn: Binding(get: { settings.isOn(topic) }, set: { on in Task { await change(topic, to: on) } }))
                }
            } header: {
                Text("Notify me about")
            } footer: {
                Text("Saved for you, on every phone you're signed in on.")
            }
        }
        .refreshable { await reload() }
    }

    private func change(_ topic: NotificationTopic, to on: Bool) async {
        let before = settings
        settings = settings.setting(topic, to: on)
        do {
            settings = try await app.api.put("account/notifications", body: NotificationChange(topic: topic, on: on))
        } catch {
            settings = before
            app.show(error)
        }
    }
}
