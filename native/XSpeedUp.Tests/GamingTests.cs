using XSpeedUp.Agent;

internal static class GamingTests
{
    public static void Run(string workspace, Action<bool, string> check, Action<Action, string> reject)
    {
        var journal = new Journal(Path.Combine(workspace, "gaming-journal"));
        var env = new FakeGame();
        var game = new GameMode(journal, env);
        reject(() => game.Start(["WinDefend"], []), "Gaming cannot stop security or uncatalogued services");
        reject(() => game.Start([], [new(42, "stale")]), "Gaming rejects stale process identities before changes");
        check(journal.Entries().Count == 0, "Invalid gaming profiles have no side effects");
        env.IsAdmin = false;
        reject(() => game.Start(["Fax"], []), "Gaming service changes require administrator access");
        env.IsAdmin = true;
        env.BeforeWrite = () => check(journal.Entries().Any(e => e.Game is not null), "Gaming backup exists before every OS change");
        var result = game.Start(["DiagTrack", "MapsBroker"], [new(42, "start")]);
        check(env.Mode == 1 && env.States["DiagTrack"] == 1 && env.Closed == 1 && result.Skipped == 1, "Balanced profile enables Game Mode, stops only running selected services and requests app close");
        reject(() => game.Start([], []), "An active gaming session cannot overwrite its recovery snapshot");
        var reopened = new GameMode(journal, env);
        check(reopened.Status().SessionId is not null, "Gaming recovery survives an agent restart");
        env.FailStart = true;
        var partial = reopened.Stop();
        check(partial.Skipped == 1 && env.Mode == 0 && reopened.Status().SessionId is not null, "Partial gaming restore preserves failed service recovery");
        env.FailStart = false;
        reopened.Stop();
        check(env.States["DiagTrack"] == 4 && reopened.Status().SessionId is null && env.Closed == 1, "Retry restores services and does not relaunch closed apps");
        env.BeforeWrite = null; env.Mode = null;
        game.Start([], []); game.Stop();
        check(env.Mode is null, "Absent Game Mode registry values are restored as absent");
        env.Mode = 0; game.Start([], []); env.Mode = null;
        check(game.Stop().Skipped == 1 && env.Mode is null, "Gaming restoration preserves externally changed settings");
        var invalid = new JournalEntry { Kind = "gaming", Game = new() { StoppedServices = ["WinDefend"] } };
        reject(() => game.Restore(invalid), "Forged recovery records cannot start protected services");
    }
    private sealed class FakeGame : IGameEnvironment
    {
        public bool IsAdmin { get; set; } = true;
        public int? Mode = 0;
        public Dictionary<string, uint> States = new() { ["DiagTrack"] = 4, ["MapsBroker"] = 1, ["Fax"] = 4 };
        public bool FailStart;
        public int Closed;
        public Action? BeforeWrite;
        public int? ReadMode() => Mode;
        public bool ExchangeMode(int? expected, int? replacement)
        { BeforeWrite?.Invoke(); if (Mode != expected) return false; Mode = replacement; return true; }
        public uint ServiceState(string id) => States[id];
        public void SetRunning(string id, bool running)
        { BeforeWrite?.Invoke(); if (running && FailStart) throw new IOException("Fixture service restart failure"); States[id] = running ? 4u : 1u; }
        public ProcessItem[] Processes() => [new(42, "Fixture", 10, "Fixture app", "start")];
        public ActionResult Close(GameProcess process) { Closed++; return new("Close requested", 1); }
    }
}
