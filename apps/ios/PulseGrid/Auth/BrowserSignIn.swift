import AuthenticationServices
import UIKit

/// Signs in on PulseGrid's own sign-in page in the system browser, then swaps the code it hands back for a token.
final class BrowserSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let api: APIClient
    private var session: ASWebAuthenticationSession?

    init(api: APIClient) {
        self.api = api
    }

    func signIn(server: URL) async throws -> String {
        let pkce = PKCE()
        var components = URLComponents(url: server.appending(path: "mobile/sign-in"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "challenge", value: pkce.challenge),
            URLQueryItem(name: "state", value: pkce.state),
            URLQueryItem(name: "device", value: UIDevice.current.name),
        ]
        guard let url = components?.url else { throw AppError.unexpected }

        let callback = try await open(url)
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        guard value("state") == pkce.state, let code = value("code") else {
            throw AppError.refused("That sign-in didn't come from this app. Please try again.")
        }

        struct Exchange: Encodable { let code: String; let verifier: String }
        let token: DeviceToken = try await api.post("auth/device/token", body: Exchange(code: code, verifier: pkce.verifier))
        return token.token
    }

    private func open(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme("pulsegrid")) { callback, error in
                if let callback {
                    continuation.resume(returning: callback)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: AppError.cancelled)
                } else {
                    continuation.resume(throwing: AppError.unreachable)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}
