import SwiftUI

/// A person's initials in a tinted circle.
struct Initials: View {
    let name: String
    var size: CGFloat = 40

    private var letters: String {
        // An email's initials come from the part before the "@", so "vic@example.test" reads "V".
        let person = name.split(separator: "@").first.map(String.init) ?? name
        let words = person.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "_" || $0 == "-" })
        return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    var body: some View {
        Text(letters.isEmpty ? "?" : letters)
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color.accentColor.gradient, in: .circle)
            .accessibilityHidden(true)
    }
}

/// Picks a whole number of hours, from one up to `maxHours`.
struct HoursPicker: View {
    let title: String
    let maxHours: Int
    @Binding var hours: Int

    var body: some View {
        Picker(title, selection: $hours) {
            ForEach(1...max(1, maxHours), id: \.self) { Text(hoursText($0)).tag($0) }
        }
    }
}

/// "1 hour", "3 hours".
func hoursText(_ hours: Int) -> String { "\(hours) \(hours == 1 ? "hour" : "hours")" }

/// The time left on active access, counting down live, with a bar for how much of it has passed.
struct AccessCountdown: View {
    let grant: DatabaseAccessGrant

    var body: some View {
        if grant.expiresAt > .now {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Ends in")
                    Spacer()
                    Text(timerInterval: Date.now...grant.expiresAt, countsDown: true)
                        .font(.title3.weight(.semibold).monospacedDigit())
                }
                ProgressView(timerInterval: grant.startsAt...grant.expiresAt, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                    .tint(.accentColor)
            }
            .padding(.vertical, 4)
        }
    }
}

/// One approver change in a sheet: its fields, the code from the authenticator app when it needs one,
/// and PulseGrid's answer when it fails. Cancelling does nothing.
struct ApproverSheet<Fields: View>: View {
    @Environment(\.dismiss) private var dismiss
    private let title: String
    private let confirmLabel: String
    private let destructive: Bool
    private let needsCode: Bool
    private let canConfirm: Bool
    private let fields: Fields
    private let send: (_ code: String) async throws -> Void
    private let done: () -> Void

    @State private var code = ""
    @State private var sending = false
    @State private var error: AppError?

    init(
        _ title: String,
        confirm confirmLabel: String,
        destructive: Bool = false,
        needsCode: Bool = true,
        canConfirm: Bool = true,
        @ViewBuilder fields: () -> Fields,
        send: @escaping (_ code: String) async throws -> Void,
        done: @escaping () -> Void
    ) {
        self.title = title
        self.confirmLabel = confirmLabel
        self.destructive = destructive
        self.needsCode = needsCode
        self.canConfirm = canConfirm
        self.fields = fields()
        self.send = send
        self.done = done
    }

    private var trimmedCode: String { code.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            Form {
                fields
                if needsCode {
                    Section {
                        TextField("Code from your authenticator app", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                    } footer: {
                        Text("Every change to production database access asks for a fresh code.")
                    }
                }
                if let message = error?.message {
                    Section { Text(message).foregroundStyle(.red) }
                }
            }
            .sensoryFeedback(.error, trigger: error) { _, new in new != nil }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "\(confirmLabel)…" : confirmLabel, role: destructive ? .destructive : nil) { Task { await submit() } }
                        .disabled(sending || !canConfirm || (needsCode && trimmedCode.count < 6))
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func submit() async {
        sending = true
        defer { sending = false }
        do {
            try await send(trimmedCode)
            done()
        } catch {
            code = ""
            let appError = AppError.from(error)
            if appError != .cancelled { self.error = appError }
        }
    }
}
