import Foundation

/// Every failure the app can show, as a sentence a person can act on. Raw error codes never reach the screen.
enum AppError: Error, Equatable {
    /// The phone can't reach PulseGrid, which is private: usually the VPN is off.
    case unreachable
    /// The sign-in ended or was signed out elsewhere.
    case signedOut
    /// PulseGrid refused, with its own readable message.
    case refused(String)
    /// Something unexpected; never shown with details.
    case unexpected
    /// The person cancelled; never shown.
    case cancelled

    var message: String? {
        switch self {
        case .unreachable:
            "Can't reach PulseGrid. Turn on your company VPN and try again."
        case .signedOut:
            "You've been signed out. Sign in again to continue."
        case .refused(let message):
            message
        case .unexpected:
            "Something went wrong. Please try again."
        case .cancelled:
            nil
        }
    }

    /// Whether turning on the VPN is the likely fix, so screens can say so prominently.
    var needsVPN: Bool { self == .unreachable }

    /// Maps any error to an AppError. Network failures that mean "can't get there" become `.unreachable`.
    static func from(_ error: Error) -> AppError {
        if let appError = error as? AppError { return appError }
        if error is CancellationError { return .cancelled }
        if let urlError = error as? URLError { return from(urlError) }
        return .unexpected
    }

    private static func from(_ error: URLError) -> AppError {
        switch error.code {
        case .cancelled:
            .cancelled
        case .cannotFindHost, .cannotConnectToHost, .timedOut, .notConnectedToInternet,
             .networkConnectionLost, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed,
             .secureConnectionFailed:
            .unreachable
        default:
            .unexpected
        }
    }
}
