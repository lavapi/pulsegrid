import Foundation
import Observation

/// What the whole app shares: the server, the sign-in, the person, their project and the selected account.
@Observable
final class AppModel {
    enum Phase: Equatable {
        /// First launch, or after changing server: the person connects the app to their company's PulseGrid.
        case needsServer
        case signedOut
        case locked
        case loading
        case ready
    }

    private(set) var phase: Phase = .needsServer
    private(set) var user: CurrentUser?
    private(set) var projects: [Project] = []
    private(set) var accounts: [CloudAccount] = []
    var selectedAccountId: String? {
        didSet { remember(selectedAccountId, as: accountKey) }
    }
    /// A screen to open, from a tapped notification.
    var pendingPath: String?
    var error: AppError?

    private(set) var server: URL? {
        didSet { UserDefaults.standard.set(server?.absoluteString, forKey: Self.serverKey) }
    }

    private static let serverKey = "server"
    private let tokens = TokenStore()
    @ObservationIgnored private(set) lazy var api: APIClient = {
        let client = APIClient(baseURL: { [unowned self] in server }, token: { [unowned self] in tokens.read() })
        client.onSignedOut = { [unowned self] in forgetSignIn() }
        return client
    }()

    init() {
        server = UserDefaults.standard.string(forKey: Self.serverKey).flatMap(URL.init(string:))
        #if DEBUG
        // For checking screens in the simulator: launch with `-server <url> -PulseGridToken <token> -PulseGridOpen <path>`.
        if let token = UserDefaults.standard.string(forKey: "PulseGridToken") { tokens.save(token) }
        pendingPath = UserDefaults.standard.string(forKey: "PulseGridOpen")
        #endif
        phase = server == nil ? .needsServer : tokens.read() == nil ? .signedOut : .locked
    }

    /// Checks the address really is a PulseGrid server that's ready for sign-in, then keeps it.
    func connect(to address: String) async {
        error = nil
        guard let url = ServerAddress.parse(address) else {
            error = .refused("Enter the address you open PulseGrid at in a browser, like pulsegrid.example.com.")
            return
        }
        struct Methods: Decodable { let setupRequired: Bool }
        do {
            let methods: Methods = try await APIClient(baseURL: { url }, token: { nil }).get("auth/methods")
            guard !methods.setupRequired else {
                error = .refused("This PulseGrid isn't set up yet. Finish setting it up in a browser first.")
                return
            }
            server = url
            phase = .signedOut
        } catch AppError.unexpected {
            error = .refused("That address isn't a PulseGrid server. Check it and try again.")
        } catch AppError.unreachable {
            error = .refused("Can't reach that address. If your PulseGrid is only on your company network, turn on your VPN and try again.")
        } catch {
            show(error)
        }
    }

    /// Signs out and goes back to choosing a server.
    func changeServer() async {
        if tokens.read() != nil { await signOut() }
        server = nil
        phase = .needsServer
    }

    var selectedAccount: CloudAccount? { accounts.first { $0.id == selectedAccountId } }

    func signIn() async {
        error = nil
        guard let server else { return }
        do {
            let token = try await BrowserSignIn(api: api).signIn(server: server)
            tokens.save(token)
            await load()
        } catch {
            show(error)
        }
    }

    func unlock() async {
        #if DEBUG
        if UserDefaults.standard.string(forKey: "PulseGridToken") != nil {
            await load()
            return
        }
        #endif
        if await FaceIDLock.unlock() {
            await load()
        }
    }

    /// Locks again when the app goes to the background, so Face ID guards it each time.
    func lock() {
        if phase == .ready { phase = .locked }
    }

    func load() async {
        phase = .loading
        do {
            let user: CurrentUser = try await api.get("me")
            async let projectList: ProjectList = api.get("projects")
            async let accountList: [CloudAccount] = api.get("cloud/accounts")
            self.user = user
            projects = try await projectList.projects
            accounts = try await accountList.filter(\.isSelectable)
            let remembered = UserDefaults.standard.string(forKey: accountKey)
            selectedAccountId = accounts.first { $0.id == remembered }?.id ?? accounts.first?.id
            phase = .ready
            error = nil
        } catch {
            phase = tokens.read() == nil ? .signedOut : .locked
            show(error)
        }
    }

    func switchProject(to project: Project) async {
        do {
            try await api.postIgnoringResponse("projects/\(project.id)/select")
            await load()
        } catch {
            show(error)
        }
    }

    func signOut() async {
        try? await api.postIgnoringResponse("auth/logout")
        forgetSignIn()
    }

    func show(_ error: Error) {
        let appError = AppError.from(error)
        if appError != .cancelled { self.error = appError }
    }

    private func forgetSignIn() {
        tokens.delete()
        user = nil
        accounts = []
        projects = []
        phase = server == nil ? .needsServer : .signedOut
    }

    private var accountKey: String { "account.\(user?.tenant?.id ?? "none")" }

    private func remember(_ value: String?, as key: String) {
        UserDefaults.standard.set(value, forKey: key)
    }
}
