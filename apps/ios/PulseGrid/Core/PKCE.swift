import CryptoKit
import Foundation

/// The secret the app keeps and the challenge it shows the browser: only this app can swap the code it gets back.
struct PKCE {
    let verifier: String
    let challenge: String
    /// Ties the answer to this sign-in, so an old or foreign link is ignored.
    let state: String

    init(verifier: String = PKCE.randomText(), state: String = PKCE.randomText()) {
        self.verifier = verifier
        self.state = state
        challenge = PKCE.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func randomText(bytes: Int = 32) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return base64url(data)
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
