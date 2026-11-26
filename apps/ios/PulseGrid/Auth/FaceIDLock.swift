import LocalAuthentication

/// Unlocks the app with Face ID, or the phone's passcode when Face ID isn't set up.
enum FaceIDLock {
    static func unlock() async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "Use Passcode"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // No passcode on the phone at all: there's nothing to unlock with, so the app opens.
            return true
        }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock PulseGrid")) ?? false
    }
}
